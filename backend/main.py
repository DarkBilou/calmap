"""API FastAPI de Calmap : météo sensorielle et itinéraires apaisés.

Le graphe enrichi (data/graph.pkl, produit par pipeline/build_graph.py) est
chargé UNE seule fois au démarrage via le lifespan, puis pré-compilé en
tableaux numpy pour servir la heatmap et la courbe « quand y aller » sans
reparcourir le graphe à chaque requête.
"""
from __future__ import annotations

import math
import pickle
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Optional

import numpy as np
import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

try:  # lancement depuis la racine du repo (uvicorn backend.main:app)
    from backend import routing, scoring
except ImportError:  # lancement depuis backend/ (uvicorn main:app)
    import routing  # type: ignore
    import scoring  # type: ignore

RACINE = Path(__file__).resolve().parents[1]
CHEMIN_GRAPHE = RACINE / "data" / "graph.pkl"
DOSSIER_FRONT = RACINE / "frontend" / "dist"

MARGE_ZONE_DEG = 0.002       # tolérance autour de la zone de démo
RAYON_QUAND_M = 150.0        # rayon d'analyse autour du point pour /api/quand
MAX_CACHE_HEATMAP = 64       # cache des scores par heure/profil
MAX_ARETES_HEATMAP = 20000   # plafond de la réponse heatmap : au-delà (vue large),
                             # les rues sont agrégées en « nuages » par quartier
                             # — la zone entière ferait 27 Mo / 145 000 tronçons ;
                             # 20 000 tronçons gzippés ≈ quelques centaines de Ko
NUAGES_COLONNES = 40         # finesse de la grille d'agrégation des nuages

# État global chargé une seule fois au démarrage (pas de base de données)
ETAT: dict[str, Any] = {"graph": None}
CACHE_SCORES_HEATMAP: dict[tuple[int, float, float], np.ndarray] = {}


# ─────────────────────────────────────────────────────────────────────────────
# Chargement et pré-calculs
# ─────────────────────────────────────────────────────────────────────────────

