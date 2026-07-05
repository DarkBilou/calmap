# Calmap

Météo sensorielle & itinéraires piétons apaisés pour personnes autistes
(hackathon Hi! PARIS × Capgemini, « IA et handicap »). Zone de démo :
Paris + Issy-les-Moulineaux. Aucune base de données, aucun compte utilisateur.

## Architecture & stack

```
pipeline/build_graph.py   # offline : graphe piéton OSMnx + POI + bruit → data/graph.pkl (~1-2 min)
backend/                  # FastAPI (Python) — graphe chargé 1 fois au démarrage, pré-compilé en numpy
frontend/                 # PWA React 18 + Vite (JavaScript) + Leaflet/react-leaflet, CSS pur
data/graph.pkl            # généré ; bruit Bruitparif réel si data/bruit_lden.geojson présent, sinon synthétique
```

- **Backend** : `uvicorn backend.main:app --port 8000`. Sert aussi `frontend/dist`
  sur `/` s'il existe. Tests de fumée : `python backend/test_api.py` (serveur lancé).
- **Frontend** : `cd frontend && npm install && npm run build` (dev : `npm run dev`,
  proxy Vite `/api` → :8000). Node ≥ 18 requis. Détails téléphone Android
  (adb reverse, PWA) : `frontend/README.md`.
- Score sensoriel `S(e, h, profil) ∈ [0,1]` (backend/scoring.py) : bruit Lden
  normalisé × profil horaire de trafic + POI (bars, marchés, écoles, commerces)
  × leurs profils horaires. Itinéraire calme : coût `length × (1 + β·S)`, β = 3 par défaut.

## Contrat d'API (FIGÉ — le frontend en dépend, ne pas le changer)

Erreurs : toujours `{"detail": "message en français"}`, 400 pour paramètres
invalides ou point hors zone. Le serveur ne crashe jamais.

| Endpoint | Paramètres | Réponse |
|---|---|---|
| `GET /api/health` | — | `{status, graph_loaded, edges, bruit_source: "reel"\|"synthetique"}` |
| `GET /api/heatmap` | `heure` 0-23, `poids_bruit` 0-1, `poids_foule` 0-1, `sud/nord/ouest/est` optionnels | FeatureCollection, `properties: {score, lden}` ; rues (LineString) découpées en ovale autour de Paris ; au-delà de 20 000 tronçons visibles (vue large), « nuages » agrégés par quartier (Point + `nuage: true`, `demi_lat`/`demi_lon`) rendus côté client en une image floutée transparente (fondu continu) ; réponses gzippées ; scores caches par heure/profil |
| `GET /api/route` | `from_lat/lon`, `to_lat/lon`, `heure`, `poids_bruit`, `poids_foule`, `beta` | `{rapide: {geojson, distance_m, duree_min, exposition}, calme: {idem + delta_duree_min, delta_exposition_pct}, confiance}` |
| `GET /api/quand` | `lat`, `lon`, `poids_bruit`, `poids_foule` | `{scores_horaires: [{heure, score}×24], creneau_optimal: {debut, fin}}` (rues < 150 m, créneau 2 h entre 8 h et 21 h) |

`confiance` : 0,9 = bruit mesuré (Bruitparif), 0,5 = synthétique. Si
`bruit_source = "synthetique"`, le frontend affiche le bandeau « Démo : bruit simulé ».

## Frontend — 3 onglets

1. **Carte** : heatmap (`/api/heatmap`) recolorée selon curseur horaire 0-23 h ;
   mode itinéraire à 2 taps → `/api/route` → tracé rapide (gris pointillé) +
   calme (vert épais) + bottom sheet comparatif (Δ durée, Δ exposition, badge fiabilité).
2. **Quand y aller** : tap sur mini-carte → `/api/quand` → histogramme 24 barres
   fait main (divs CSS, pas de lib de charts), créneau optimal surligné (même
   s'il est passé), heures passées grisées, valeurs exactes dans un `<details>`.
3. **Mon profil** : curseurs Bruit (défaut 70) / Foule (défaut 50), bascule
   « Journée difficile » (poids × 1,3 plafonnés à 1). **localStorage uniquement**
   (`calmap.profil.v1`) — le profil alimente les onglets 1 et 2 via un contexte React.

Les 3 onglets restent montés (cartes Leaflet conservées) ; `invalidateSize()`
à chaque réaffichage. PWA : manifest + `public/sw.js` (réseau d'abord, cache en
secours, `/api` jamais mis en cache). Icônes régénérables : `node frontend/scripts/icones.mjs`.

## Principes de design (public autiste — cœur du sujet, à respecter partout)

- **Calme visuel** : une seule couleur d'accent `#2A9D8F` ; le dégradé de données
  vert `#2A9D8F` → sable `#E9C46A` → orange `#E76F51` est réservé à la heatmap.
- **Aucune animation, aucune transition, aucun élément clignotant.** Pas de
  popup, toast ni changement d'écran surprise : tout apparaît en place, dans le flux.
- **Textes courts et simples**, tutoiement, ≥ 16 px (base 17 px).
- **Contrastes AA** : texte sur fond via tokens (`--encre` #1F2933, `--encre-2`
  #52606D). `#2A9D8F` ne passe pas AA en texte → utiliser `--accent-texte`
  #1D7A6E (5,0:1) pour tout texte/focus accentué ; #2A9D8F sert aux remplissages.
- **Cibles tactiles ≥ 44 px**, utilisable à une main (commandes en bas ou
  atteignables au pouce).
- **Erreurs réseau/400 : message calme dans l'UI** (composant `MessageCalme`,
  détail 400 du backend affiché tel quel), jamais d'écran blanc (ErrorBoundary
  dans `main.jsx`).

## Pièges connus

- `data/graph.pkl` absent → le backend refuse de démarrer : lancer
  `python pipeline/build_graph.py` d'abord.
- Service worker et installation PWA exigent HTTPS ou `localhost` : sur
  téléphone, passer par `adb reverse tcp:8000 tcp:8000` (cf. frontend/README.md).
- Coordonnées hors Paris + Issy-les-Moulineaux → 400 ; la carte est bornée (`maxBounds`) pour
  éviter le cas, mais le message calme reste géré.
- Le curseur horaire et le profil re-déclenchent heatmap **et** itinéraire
  affiché (debounce 250 ms).
