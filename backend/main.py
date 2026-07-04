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
from typing import Any, AsyncIterator

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
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
MAX_ARETES_HEATMAP = 8000    # sous-échantillonnage de la heatmap au-delà

# État global chargé une seule fois au démarrage (pas de base de données)
ETAT: dict[str, Any] = {"graph": None}


# ─────────────────────────────────────────────────────────────────────────────
# Chargement et pré-calculs
# ─────────────────────────────────────────────────────────────────────────────

def _precalculer(G: Any) -> None:
    """Pré-compile les arêtes en tableaux numpy pour /api/heatmap et /api/quand."""
    vues: set[tuple[int, int, int]] = set()
    geometries: list[dict[str, Any]] = []
    lden, n_bar, n_marche, n_ecole, n_commerce = [], [], [], [], []
    mil_lat, mil_lon = [], []

    for u, v, k, attrs in G.edges(keys=True, data=True):
        # une seule Feature par tronçon : l'arête inverse du MultiDiGraph est ignorée
        ident = (min(u, v), max(u, v), k)
        if ident in vues:
            continue
        vues.add(ident)

        pts = routing.coords_arete(G, u, v, attrs)
        geometries.append({"type": "LineString",
                           "coordinates": [[round(x, 6), round(y, 6)] for x, y in pts]})
        lden.append(float(attrs.get("lden", scoring.BRUIT_DEFAUT)))
        n_bar.append(float(attrs.get("n_bar", 0)))
        n_marche.append(float(attrs.get("n_marche", 0)))
        n_ecole.append(float(attrs.get("n_ecole", 0)))
        n_commerce.append(float(attrs.get("n_commerce", 0)))
        milieu = pts[len(pts) // 2]  # point médian de la polyligne (approximation)
        mil_lon.append(milieu[0])
        mil_lat.append(milieu[1])

    ETAT.update({
        "geometries": geometries,
        "lden": np.array(lden),
        "n_bar": np.array(n_bar),
        "n_marche": np.array(n_marche),
        "n_ecole": np.array(n_ecole),
        "n_commerce": np.array(n_commerce),
        "mil_lat": np.array(mil_lat),
        "mil_lon": np.array(mil_lon),
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
    print(f"✅ Graphe chargé : {ETAT['graph'].number_of_edges()} arêtes "
          f"(bruit : {ETAT['graph'].graph.get('bruit_source', 'synthetique')})")
    yield


app = FastAPI(title="Calmap API", description="Météo sensorielle & itinéraires apaisés",
              lifespan=lifespan)

# CORS ouvert : le frontend tourne sur un autre port en développement
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"])


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
                                   "démo (quartier des Halles, Paris)")


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
        return routing.calculer_itineraires(ETAT["graph"], from_lat, from_lon,
                                            to_lat, to_lon, heure, profil, beta)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/heatmap")
def api_heatmap(heure: int = 14, poids_bruit: float = 0.5,
                poids_foule: float = 0.5) -> dict[str, Any]:
    """Carte de chaleur sensorielle : une Feature LineString par arête."""
    _valider_heure(heure)
    _valider_poids(poids_bruit, poids_foule)

    profil = {"bruit": poids_bruit, "foule": poids_foule}
    scores = scoring.score(ETAT["lden"], ETAT["n_bar"], ETAT["n_marche"],
                           ETAT["n_ecole"], ETAT["n_commerce"], heure, profil)

    n = len(scores)
    pas = max(1, math.ceil(n / MAX_ARETES_HEATMAP))  # sous-échantillonnage si > 8000
    features = [
        {
            "type": "Feature",
            "geometry": ETAT["geometries"][i],
            "properties": {"score": float(round(scores[i], 3)),
                           "lden": float(round(ETAT["lden"][i], 1))},
        }
        for i in range(0, n, pas)
    ]
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


# Frontend buildé servi sur "/" s'il existe (ignoré silencieusement sinon).
# Monté APRÈS les routes /api/* pour ne pas les masquer.
if DOSSIER_FRONT.is_dir():
    app.mount("/", StaticFiles(directory=str(DOSSIER_FRONT), html=True),
              name="frontend")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
