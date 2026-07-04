# Calmap — frontend

PWA mobile-first (React 18 + Vite + Leaflet) de **Calmap** : heatmap sensorielle,
itinéraires apaisés et heures conseillées, pensée pour un public autiste.
Elle consomme l'API FastAPI du dossier `backend/` (contrat décrit dans
[../CLAUDE.md](../CLAUDE.md) et [../README.md](../README.md)).

## Prérequis

- Node.js ≥ 18 (testé avec Node 22)
- Le backend lancé sur le port 8000 (voir README racine) : le frontend n'a
  aucune donnée en propre.

## Installation & développement

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173, /api/* relayé vers :8000 (proxy Vite)
```

`API_BASE_URL` (dans [src/config.js](src/config.js)) vaut `""` par défaut :
chemins relatifs, valables en dev (proxy) comme en production. Pour viser un
autre backend sans proxy :

```bash
VITE_API_BASE_URL=http://192.168.1.10:8000 npm run dev
```

## Build de production

```bash
npm run build        # produit frontend/dist
```

`backend/main.py` sert automatiquement `frontend/dist` sur `/` : après le
build, tout tourne sur un seul port :

```bash
cd ..
uvicorn backend.main:app --port 8000
# → http://localhost:8000 : app + API
```

## Tester sur un vrai téléphone Android

Le service worker et l'installation PWA exigent un **contexte sécurisé**
(HTTPS ou `localhost`). Deux méthodes :

### Méthode recommandée : câble USB + `adb reverse`

`localhost` reste un contexte sécurisé sur le téléphone → PWA complète
(service worker, installation, hors-ligne).

1. Active le débogage USB sur le téléphone, branche-le, puis :
   ```bash
   npm run build
   uvicorn backend.main:app --port 8000     # depuis la racine calmap/
   adb reverse tcp:8000 tcp:8000
   ```
2. Sur le téléphone, ouvre **http://localhost:8000** dans Chrome.
3. Menu ⋮ → **Installer l'application** (ou « Ajouter à l'écran d'accueil »).
   L'app s'ouvre alors en plein écran, sans barre d'adresse.

### Méthode rapide : Wi-Fi local (sans installation PWA)

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Puis ouvre `http://<IP-du-Mac>:8000` (IP via `ipconfig getifaddr en0`) dans
Chrome Android — téléphone et ordinateur sur le même Wi-Fi. L'app fonctionne
intégralement ; seuls le service worker et l'installation « riche » sont
désactivés par Chrome en HTTP non-localhost (un raccourci écran d'accueil
reste possible).

## Structure

```
frontend/
├── public/            # manifest PWA, service worker, icônes (générées)
│   └── sw.js          # réseau d'abord, cache en secours ; /api jamais caché
├── scripts/icones.mjs # régénère les icônes PNG (node scripts/icones.mjs)
└── src/
    ├── config.js      # API_BASE_URL, zone de démo, couleur d'accent
    ├── api.js         # fetch + messages d'erreur calmes (jamais d'écran blanc)
    ├── profil.jsx     # profil sensoriel : contexte React + localStorage
    ├── couleurs.js    # dégradé du score : #2A9D8F → #E9C46A → #E76F51
    ├── carte-utils.jsx# fond de carte, couche GeoJSON, taps, invalidateSize
    ├── components/    # TabBar, HourSlider, Histogramme (fait main), MessageCalme
    └── tabs/          # CarteTab, QuandTab, ProfilTab
```

## Principes de design (public autiste)

Voir [../CLAUDE.md](../CLAUDE.md). En bref : une seule couleur d'accent
(#2A9D8F), aucune animation ni élément clignotant, pas de popup surprise,
textes courts ≥ 16 px, contrastes AA, cibles tactiles ≥ 44 px, erreurs
affichées calmement dans le flux de l'interface.
