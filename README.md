# Calmap — météo sensorielle & itinéraires apaisés 🧭

Backend du projet **Calmap** (hackathon Hi! PARIS × Capgemini, « IA et handicap ») :
prédiction de la charge sensorielle (bruit, foule) des rues et itinéraires piétons
apaisés pour les personnes autistes. Zone de démo : quartier des Halles, Paris.

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
curl "http://localhost:8000/api/heatmap?heure=18&poids_bruit=0.7&poids_foule=0.5"
```

FeatureCollection GeoJSON : une LineString par arête, `properties`
`{"score": 0.34, "lden": 63.1}`. Sous-échantillonnée au-delà de 8000 arêtes.

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

## Déploiement en ligne (Render, gratuit)

`frontend/dist/` et `data/graph.pkl` sont commités dans le dépôt : l'hébergeur
n'a besoin que de Python (pas de Node), donc le déploiement se résume à
installer `requirements.txt` et lancer `uvicorn`. Le fichier [render.yaml](render.yaml)
décrit tout ça.

1. Le dépôt GitHub doit être **public** (Settings → tout en bas → Danger Zone
   → Change visibility → Make public).
2. Créer un compte sur [render.com](https://render.com) (gratuit, email suffit).
3. **New +** → **Blueprint** → connecter ce dépôt GitHub → Render détecte
   `render.yaml` et propose le service `calmap` → **Apply**.
4. Premier déploiement : quelques minutes. L'URL finale ressemble à
   `https://calmap-xxxx.onrender.com`.

> Sur le plan gratuit, le service se met en veille après 15 min d'inactivité :
> la première requête qui le réveille prend ~30-50 secondes, les suivantes
> sont normales. Ce n'est pas un bug.

**Avant de redéployer un changement du frontend**, il faut reconstruire et
recommiter `frontend/dist` (l'hébergeur ne le fait pas à ta place) :

```bash
cd frontend && npm run build && cd ..
git add frontend/dist data/graph.pkl
git commit -m "Rebuild frontend pour déploiement"
git push
```

Render redéploie automatiquement à chaque push sur la branche configurée
(`ajout-frontend` dans `render.yaml` — à changer si tu fusionnes vers `main`).
