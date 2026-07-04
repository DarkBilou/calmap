"""Pipeline hors ligne Calmap : construit le graphe piéton enrichi du quartier de démo.

Étapes :
1. Télécharge le graphe piéton OSM (quartier des Halles, Paris) via OSMnx.
2. Compte les POI générateurs de charge sensorielle à moins de 50 m de chaque arête.
3. Attribue un bruit Lden par arête : données Bruitparif si data/bruit_lden.geojson
   existe, sinon bruit synthétique dérivé du type de voie OSM — le projet tourne
   sans aucune donnée externe.
4. Sauvegarde le graphe enrichi dans data/graph.pkl.

Usage : python pipeline/build_graph.py
"""
from __future__ import annotations

import pickle
import sys
from pathlib import Path

import geopandas as gpd
import networkx as nx
import numpy as np
import osmnx as ox
import pandas as pd

RACINE = Path(__file__).resolve().parents[1]
DOSSIER_DATA = RACINE / "data"
FICHIER_GRAPHE = DOSSIER_DATA / "graph.pkl"
FICHIER_BRUIT = DOSSIER_DATA / "bruit_lden.geojson"

# Zone de démo : quartier des Halles, Paris
SUD, NORD, OUEST, EST = 48.858, 48.866, 2.340, 2.352
RAYON_POI_M = 50.0  # rayon de comptage des POI autour de chaque arête

# POI générateurs de charge sensorielle, regroupés en 4 catégories
TAGS_POI: dict[str, list[str]] = {
    "amenity": ["bar", "pub", "restaurant", "marketplace", "school"],
    "shop": ["mall"],
}
CATEGORIES = ("n_bar", "n_marche", "n_ecole", "n_commerce")

# Bruit synthétique de repli : Lden typique (dB) par type de voie OSM
BRUIT_PAR_VOIE: dict[str, float] = {
    "motorway": 75.0, "trunk": 74.0,
    "primary": 72.0, "secondary": 68.0, "tertiary": 64.0,
    "unclassified": 60.0, "residential": 58.0,
    "living_street": 55.0, "service": 56.0, "cycleway": 54.0,
    "pedestrian": 52.0, "footway": 52.0, "path": 50.0, "steps": 50.0,
}
BRUIT_DEFAUT = 60.0
ECART_TYPE_BRUIT = 2.0  # bruit gaussien ajouté au Lden synthétique


def telecharger_graphe() -> nx.MultiDiGraph:
    """Télécharge le graphe piéton OSM de la zone de démo (en WGS84)."""
    print("⏳ Téléchargement du graphe piéton (OSMnx / Overpass)…")
    bbox = (OUEST, SUD, EST, NORD)  # ordre OSMnx ≥ 2 : (left, bottom, right, top)
    return ox.graph_from_bbox(bbox, network_type="walk")


def _categorie(ligne: pd.Series) -> str | None:
    """Associe un POI OSM à l'une des 4 catégories de charge sensorielle."""
    amenity = ligne.get("amenity")
    if amenity in ("bar", "pub", "restaurant"):
        return "n_bar"
    if amenity == "marketplace":
        return "n_marche"
    if amenity == "school":
        return "n_ecole"
    if ligne.get("shop") == "mall":
        return "n_commerce"
    return None


def compter_pois(aretes: gpd.GeoDataFrame) -> None:
    """Ajoute aux arêtes le nombre de POI de chaque catégorie à moins de 50 m."""
    for cat in CATEGORIES:
        aretes[cat] = 0
    print("⏳ Téléchargement des POI générateurs de charge…")
    try:
        bbox = (OUEST, SUD, EST, NORD)
        pois = ox.features_from_bbox(bbox, TAGS_POI)
    except Exception as exc:  # zone sans POI ou Overpass indisponible
        print(f"⚠️  POI indisponibles ({exc}) : comptes laissés à 0.")
        return

    pois = pois.to_crs(aretes.crs)
    pois["geometry"] = pois.geometry.centroid  # un point même pour les polygones
    pois["categorie"] = pois.apply(_categorie, axis=1)
    pois = pois[pois["categorie"].notna()]
    if pois.empty:
        print("⚠️  Aucun POI pertinent trouvé : comptes laissés à 0.")
        return
    print(f"   POI retenus : {pois['categorie'].value_counts().to_dict()}")

    # Tampon de 50 m autour de chaque arête puis jointure spatiale avec les POI
    tampons = gpd.GeoDataFrame(geometry=aretes.geometry.buffer(RAYON_POI_M), crs=aretes.crs)
    jointure = gpd.sjoin(pois[["categorie", "geometry"]], tampons,
                         predicate="within", how="inner")
    comptes = jointure.groupby(["index_right", "categorie"]).size().unstack(fill_value=0)
    for cat in CATEGORIES:
        if cat in comptes.columns:
            aretes[cat] = comptes[cat].reindex(aretes.index, fill_value=0).astype(int)