def _precalculer(G: Any) -> None:
    """Pré-compile les arêtes en tableaux numpy pour /api/heatmap et /api/quand."""
    vues: set[tuple[int, int, int]] = set()
    geometries: list[dict[str, Any]] = []
    lden, n_bar, n_marche, n_ecole, n_commerce = [], [], [], [], []
    longueur: list[float] = []
    mil_lat, mil_lon = [], []
    min_lat, max_lat, min_lon, max_lon = [], [], [], []

    for u, v, k, attrs in G.edges(keys=True, data=True):
        # une seule Feature par tronçon : l'arête inverse du MultiDiGraph est ignorée
        ident = (min(u, v), max(u, v), k)
        if ident in vues:
            continue
        vues.add(ident)

        pts = routing.coords_arete(G, u, v, attrs)
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        geometries.append({"type": "LineString",
                           "coordinates": [[round(x, 6), round(y, 6)] for x, y in pts]})
        lden.append(float(attrs.get("lden", scoring.BRUIT_DEFAUT)))
        longueur.append(float(attrs.get("length", 0.0)))
        n_bar.append(float(attrs.get("n_bar", 0)))
        n_marche.append(float(attrs.get("n_marche", 0)))
        n_ecole.append(float(attrs.get("n_ecole", 0)))
        n_commerce.append(float(attrs.get("n_commerce", 0)))
        milieu = pts[len(pts) // 2]  # point médian de la polyligne (approximation)
        mil_lon.append(milieu[0])
        mil_lat.append(milieu[1])
        min_lon.append(min(xs))
        max_lon.append(max(xs))
        min_lat.append(min(ys))
        max_lat.append(max(ys))

    ETAT.update({
        "geometries": geometries,
        "longueur": np.array(longueur),
        "lden": np.array(lden),
        "n_bar": np.array(n_bar),
        "n_marche": np.array(n_marche),
        "n_ecole": np.array(n_ecole),
        "n_commerce": np.array(n_commerce),
        "mil_lat": np.array(mil_lat),
        "mil_lon": np.array(mil_lon),
        "min_lat": np.array(min_lat),
        "max_lat": np.array(max_lat),
        "min_lon": np.array(min_lon),
        "max_lon": np.array(max_lon),
    })

    # Bornes de la zone de démo (pour valider les coordonnées reçues)
    xs = [d["x"] for _, d in G.nodes(data=True)]
    ys = [d["y"] for _, d in G.nodes(data=True)]
    ETAT["bornes"] = (min(ys) - MARGE_ZONE_DEG, max(ys) + MARGE_ZONE_DEG,
                      min(xs) - MARGE_ZONE_DEG, max(xs) + MARGE_ZONE_DEG)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Charge le graphe une seule fois au démarrage du serveur."""
    if not CHEMIN_GRAPHE.exists():
        message = (f"Graphe introuvable : {CHEMIN_GRAPHE}\n"
                   "Lancez d'abord le pipeline :  python pipeline/build_graph.py")
        print(f"❌ {message}")
        raise RuntimeError(message)
    with open(CHEMIN_GRAPHE, "rb") as f:
        ETAT["graph"] = pickle.load(f)
    _precalculer(ETAT["graph"])
    ETAT["routage"] = routing.preparer_routage(ETAT["graph"])
    print(f"✅ Graphe chargé : {ETAT['graph'].number_of_edges()} arêtes "
          f"(bruit : {ETAT['graph'].graph.get('bruit_source', 'synthetique')})")
    yield


app = FastAPI(title="Calmap API", description="Météo sensorielle & itinéraires apaisés",
              lifespan=lifespan)

# CORS ouvert : le frontend tourne sur un autre port en développement
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"])
# Les réponses heatmap font plusieurs Mo de JSON : le gzip les divise par ~5
app.add_middleware(GZipMiddleware, minimum_size=1024)


# ─────────────────────────────────────────────────────────────────────────────
# Gestion d'erreurs : toujours du JSON {"detail": ...}, jamais de crash
# ─────────────────────────────────────────────────────────────────────────────

@app.exception_handler(RequestValidationError)
async def erreur_validation(_: Request, exc: RequestValidationError) -> JSONResponse:
    """Paramètres non parsables (ex. heure=abc) → 400 au lieu du 422 par défaut."""
    erreurs = exc.errors()
    champ = str(erreurs[0]["loc"][-1]) if erreurs else "?"
    return JSONResponse(status_code=400,
                        content={"detail": f"paramètre invalide : {champ}"})


@app.exception_handler(Exception)
async def erreur_interne(_: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=500, content={"detail": f"erreur interne : {exc}"})


# ─────────────────────────────────────────────────────────────────────────────
# Validation des paramètres (→ 400 avec message explicite)
# ─────────────────────────────────────────────────────────────────────────────

def _valider_heure(heure: int) -> None:
    if not 0 <= heure <= 23:
        raise HTTPException(status_code=400, detail="heure doit être entre 0 et 23")


def _valider_poids(poids_bruit: float, poids_foule: float) -> None:
    if not (0.0 <= poids_bruit <= 1.0 and 0.0 <= poids_foule <= 1.0):
        raise HTTPException(status_code=400,
                            detail="poids_bruit et poids_foule doivent être entre 0 et 1")


def _valider_point(lat: float, lon: float, nom: str) -> None:
    lat_min, lat_max, lon_min, lon_max = ETAT["bornes"]
    if not (lat_min <= lat <= lat_max and lon_min <= lon <= lon_max):
        raise HTTPException(status_code=400,
                            detail=f"coordonnées du point « {nom} » hors de la zone de "
                                   "démo (Paris et Issy-les-Moulineaux)")


def _cle_cache_heatmap(heure: int, poids_bruit: float,
                       poids_foule: float) -> tuple[int, float, float]:
    return (heure, round(poids_bruit, 3), round(poids_foule, 3))


def _scores_heatmap(heure: int, poids_bruit: float,
                    poids_foule: float) -> np.ndarray:
    """Score toutes les aretes une fois par combinaison heure/profil."""
    cle = _cle_cache_heatmap(heure, poids_bruit, poids_foule)
    scores = CACHE_SCORES_HEATMAP.get(cle)
    if scores is None:
        if len(CACHE_SCORES_HEATMAP) >= MAX_CACHE_HEATMAP:
            CACHE_SCORES_HEATMAP.pop(next(iter(CACHE_SCORES_HEATMAP)))
        profil = {"bruit": poids_bruit, "foule": poids_foule}
        scores = scoring.score(ETAT["lden"], ETAT["n_bar"], ETAT["n_marche"],
                               ETAT["n_ecole"], ETAT["n_commerce"], heure, profil)
        CACHE_SCORES_HEATMAP[cle] = scores
    return scores


def _indices_bbox(sud: Optional[float], nord: Optional[float],
                  ouest: Optional[float], est: Optional[float]) -> np.ndarray:
    """Filtre les aretes dont la bbox intersecte la fenetre visible."""
    bornes = (sud, nord, ouest, est)
    if all(valeur is None for valeur in bornes):
        return np.arange(len(ETAT["geometries"]))
    if any(valeur is None for valeur in bornes):
        raise HTTPException(status_code=400, detail="limites de carte incompletes")

    assert sud is not None and nord is not None and ouest is not None and est is not None
    if sud > nord or ouest > est:
        raise HTTPException(status_code=400, detail="limites de carte invalides")

    masque = (
        (ETAT["max_lat"] >= sud)
        & (ETAT["min_lat"] <= nord)
        & (ETAT["max_lon"] >= ouest)
        & (ETAT["min_lon"] <= est)
    )
    return np.nonzero(masque)[0]


def _nuages(indices: np.ndarray, scores: np.ndarray, sud: float, nord: float,
            ouest: float, est: float) -> list[dict[str, Any]]:
    """Agrège les arêtes en « nuages » par cellule de grille (vue dézoomée).

    Chaque nuage est un Point (centre de cellule) avec la demi-taille de la
    cellule : le frontend en fait une image floutée, nappe continue colorée
    par le score moyen (pondéré par la longueur des rues) du quartier. Bien
    plus léger que 145 000 tronçons. Les cellules sans rue (hors de la zone
    modélisée) héritent de la couleur de leurs voisines par diffusion : la
    nappe couvre ainsi tout le rectangle demandé, donc toute la carte.
    """
    lats = ETAT["mil_lat"][indices]
    lons = ETAT["mil_lon"][indices]
    poids = np.maximum(ETAT["longueur"][indices], 1.0)  # pondération par longueur

    lat_moyenne = (sud + nord) / 2.0
    cos_lat = math.cos(math.radians(lat_moyenne))
    pas_lon = max((est - ouest) / NUAGES_COLONNES, 1e-6)
    pas_lat = pas_lon * cos_lat  # cellules ~carrées en mètres
    n_lignes = max(1, int(math.ceil((nord - sud) / pas_lat)))

    colonnes = np.clip(((lons - ouest) / pas_lon).astype(int), 0, NUAGES_COLONNES - 1)
    lignes = np.clip(((lats - sud) / pas_lat).astype(int), 0, n_lignes - 1)
    cellules = lignes * NUAGES_COLONNES + colonnes
    n_cellules = n_lignes * NUAGES_COLONNES

    somme_poids = np.bincount(cellules, weights=poids, minlength=n_cellules)
    somme_scores = np.bincount(cellules, weights=scores[indices] * poids,
                               minlength=n_cellules)
    somme_lden = np.bincount(cellules, weights=ETAT["lden"][indices] * poids,
                             minlength=n_cellules)

    if not np.any(somme_poids > 0):
        return []

    occupees = somme_poids > 0
    score_grille = np.full(n_cellules, np.nan)
    lden_grille = np.full(n_cellules, np.nan)
    score_grille[occupees] = somme_scores[occupees] / somme_poids[occupees]
    lden_grille[occupees] = somme_lden[occupees] / somme_poids[occupees]
    score_grille = _remplir_vides(score_grille.reshape(n_lignes, NUAGES_COLONNES)).ravel()
    lden_grille = _remplir_vides(lden_grille.reshape(n_lignes, NUAGES_COLONNES)).ravel()

    demi_lon = round(pas_lon / 2.0, 6)
    demi_lat = round(pas_lat / 2.0, 6)

    features = []
    for cellule in range(n_cellules):
        ligne, colonne = divmod(cellule, NUAGES_COLONNES)
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point",
                         "coordinates": [round(ouest + (colonne + 0.5) * pas_lon, 6),
                                         round(sud + (ligne + 0.5) * pas_lat, 6)]},
            "properties": {
                "score": float(round(score_grille[cellule], 3)),
                "lden": float(round(lden_grille[cellule], 1)),
                "nuage": True,
                "demi_lon": demi_lon,
                "demi_lat": demi_lat,
            },
        })
    return features


def _remplir_vides(grille: np.ndarray) -> np.ndarray:
    """Propage les valeurs vers les cellules vides (NaN) depuis leurs voisines.

    Diffusion couche par couche (moyenne des 4 voisines connues) : les couleurs
    du bord de la zone modélisée se prolongent en douceur vers l'extérieur.
    """
    while np.isnan(grille).any():
        somme = np.zeros(grille.shape)
        compte = np.zeros(grille.shape)
        for axe, sens in ((0, 1), (0, -1), (1, 1), (1, -1)):
            voisine = np.roll(grille, sens, axis=axe)
            # np.roll boucle sur les bords : on neutralise la rangée revenue
            if axe == 0 and sens == 1:
                voisine[0, :] = np.nan
            elif axe == 0:
                voisine[-1, :] = np.nan
            elif sens == 1:
                voisine[:, 0] = np.nan
            else:
                voisine[:, -1] = np.nan
            connue = ~np.isnan(voisine)
            somme[connue] += voisine[connue]
            compte[connue] += 1
        a_remplir = np.isnan(grille) & (compte > 0)
        if not a_remplir.any():
            break  # sécurité : ne devrait pas arriver sur une grille connexe
        grille[a_remplir] = somme[a_remplir] / compte[a_remplir]
    return grille


def _haversine_m(lats: np.ndarray, lons: np.ndarray, lat: float,
                 lon: float) -> np.ndarray:
    """Distance haversine (m) entre chaque point des tableaux et (lat, lon)."""
    rayon_terre = 6_371_000.0
    dlat = np.radians(lats - lat)
    dlon = np.radians(lons - lon)
    a = np.sin(dlat / 2.0) ** 2 \
        + np.cos(np.radians(lats)) * math.cos(math.radians(lat)) * np.sin(dlon / 2.0) ** 2
    return 2.0 * rayon_terre * np.arcsin(np.sqrt(a))


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints (contrat d'API figé — consommé par le frontend React/Leaflet)
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def api_health() -> dict[str, Any]:
    """État du service et provenance des données de bruit."""
    G = ETAT["graph"]
    return {
        "status": "ok",
        "graph_loaded": G is not None,
        "edges": G.number_of_edges() if G is not None else 0,
        "bruit_source": G.graph.get("bruit_source", "synthetique") if G is not None
        else "synthetique",
    }


@app.get("/api/route")
def api_route(from_lat: float, from_lon: float, to_lat: float, to_lon: float,
              heure: int = 14, poids_bruit: float = 0.5, poids_foule: float = 0.5,
              beta: float = 3.0) -> dict[str, Any]:
    """Double itinéraire rapide / calme avec métriques comparées."""
    _valider_heure(heure)
    _valider_poids(poids_bruit, poids_foule)
    if not 0.0 <= beta <= 20.0:
        raise HTTPException(status_code=400, detail="beta doit être entre 0 et 20")
    _valider_point(from_lat, from_lon, "départ")
    _valider_point(to_lat, to_lon, "arrivée")

    profil = {"bruit": poids_bruit, "foule": poids_foule}
    try:
        return routing.calculer_itineraires(ETAT["graph"], ETAT["routage"],
                                            from_lat, from_lon,
                                            to_lat, to_lon, heure, profil, beta)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/heatmap")
def api_heatmap(heure: int = 14, poids_bruit: float = 0.5,
                poids_foule: float = 0.5, sud: Optional[float] = None,
                nord: Optional[float] = None, ouest: Optional[float] = None,
                est: Optional[float] = None) -> dict[str, Any]:
    """Carte de chaleur sensorielle, limitee a la zone visible si fournie."""
    _valider_heure(heure)
    _valider_poids(poids_bruit, poids_foule)

    scores = _scores_heatmap(heure, poids_bruit, poids_foule)
    indices = _indices_bbox(sud, nord, ouest, est)

    # Vue large : agrégation en nuages transparents par quartier, sinon le
    # navigateur gèlerait à dessiner 145 000 tronçons de rue.
    if len(indices) > MAX_ARETES_HEATMAP:
        lat_min, lat_max, lon_min, lon_max = ETAT["bornes"]
        return {"type": "FeatureCollection",
                "features": _nuages(indices, scores,
                                    sud if sud is not None else lat_min,
                                    nord if nord is not None else lat_max,
                                    ouest if ouest is not None else lon_min,
                                    est if est is not None else lon_max)}

    features = []
    for indice_brut in indices:
        i = int(indice_brut)
        features.append({
            "type": "Feature",
            "geometry": ETAT["geometries"][i],
            "properties": {"score": float(round(scores[i], 3)),
                           "lden": float(round(ETAT["lden"][i], 1))},
        })
    return {"type": "FeatureCollection", "features": features}


@app.get("/api/quand")
def api_quand(lat: float, lon: float, poids_bruit: float = 0.5,
              poids_foule: float = 0.5) -> dict[str, Any]:
    """Courbe « quand y aller » : score moyen par heure autour d'une destination."""
    _valider_poids(poids_bruit, poids_foule)
    _valider_point(lat, lon, "destination")

    distances = _haversine_m(ETAT["mil_lat"], ETAT["mil_lon"], lat, lon)
    masque = distances <= RAYON_QUAND_M
    if not bool(masque.any()):
        raise HTTPException(status_code=400,
                            detail="aucune rue à moins de 150 m du point demandé")

    profil = {"bruit": poids_bruit, "foule": poids_foule}
    scores_horaires = []
    for heure in range(24):
        s = scoring.score(ETAT["lden"][masque], ETAT["n_bar"][masque],
                          ETAT["n_marche"][masque], ETAT["n_ecole"][masque],
                          ETAT["n_commerce"][masque], heure, profil)
        scores_horaires.append({"heure": heure, "score": float(round(np.mean(s), 3))})

    # Fenêtre glissante de 2 h de score moyen minimal, entre 8 h et 21 h
    meilleur_debut, meilleur_score = 8, float("inf")
    for debut in range(8, 20):  # dernier créneau : 19 h - 21 h
        moyenne = (scores_horaires[debut]["score"]
                   + scores_horaires[debut + 1]["score"]) / 2.0
        if moyenne < meilleur_score:
            meilleur_debut, meilleur_score = debut, moyenne

    return {"scores_horaires": scores_horaires,
            "creneau_optimal": {"debut": meilleur_debut, "fin": meilleur_debut + 2}}


NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"


@app.get("/api/adresses")
def api_adresses(q: str = "") -> list[dict[str, Any]]:
    """Recherche d'adresse : proxy Nominatim côté serveur.

    Le navigateur appelait Nominatim en direct : blocages réseau et limites de
    débit le faisaient parfois attendre indéfiniment. Ici : User-Agent propre,
    timeout court, et réponse simplifiée [{id, label, lat, lng}].
    """
    q = q.strip()
    if len(q) < 3:
        return []
    lat_min, lat_max, lon_min, lon_max = ETAT["bornes"]
    try:
        reponse = requests.get(
            NOMINATIM_URL,
            params={"format": "jsonv2", "q": q, "limit": 5, "addressdetails": 1,
                    "accept-language": "fr", "countrycodes": "fr",
                    "viewbox": f"{lon_min},{lat_max},{lon_max},{lat_min}",
                    "bounded": 1},
            headers={"User-Agent": "calmap-demo (hackathon Hi! PARIS)"},
            timeout=5,
        )
        reponse.raise_for_status()
        lieux = reponse.json()
    except Exception as exc:  # réseau, timeout, JSON invalide…
        raise HTTPException(status_code=503,
                            detail="recherche d'adresse indisponible pour le moment") from exc

    resultats = []
    for lieu in lieux:
        try:
            resultats.append({
                "id": lieu.get("place_id") or f"{lieu.get('osm_type')}-{lieu.get('osm_id')}",
                "label": str(lieu["display_name"]),
                "lat": float(lieu["lat"]),
                "lng": float(lieu["lon"]),
            })
        except (KeyError, TypeError, ValueError):
            continue  # entrée incomplète : on l'ignore
    return resultats


@app.get("/api/adresse-inverse")
def api_adresse_inverse(lat: float, lon: float) -> dict[str, Any]:
    """Adresse la plus proche d'un point (proxy Nominatim reverse).

    Renvoie un libellé court et calme (« 10 Rue Oberkampf, Paris ») plutôt que
    le display_name complet, trop long pour les champs de recherche.
    """
    _valider_point(lat, lon, "point")
    try:
        reponse = requests.get(
            NOMINATIM_REVERSE_URL,
            params={"format": "jsonv2", "lat": lat, "lon": lon, "zoom": 18,
                    "accept-language": "fr"},
            headers={"User-Agent": "calmap-demo (hackathon Hi! PARIS)"},
            timeout=5,
        )
        reponse.raise_for_status()
        lieu = reponse.json()
    except Exception as exc:  # réseau, timeout, JSON invalide…
        raise HTTPException(status_code=503,
                            detail="adresse introuvable pour le moment") from exc

    adresse = lieu.get("address") or {}
    rue = " ".join(partie for partie in (
        adresse.get("house_number"),
        adresse.get("road") or adresse.get("pedestrian") or adresse.get("footway"),
    ) if partie)
    ville = adresse.get("city") or adresse.get("town") or adresse.get("municipality") or ""
    label = ", ".join(partie for partie in (rue, ville) if partie) \
        or str(lieu.get("display_name") or "")
    return {"label": label}


# Frontend buildé servi sur "/" s'il existe (ignoré silencieusement sinon).
# Monté APRÈS les routes /api/* pour ne pas les masquer.
if DOSSIER_FRONT.is_dir():
    app.mount("/", StaticFiles(directory=str(DOSSIER_FRONT), html=True),
              name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
