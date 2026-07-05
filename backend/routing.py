"""Calcul des itinéraires « rapide » et « calme » sur le graphe piéton enrichi.

Coût d'une arête pour l'itinéraire calme :
    cout(e) = length * (1 + beta * S(e, h, p))
L'itinéraire rapide est pondéré par la longueur seule.

Le plus court chemin passe par scipy (Dijkstra compilé sur matrice creuse) :
les arêtes sont pré-compilées en tableaux numpy par preparer_routage(), appelé
une fois au démarrage. Un Dijkstra networkx avec fonction de coût Python
prenait ~3 s par itinéraire sur les 350 000 arêtes de la zone.
"""
from __future__ import annotations

import math
from typing import Any, Callable

import networkx as nx
import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

try:  # lancement depuis la racine du repo (uvicorn backend.main:app)
    from backend import scoring
    from backend.scoring import Profil, confiance_arete, score_arete
except ImportError:  # lancement depuis backend/ (uvicorn main:app)
    import scoring  # type: ignore
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


def preparer_routage(G: nx.MultiDiGraph) -> dict[str, Any]:
    """Pré-compile le graphe en tableaux numpy pour le Dijkstra scipy.

    Les arêtes parallèles u→v sont regroupées (ordre + debuts) pour retenir,
    à chaque requête, la moins coûteuse via np.minimum.reduceat.
    """
    noeuds = np.array(list(G.nodes))
    index = {int(n): i for i, n in enumerate(noeuds)}
    xs = np.array([G.nodes[n]["x"] for n in noeuds], dtype=float)
    ys = np.array([G.nodes[n]["y"] for n in noeuds], dtype=float)

    # KD-tree en degrés « aplatis » : longitude corrigée par cos(latitude)
    cos_lat = math.cos(math.radians(float(ys.mean())))
    arbre = cKDTree(np.column_stack((xs * cos_lat, ys)))

    n_aretes = G.number_of_edges()
    ui = np.empty(n_aretes, dtype=np.int32)
    vi = np.empty(n_aretes, dtype=np.int32)
    longueur = np.empty(n_aretes)
    lden = np.empty(n_aretes)
    n_bar = np.empty(n_aretes)
    n_marche = np.empty(n_aretes)
    n_ecole = np.empty(n_aretes)
    n_commerce = np.empty(n_aretes)
    for i, (u, v, attrs) in enumerate(G.edges(data=True)):
        ui[i] = index[u]
        vi[i] = index[v]
        longueur[i] = float(attrs.get("length", 1.0))
        lden[i] = float(attrs.get("lden", scoring.BRUIT_DEFAUT))
        n_bar[i] = float(attrs.get("n_bar", 0))
        n_marche[i] = float(attrs.get("n_marche", 0))
        n_ecole[i] = float(attrs.get("n_ecole", 0))
        n_commerce[i] = float(attrs.get("n_commerce", 0))

    # Regroupement des arêtes parallèles : une entrée par couple (u, v)
    ordre = np.lexsort((vi, ui))
    ui_trie, vi_trie = ui[ordre], vi[ordre]
    nouveaux = np.ones(n_aretes, dtype=bool)
    nouveaux[1:] = (ui_trie[1:] != ui_trie[:-1]) | (vi_trie[1:] != vi_trie[:-1])
    debuts = np.nonzero(nouveaux)[0]

    prep = {
        "noeuds": noeuds, "arbre": arbre, "cos_lat": cos_lat,
        "longueur": longueur, "lden": lden, "n_bar": n_bar,
        "n_marche": n_marche, "n_ecole": n_ecole, "n_commerce": n_commerce,
        "ordre": ordre, "debuts": debuts,
        "lignes": ui_trie[debuts], "colonnes": vi_trie[debuts],
        "n_noeuds": len(noeuds),
    }
    prep["csr_rapide"] = _matrice_couts(prep, longueur)  # statique : pré-construite
    return prep


def _matrice_couts(prep: dict[str, Any], poids: np.ndarray) -> csr_matrix:
    """Matrice creuse des coûts, arêtes parallèles réduites à la moins chère."""
    minima = np.minimum.reduceat(poids[prep["ordre"]], prep["debuts"])
    return csr_matrix((minima, (prep["lignes"], prep["colonnes"])),
                      shape=(prep["n_noeuds"], prep["n_noeuds"]))


def _noeud_le_plus_proche(prep: dict[str, Any], lat: float, lon: float) -> int:
    """Indice (interne) du nœud du graphe le plus proche du point demandé."""
    _, indice = prep["arbre"].query([lon * prep["cos_lat"], lat])
    return int(indice)


def _plus_court_chemin(prep: dict[str, Any], matrice: csr_matrix,
                       orig: int, dest: int) -> list[int]:
    """Plus court chemin (liste de nœuds du graphe) via Dijkstra scipy."""
    distances, predecesseurs = dijkstra(matrice, directed=True, indices=orig,
                                        return_predecessors=True)
    if not np.isfinite(distances[dest]):
        raise ValueError("aucun itinéraire piéton trouvé entre ces deux points")
    chemin_indices = [dest]
    while chemin_indices[-1] != orig:
        chemin_indices.append(int(predecesseurs[chemin_indices[-1]]))
    noeuds = prep["noeuds"]
    return [int(noeuds[i]) for i in reversed(chemin_indices)]


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


def calculer_itineraires(G: nx.MultiDiGraph, prep: dict[str, Any],
                         from_lat: float, from_lon: float,
                         to_lat: float, to_lon: float, heure: int, profil: Profil,
                         beta: float = 3.0, jour_semaine: int = 0) -> dict[str, Any]:
    """Calcule les itinéraires rapide et calme, au format du contrat d'API.

    Lève ValueError (→ HTTP 400 côté API) si aucun itinéraire n'est possible.
    """
    orig = _noeud_le_plus_proche(prep, from_lat, from_lon)
    dest = _noeud_le_plus_proche(prep, to_lat, to_lon)
    if orig == dest:
        raise ValueError("départ et arrivée trop proches : ils tombent sur le même "
                         "nœud du graphe")

    def cout_rapide(attrs: Attrs) -> float:
        return float(attrs.get("length", 1.0))

    def cout_calme(attrs: Attrs) -> float:
        return float(attrs.get("length", 1.0)) \
            * (1.0 + beta * score_arete(attrs, heure, profil, jour_semaine))

    scores = scoring.score(prep["lden"], prep["n_bar"], prep["n_marche"],
                           prep["n_ecole"], prep["n_commerce"], heure, profil,
                           jour_semaine)
    matrice_calme = _matrice_couts(prep, prep["longueur"] * (1.0 + beta * scores))

    rapide = _resume_chemin(G, _plus_court_chemin(prep, prep["csr_rapide"], orig, dest),
                            heure, profil, cout_rapide, jour_semaine)
    calme = _resume_chemin(G, _plus_court_chemin(prep, matrice_calme, orig, dest),
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
