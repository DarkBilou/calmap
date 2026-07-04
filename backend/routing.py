"""Calcul des itinéraires « rapide » et « calme » sur le graphe piéton enrichi.

Coût d'une arête pour l'itinéraire calme :
    cout(e) = length * (1 + beta * S(e, h, p))
L'itinéraire rapide est pondéré par la longueur seule.
"""
from __future__ import annotations

from typing import Any, Callable

import networkx as nx
import osmnx as ox

try:  # lancement depuis la racine du repo (uvicorn backend.main:app)
    from backend.scoring import Profil, confiance_arete, score_arete
except ImportError:  # lancement depuis backend/ (uvicorn main:app)
    from scoring import Profil, confiance_arete, score_arete  # type: ignore

VITESSE_MARCHE_KMH = 4.5  # vitesse de marche pour convertir distance → durée

Attrs = dict[str, Any]
Cout = Callable[[Attrs], float]


def coords_arete(G: nx.MultiDiGraph, u: int, v: int,
                 attrs: Attrs) -> list[tuple[float, float]]:
    """Polyligne (lon, lat) de l'arête, réorientée de u vers v si nécessaire."""
    if "geometry" in attrs:
        pts = [(float(x), float(y)) for x, y in attrs["geometry"].coords]
        xu, yu = G.nodes[u]["x"], G.nodes[u]["y"]
        # la géométrie OSM peut être stockée dans le sens opposé au parcours
        if (pts[0][0] - xu) ** 2 + (pts[0][1] - yu) ** 2 \
                > (pts[-1][0] - xu) ** 2 + (pts[-1][1] - yu) ** 2:
            pts.reverse()
        return pts
    return [(G.nodes[u]["x"], G.nodes[u]["y"]), (G.nodes[v]["x"], G.nodes[v]["y"])]


def _plus_court_chemin(G: nx.MultiDiGraph, orig: int, dest: int,
                       cout: Cout) -> list[int]:
    """Plus court chemin (liste de nœuds) selon la fonction de coût donnée."""
    def poids(u: int, v: int, d: dict) -> float:
        # MultiDiGraph : d = {clé: attributs} des arêtes parallèles u→v,
        # on retient la moins coûteuse
        return min(cout(attrs) for attrs in d.values())

    try:
        return nx.shortest_path(G, orig, dest, weight=poids)
    except (nx.NetworkXNoPath, nx.NodeNotFound) as exc:
        raise ValueError("aucun itinéraire piéton trouvé entre ces deux points") from exc


def _resume_chemin(G: nx.MultiDiGraph, chemin: list[int], heure: int,
                   profil: Profil, cout: Cout, jour_semaine: int = 0) -> dict[str, Any]:
    """Agrège distance, durée, exposition, confiance et géométrie d'un chemin."""
    distance = exposition = confiance_ponderee = 0.0
    coords: list[tuple[float, float]] = []
    for u, v in zip(chemin[:-1], chemin[1:]):
        # même critère de sélection des arêtes parallèles que le plus court chemin
        attrs = min(G[u][v].values(), key=cout)
        longueur = float(attrs.get("length", 0.0))
        distance += longueur
        exposition += longueur * score_arete(attrs, heure, profil, jour_semaine)
        confiance_ponderee += longueur * confiance_arete(attrs)
        pts = coords_arete(G, u, v, attrs)
        coords.extend(pts if not coords else pts[1:])  # sans doubler les jonctions
    duree_min = distance / 1000.0 / VITESSE_MARCHE_KMH * 60.0
    return {"distance_m": distance, "duree_min": duree_min, "exposition": exposition,
            "confiance_ponderee": confiance_ponderee, "coords": coords}


def _feature(coords: list[tuple[float, float]],
             properties: dict[str, Any]) -> dict[str, Any]:
    """Construit une Feature GeoJSON LineString (coordonnées [lon, lat])."""
    return {
        "type": "Feature",
        "geometry": {"type": "LineString",
                     "coordinates": [[round(x, 6), round(y, 6)] for x, y in coords]},
        "properties": properties,
    }


def calculer_itineraires(G: nx.MultiDiGraph, from_lat: float, from_lon: float,
                         to_lat: float, to_lon: float, heure: int, profil: Profil,
                         beta: float = 3.0, jour_semaine: int = 0) -> dict[str, Any]:
    """Calcule les itinéraires rapide et calme, au format du contrat d'API.

    Lève ValueError (→ HTTP 400 côté API) si aucun itinéraire n'est possible.
    """
    # Snapping : nœud du graphe le plus proche de chaque point demandé
    orig = int(ox.distance.nearest_nodes(G, X=from_lon, Y=from_lat))
    dest = int(ox.distance.nearest_nodes(G, X=to_lon, Y=to_lat))
    if orig == dest:
        raise ValueError("départ et arrivée trop proches : ils tombent sur le même "
                         "nœud du graphe")

    def cout_rapide(attrs: Attrs) -> float:
        return float(attrs.get("length", 1.0))

    def cout_calme(attrs: Attrs) -> float:
        return float(attrs.get("length", 1.0)) \
            * (1.0 + beta * score_arete(attrs, heure, profil, jour_semaine))

    rapide = _resume_chemin(G, _plus_court_chemin(G, orig, dest, cout_rapide),
                            heure, profil, cout_rapide, jour_semaine)
    calme = _resume_chemin(G, _plus_court_chemin(G, orig, dest, cout_calme),
                           heure, profil, cout_calme, jour_semaine)

    delta_duree = calme["duree_min"] - rapide["duree_min"]
    if rapide["exposition"] > 0:
        delta_expo_pct = (calme["exposition"] - rapide["exposition"]) \
            / rapide["exposition"] * 100.0
    else:
        delta_expo_pct = 0.0

    # Confiance globale : moyenne pondérée par la longueur sur les deux tracés
    distance_totale = rapide["distance_m"] + calme["distance_m"]
    if distance_totale > 0:
        confiance = (rapide["confiance_ponderee"] + calme["confiance_ponderee"]) \
            / distance_totale
    else:
        confiance = 0.5

    return {
        "rapide": {
            "geojson": _feature(rapide["coords"], {"type": "rapide"}),
            "distance_m": round(rapide["distance_m"]),
            "duree_min": round(rapide["duree_min"], 1),
            "exposition": round(rapide["exposition"], 1),
        },
        "calme": {
            "geojson": _feature(calme["coords"], {"type": "calme"}),
            "distance_m": round(calme["distance_m"]),
            "duree_min": round(calme["duree_min"], 1),
            "exposition": round(calme["exposition"], 1),
            "delta_duree_min": round(delta_duree, 1),
            "delta_exposition_pct": round(delta_expo_pct, 1),
        },
        "confiance": round(confiance, 2),
    }
