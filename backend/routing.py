"""Calcul des itinéraires « rapide » et « calme » sur le graphe piéton enrichi.

Coût d'une arête pour l'itinéraire calme :
    cout(e) = length * (1 + beta * S(e, h, p))
L'itinéraire rapide est pondéré par la longueur seule.

Le plus court chemin passe par scipy (Dijkstra compilé sur matrice creuse).
Le graphe networkx n'est nécessaire qu'à la compilation (compiler_routage,
appelée par main au premier démarrage) : les requêtes sont servies uniquement
depuis des tableaux numpy, rechargeables depuis le cache data/graph_compile.npz
sans dépickler les 80 Mo du graphe.
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

try:  # lancement depuis la racine du repo (uvicorn backend.main:app)
    from backend import scoring
    from backend.scoring import Profil
except ImportError:  # lancement depuis backend/ (uvicorn main:app)
    import scoring  # type: ignore
    from scoring import Profil  # type: ignore

VITESSE_MARCHE_KMH = 4.5  # vitesse de marche pour convertir distance → durée

Attrs = dict[str, Any]


def coords_arete(G: Any, u: int, v: int, attrs: Attrs) -> list[tuple[float, float]]:
    """Polyligne (lon, lat) de l'arête, réorientée de u vers v si nécessaire.

    Utilisée uniquement à la compilation (le runtime lit les tableaux).
    """
    if "geometry" in attrs:
        pts = [(float(x), float(y)) for x, y in attrs["geometry"].coords]
        xu, yu = G.nodes[u]["x"], G.nodes[u]["y"]
        # la géométrie OSM peut être stockée dans le sens opposé au parcours
        if (pts[0][0] - xu) ** 2 + (pts[0][1] - yu) ** 2 \
                > (pts[-1][0] - xu) ** 2 + (pts[-1][1] - yu) ** 2:
            pts.reverse()
        return pts
    return [(G.nodes[u]["x"], G.nodes[u]["y"]), (G.nodes[v]["x"], G.nodes[v]["y"])]


# ─────────────────────────────────────────────────────────────────────────────
# Compilation (une fois, à partir du graphe networkx)
# ─────────────────────────────────────────────────────────────────────────────

def compiler_routage(G: Any, ident_vers_feature: dict[tuple[int, int, int],
                                                      tuple[int, int]]) -> dict[str, np.ndarray]:
    """Compile les arêtes orientées en tableaux numpy sérialisables (préfixe rt_).

    ident_vers_feature : (min(u,v), max(u,v), key) → (indice de la feature
    d'affichage qui porte la géométrie, nœud u dans le sens stocké). Construit
    par la pré-compilation d'affichage de main ; permet de partager les
    polylignes entre les deux sens d'une même rue au lieu de les dupliquer.
    """
    noeuds = list(G.nodes)
    index = {int(n): i for i, n in enumerate(noeuds)}
    xs = np.array([G.nodes[n]["x"] for n in noeuds], dtype=float)
    ys = np.array([G.nodes[n]["y"] for n in noeuds], dtype=float)

    n_aretes = G.number_of_edges()
    ui = np.empty(n_aretes, dtype=np.int32)
    vi = np.empty(n_aretes, dtype=np.int32)
    longueur = np.empty(n_aretes)
    lden = np.empty(n_aretes)
    n_bar = np.empty(n_aretes)
    n_marche = np.empty(n_aretes)
    n_ecole = np.empty(n_aretes)
    n_commerce = np.empty(n_aretes)
    feature = np.empty(n_aretes, dtype=np.int32)
    inverse = np.zeros(n_aretes, dtype=bool)
    bruit_reel = np.zeros(n_aretes, dtype=bool)
    for i, (u, v, k, attrs) in enumerate(G.edges(keys=True, data=True)):
        ui[i] = index[u]
        vi[i] = index[v]
        longueur[i] = float(attrs.get("length", 1.0))
        lden[i] = float(attrs.get("lden", scoring.BRUIT_DEFAUT))
        n_bar[i] = float(attrs.get("n_bar", 0))
        n_marche[i] = float(attrs.get("n_marche", 0))
        n_ecole[i] = float(attrs.get("n_ecole", 0))
        n_commerce[i] = float(attrs.get("n_commerce", 0))
        indice_feat, premier_u = ident_vers_feature[(min(u, v), max(u, v), k)]
        feature[i] = indice_feat
        inverse[i] = u != premier_u  # géométrie stockée dans l'autre sens
        bruit_reel[i] = attrs.get("bruit_origine") == "reel"

    # Regroupement des arêtes parallèles : une entrée par couple (u, v)
    ordre = np.lexsort((vi, ui))
    ui_trie, vi_trie = ui[ordre], vi[ordre]
    nouveaux = np.ones(n_aretes, dtype=bool)
    nouveaux[1:] = (ui_trie[1:] != ui_trie[:-1]) | (vi_trie[1:] != vi_trie[:-1])
    debuts = np.nonzero(nouveaux)[0]

    return {
        "rt_xs": xs, "rt_ys": ys,
        "rt_ui": ui, "rt_vi": vi,
        "rt_longueur": longueur, "rt_lden": lden,
        "rt_n_bar": n_bar, "rt_n_marche": n_marche,
        "rt_n_ecole": n_ecole, "rt_n_commerce": n_commerce,
        "rt_feature": feature, "rt_inverse": inverse, "rt_bruit_reel": bruit_reel,
        "rt_ordre": ordre, "rt_debuts": debuts,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Préparation au démarrage (depuis les tableaux, jamais depuis le graphe)
# ─────────────────────────────────────────────────────────────────────────────

def preparer_routage(tableaux: dict[str, np.ndarray],
                     feat_offsets: np.ndarray,
                     feat_coords: np.ndarray) -> dict[str, Any]:
    """Reconstruit les structures de requête (KD-tree, CSR…) depuis le cache.

    feat_offsets / feat_coords : géométries des features d'affichage
    (polylignes aplaties), partagées avec la heatmap.
    """
    xs, ys = tableaux["rt_xs"], tableaux["rt_ys"]
    # KD-tree en degrés « aplatis » : longitude corrigée par cos(latitude)
    cos_lat = math.cos(math.radians(float(ys.mean())))
    arbre = cKDTree(np.column_stack((xs * cos_lat, ys)))

    ordre = tableaux["rt_ordre"]
    debuts = tableaux["rt_debuts"]
    ui_trie = tableaux["rt_ui"][ordre]
    vi_trie = tableaux["rt_vi"][ordre]
    n_noeuds = len(xs)
    lignes = ui_trie[debuts]
    colonnes = vi_trie[debuts]

    prep = {
        "arbre": arbre, "cos_lat": cos_lat, "n_noeuds": n_noeuds,
        "longueur": tableaux["rt_longueur"], "lden": tableaux["rt_lden"],
        "n_bar": tableaux["rt_n_bar"], "n_marche": tableaux["rt_n_marche"],
        "n_ecole": tableaux["rt_n_ecole"], "n_commerce": tableaux["rt_n_commerce"],
        "feature": tableaux["rt_feature"], "inverse": tableaux["rt_inverse"],
        "bruit_reel": tableaux["rt_bruit_reel"],
        "ordre": ordre, "debuts": debuts,
        "fins": np.append(debuts[1:], len(ordre)),
        "lignes": lignes, "colonnes": colonnes,
        # clé triée du groupe (u, v) pour retrouver une arête par recherche binaire
        "cles_groupes": lignes.astype(np.int64) * n_noeuds + colonnes.astype(np.int64),
        "feat_offsets": feat_offsets, "feat_coords": feat_coords,
    }
    prep["csr_rapide"] = _matrice_couts(prep, prep["longueur"])  # statique
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
    """Plus court chemin (indices internes de nœuds) via Dijkstra scipy."""
    distances, predecesseurs = dijkstra(matrice, directed=True, indices=orig,
                                        return_predecessors=True)
    if not np.isfinite(distances[dest]):
        raise ValueError("aucun itinéraire piéton trouvé entre ces deux points")
    chemin = [dest]
    while chemin[-1] != orig:
        chemin.append(int(predecesseurs[chemin[-1]]))
    chemin.reverse()
    return chemin


def _aretes_du_chemin(prep: dict[str, Any], chemin: list[int],
                      poids: np.ndarray) -> list[int]:
    """Indice d'arête retenu pour chaque saut u → v du chemin.

    `poids` est le même tableau que celui de la matrice du Dijkstra : l'arête
    parallèle choisie est donc exactement celle du plus court chemin.
    """
    cles = prep["cles_groupes"]
    aretes = []
    for a, b in zip(chemin[:-1], chemin[1:]):
        cle = a * prep["n_noeuds"] + b
        groupe = int(np.searchsorted(cles, cle))
        segment = prep["ordre"][prep["debuts"][groupe]:prep["fins"][groupe]]
        aretes.append(int(segment[np.argmin(poids[segment])]))
    return aretes


def _resume_chemin(prep: dict[str, Any], aretes: list[int], heure: int,
                   profil: Profil, jour_semaine: int = 0) -> dict[str, Any]:
    """Agrège distance, durée, exposition, confiance et géométrie d'un chemin."""
    idx = np.array(aretes, dtype=int)
    longueurs = prep["longueur"][idx]
    scores = scoring.score(prep["lden"][idx], prep["n_bar"][idx],
                           prep["n_marche"][idx], prep["n_ecole"][idx],
                           prep["n_commerce"][idx], heure, profil, jour_semaine)
    distance = float(longueurs.sum())
    exposition = float((longueurs * scores).sum())
    confiance_ponderee = float(
        (longueurs * np.where(prep["bruit_reel"][idx], 0.9, 0.5)).sum())

    offsets, plats = prep["feat_offsets"], prep["feat_coords"]
    coords: list[list[float]] = []
    for e in aretes:
        f = int(prep["feature"][e])
        pts = plats[offsets[f]:offsets[f + 1]]
        if prep["inverse"][e]:
            pts = pts[::-1]
        pts = pts.tolist()
        coords.extend(pts if not coords else pts[1:])  # sans doubler les jonctions

    duree_min = distance / 1000.0 / VITESSE_MARCHE_KMH * 60.0
    return {"distance_m": distance, "duree_min": duree_min, "exposition": exposition,
            "confiance_ponderee": confiance_ponderee, "coords": coords}


def _feature(coords: list[list[float]],
             properties: dict[str, Any]) -> dict[str, Any]:
    """Construit une Feature GeoJSON LineString (coordonnées [lon, lat])."""
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": coords},
        "properties": properties,
    }


def calculer_itineraires(prep: dict[str, Any],
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

    scores = scoring.score(prep["lden"], prep["n_bar"], prep["n_marche"],
                           prep["n_ecole"], prep["n_commerce"], heure, profil,
                           jour_semaine)
    poids_calme = prep["longueur"] * (1.0 + beta * scores)
    matrice_calme = _matrice_couts(prep, poids_calme)

    chemin_rapide = _plus_court_chemin(prep, prep["csr_rapide"], orig, dest)
    chemin_calme = _plus_court_chemin(prep, matrice_calme, orig, dest)
    rapide = _resume_chemin(prep, _aretes_du_chemin(prep, chemin_rapide, prep["longueur"]),
                            heure, profil, jour_semaine)
    calme = _resume_chemin(prep, _aretes_du_chemin(prep, chemin_calme, poids_calme),
                           heure, profil, jour_semaine)

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