def bruit_reel(aretes: gpd.GeoDataFrame) -> tuple[pd.Series, pd.Series]:
    """Jointure spatiale avec la carte Bruitparif : Lden max des polygones croisés."""
    bruit = gpd.read_file(FICHIER_BRUIT)
    if bruit.crs is None:
        bruit = bruit.set_crs(4326)  # CRS par défaut du GeoJSON
    bruit = bruit.to_crs(aretes.crs)
    bruit["DB_LOW"] = pd.to_numeric(bruit["DB_LOW"], errors="coerce")

    jointure = gpd.sjoin(aretes[["geometry"]], bruit[["DB_LOW", "geometry"]],
                         how="left", predicate="intersects")
    # une arête peut croiser plusieurs polygones : on garde le Lden max
    lden = jointure.groupby(level=0)["DB_LOW"].max().reindex(aretes.index)
    if lden.notna().sum() == 0:
        raise ValueError("aucune intersection entre les arêtes et la carte de bruit")

    origine = pd.Series(np.where(lden.notna(), "reel", "synthetique"), index=aretes.index)
    lden = lden.fillna(lden.median())  # NaN remplis par la médiane
    return lden, origine


def bruit_synthetique(aretes: gpd.GeoDataFrame) -> tuple[pd.Series, pd.Series]:
    """Lden plausible dérivé du type de voie OSM, avec bruit gaussien σ=2."""
    def base(voie: object) -> float:
        if isinstance(voie, list):  # OSM peut porter plusieurs valeurs highway
            voie = voie[0]
        return BRUIT_PAR_VOIE.get(str(voie), BRUIT_DEFAUT)

    if "highway" in aretes.columns:
        niveaux = aretes["highway"].apply(base)
    else:
        niveaux = pd.Series(BRUIT_DEFAUT, index=aretes.index)
    rng = np.random.default_rng(42)  # reproductible d'un lancement à l'autre
    lden = niveaux + rng.normal(0.0, ECART_TYPE_BRUIT, len(aretes))
    origine = pd.Series("synthetique", index=aretes.index)
    return pd.Series(lden, index=aretes.index), origine


def calculer_bruit(aretes: gpd.GeoDataFrame) -> tuple[pd.Series, pd.Series, str]:
    """Retourne (lden, origine par arête, source globale 'reel'|'synthetique')."""
    if FICHIER_BRUIT.exists():
        try:
            lden, origine = bruit_reel(aretes)
            print(f"✅ Bruit réel appliqué depuis {FICHIER_BRUIT.name} "
                  f"({(origine == 'reel').sum()}/{len(aretes)} arêtes couvertes).")
            return lden, origine, "reel"
        except Exception as exc:
            print(f"⚠️  Lecture de {FICHIER_BRUIT.name} impossible ({exc}) : "
                  "repli sur le bruit synthétique.")
    else:
        print("⚠️  data/bruit_lden.geojson ABSENT : bruit SYNTHÉTIQUE généré depuis le "
              "type de voie OSM.\n    (Déposez la carte Bruitparif pour des données "
              "réelles — voir data/README.md.)")
    lden, origine = bruit_synthetique(aretes)
    return lden, origine, "synthetique"


def main() -> None:
    if int(ox.__version__.split(".")[0]) < 2:
        sys.exit("OSMnx >= 2.0 est requis : pip install -r requirements.txt")
    DOSSIER_DATA.mkdir(exist_ok=True)

    G = telecharger_graphe()
    print(f"   {G.number_of_nodes()} nœuds, {G.number_of_edges()} arêtes")

    # Projection en mètres pour les opérations spatiales (tampons, jointures)
    Gp = ox.project_graph(G)
    aretes = ox.graph_to_gdfs(Gp, nodes=False).reset_index()  # colonnes u, v, key

    compter_pois(aretes)
    lden, origine, source = calculer_bruit(aretes)
    aretes["lden"] = lden
    aretes["bruit_origine"] = origine

    # Écriture des attributs sur le graphe d'origine (WGS84), clés (u, v, key)
    cles = list(zip(aretes["u"], aretes["v"], aretes["key"]))
    for cat in CATEGORIES:
        nx.set_edge_attributes(G, {c: int(x) for c, x in zip(cles, aretes[cat])}, cat)
    nx.set_edge_attributes(G, {c: float(x) for c, x in zip(cles, aretes["lden"])}, "lden")
    nx.set_edge_attributes(G, dict(zip(cles, aretes["bruit_origine"])), "bruit_origine")
    G.graph["bruit_source"] = source

    with open(FICHIER_GRAPHE, "wb") as f:
        pickle.dump(G, f)
    print(f"✅ Graphe enrichi sauvegardé : {FICHIER_GRAPHE} (bruit : {source})")
    print("   Lancez le serveur : uvicorn backend.main:app --port 8000")


if __name__ == "__main__":
    main()
