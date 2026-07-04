# Calmap

## Presentation du projet

Calmap est une application web mobile-first qui aide a trouver des itineraires pietons plus calmes dans Paris et Issy-les-Moulineaux. Le projet combine une carte interactive, une estimation de la charge sensorielle des rues et un calcul d'itineraire qui compare un trajet rapide avec un trajet optimise pour limiter l'exposition au bruit et a la foule.

Le projet a ete pense pour un public autiste ou sensible aux environnements charges. L'interface reste donc volontairement simple, calme et lisible : peu d'animations, textes courts, gros boutons, couleurs limitees et messages d'erreur clairs.

## Objectifs

- Afficher une carte de chaleur de la charge sensorielle des rues.
- Permettre de poser un point de depart et un point d'arrivee sur la carte.
- Calculer deux itineraires : un rapide et un optimise.
- Comparer la duree, la distance et l'exposition sensorielle.
- Conseiller les heures les plus calmes pour se rendre a un endroit.
- Proposer une experience utilisable sur mobile sous forme de PWA.

## Fonctionnalites principales

### Onglet Carte

L'utilisateur peut choisir un depart et une arrivee directement sur la carte. L'application affiche ensuite :

- l'itineraire rapide en noir ;
- l'itineraire optimise en bleu ;
- une carte de chaleur qui represente les zones plus calmes ou plus animees ;
- une comparaison entre les deux trajets.

### Onglet Quand y aller

L'utilisateur selectionne un lieu sur une mini-carte. L'application analyse les scores horaires autour de ce point et propose le meilleur creneau de deux heures entre 8 h et 21 h.

### Onglet Mon profil

L'utilisateur peut regler sa sensibilite au bruit et a la foule. Ces preferences influencent les scores sensoriels et donc le calcul de l'itineraire optimise.

## Technologies utilisees

### Backend

- Python 3.11+
- FastAPI
- Uvicorn
- OSMnx
- NetworkX
- GeoPandas
- NumPy
- Shapely

### Frontend

- React 18
- Vite
- Leaflet
- React Leaflet
- PWA avec manifest et service worker

## Architecture

```text
calmap/
|-- backend/
|   |-- main.py          # API FastAPI et exposition des endpoints
|   |-- routing.py       # calcul des itineraires rapide et optimise
|   |-- scoring.py       # calcul du score sensoriel
|   `-- test_api.py      # tests de fumee de l'API
|
|-- frontend/
|   |-- src/
|   |   |-- App.jsx
|   |   |-- api.js
|   |   |-- config.js
|   |   |-- carte-utils.jsx
|   |   |-- tabs/
|   |   |   |-- CarteTab.jsx
|   |   |   |-- QuandTab.jsx
|   |   |   `-- ProfilTab.jsx
|   |   `-- components/
|   |-- public/
|   `-- package.json
|
|-- pipeline/
|   `-- build_graph.py   # generation du graphe pieton
|
|-- data/
|   |-- graph.pkl        # graphe genere
|   `-- README.md
|
|-- requirements.txt
`-- README.md
```

## Donnees

Le pipeline construit un graphe pieton a partir d'OpenStreetMap pour la zone de demonstration. Si une carte Bruitparif est presente dans `data/bruit_lden.geojson`, elle est utilisee pour enrichir les scores de bruit. Sinon, le projet genere une estimation synthetique basee sur le type de voie.

Le fichier `data/graph.pkl` doit exister avant de lancer le serveur backend.

## Lancement du projet

### 1. Installer les dependances Python

Depuis la racine du projet :

```powershell
py -m pip install -r requirements.txt
```

### 2. Generer le graphe

```powershell
py pipeline\build_graph.py
```

### 3. Lancer le backend

```powershell
py -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

L'API est disponible ici :

```text
http://localhost:8000/docs
```

### 4. Lancer le frontend

Dans un deuxieme terminal :

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

L'application est disponible ici :

```text
http://localhost:5173
```

ou :

```text
http://127.0.0.1:5173
```

## API principale

### `GET /api/health`

Verifie que le backend fonctionne et que le graphe est charge.

### `GET /api/heatmap`

Retourne les scores sensoriels des rues sous forme de GeoJSON.
Le frontend envoie les limites visibles de la carte (`sud`, `nord`, `ouest`,
`est`) pour ne recuperer que les rues affichees. Les scores sont caches par
heure et par profil sensoriel.

### `GET /api/route`

Calcule deux itineraires entre un point de depart et un point d'arrivee :

- un itineraire rapide ;
- un itineraire optimise selon le bruit et la foule.

### `GET /api/quand`

Analyse les scores autour d'un point et retourne les meilleurs horaires pour s'y rendre.

## Utilisation sur mobile

Calmap est une PWA. Pour tester rapidement sur telephone, il faut que le telephone et l'ordinateur soient sur le meme reseau Wi-Fi, puis ouvrir l'adresse du serveur depuis le navigateur mobile.

Pour une installation PWA complete sur Android, la methode la plus fiable consiste a utiliser `adb reverse`, puis a ouvrir `http://localhost:8000` sur le telephone apres avoir genere le build de production.

## Tests

Une fois le backend lance :

```powershell
py backend\test_api.py
```

Ce script appelle les endpoints principaux et verifie que les reponses respectent le format attendu.

## Points forts du projet

- Application utilisable sur ordinateur et mobile.
- Interface calme et accessible.
- Calcul d'itineraire personnalise selon le profil sensoriel.
- Backend simple, sans base de donnees.
- Donnees generees automatiquement si aucune source de bruit reelle n'est fournie.
- Architecture separee entre pipeline, backend et frontend.
