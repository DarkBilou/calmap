# Calmap — météo sensorielle & itinéraires apaisés 🧭

Backend du projet **Calmap** (hackathon Hi! PARIS × Capgemini, « IA et handicap ») :
prédiction de la charge sensorielle (bruit, foule) des rues et itinéraires piétons
apaisés pour les personnes autistes. Zone de démo : Paris + Issy-les-Moulineaux.

## Lancement (3 commandes)

Depuis la racine `calmap/`, avec Python 3.11+ :

```bash
pip install -r requirements.txt
python pipeline/build_graph.py          # ~1-2 min : télécharge et enrichit le graphe OSM
uvicorn backend.main:app --port 8000
```

Documentation interactive : http://localhost:8000/docs

> **Aucune donnée externe requise.** Si `data/bruit_lden.geojson` (carte Bruitparif,
> colonne `DB_LOW`) est présent, le pipeline l'utilise (confiance 0.9) ; sinon il
> génère un bruit synthétique plausible depuis le type de voie OSM (confiance 0.5)
> et l'indique par un warning. Voir [data/README.md](data/README.md).

## Endpoints

### `GET /api/health`

```bash
curl "http://localhost:8000/api/health"
# {"status":"ok","graph_loaded":true,"edges":3421,"bruit_source":"synthetique"}
```

### `GET /api/route` — double itinéraire rapide / calme

```bash
curl "http://localhost:8000/api/route?from_lat=48.8610&from_lon=2.3430&to_lat=48.8645&to_lon=2.3490&heure=18&poids_bruit=0.7&poids_foule=0.5&beta=3.0"
```

Retourne pour chaque itinéraire une Feature GeoJSON LineString + `distance_m`,
`duree_min` (4,5 km/h), `exposition` (Σ length×S) ; le calme ajoute
`delta_duree_min` et `delta_exposition_pct` vs rapide ; plus une `confiance`
globale ∈ [0,1].

### `GET /api/heatmap` — carte de chaleur sensorielle

```bash
curl "http://localhost:8000/api/heatmap?heure=18&poids_bruit=0.7&poids_foule=0.5&sud=48.858&nord=48.866&ouest=2.340&est=2.352"
```

FeatureCollection GeoJSON : une LineString par arête visible, `properties`
`{"score": 0.34, "lden": 63.1}`. Les paramètres `sud`, `nord`, `ouest`, `est`
sont optionnels ; sans eux, toutes les arêtes du graphe sont renvoyées. Les
scores sont mis en cache par heure et profil sensoriel.

### `GET /api/quand` — courbe « quand y aller »

```bash
curl "http://localhost:8000/api/quand?lat=48.8620&lon=2.3450&poids_bruit=0.7&poids_foule=0.5"
```

24 scores horaires (moyenne des arêtes à moins de 150 m) et `creneau_optimal`
(fenêtre de 2 h la plus calme entre 8 h et 21 h).

**Erreurs** : coordonnées hors zone ou paramètres invalides → `400` avec
`{"detail": "..."}`. Le serveur ne crashe jamais.

## Tests

Serveur lancé, puis :

```bash
python backend/test_api.py
```

Appelle les 4 endpoints et vérifie les schémas de réponse (requests + asserts).

## Architecture

```
calmap/
├── pipeline/build_graph.py   # offline : graphe OSMnx + POI + bruit → data/graph.pkl
├── data/                     # graph.pkl (généré) + bruit_lden.geojson (optionnel)
└── backend/
    ├── main.py               # FastAPI : endpoints, chargement unique au démarrage
    ├── scoring.py            # score sensoriel S(e,h,p) = bruit + foule, vectorisé
    ├── routing.py            # plus courts chemins rapide (length) / calme (length×(1+βS))
    └── test_api.py           # test de fumée du contrat d'API
```

Notes :
- Graphe chargé **une fois** au démarrage (lifespan FastAPI) puis pré-compilé en
  tableaux numpy — aucune base de données.
- CORS ouvert (`allow_origins=["*"]`) pour le développement du frontend.
- Si `frontend/dist/` existe, il est servi sur `/` (sinon ignoré silencieusement).
- Si `data/graph.pkl` manque au démarrage, le serveur s'arrête avec un message
  indiquant de lancer `python pipeline/build_graph.py`.
