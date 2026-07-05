# Calmap

Météo sensorielle & itinéraires piétons apaisés pour personnes autistes
(hackathon Hi! PARIS × Capgemini, « IA et handicap »). Zone de démo :
Paris + Issy-les-Moulineaux. Aucune base de données, aucun compte utilisateur.

## Architecture & stack

```
pipeline/build_graph.py   # offline : graphe piéton OSMnx + POI + bruit → data/graph.pkl (~1-2 min)
backend/                  # FastAPI (Python) — sert tout depuis des tableaux numpy compilés
frontend/                 # PWA React 18 + Vite (JavaScript) + Leaflet/react-leaflet, CSS pur
data/graph.pkl            # généré ; bruit Bruitparif réel si data/bruit_lden.geojson présent, sinon synthétique
data/graph_compile.npz    # cache compilé au 1er démarrage (~23 Mo, ~3 min) ; ensuite démarrage en ~5 s
```

Le pickle networkx n'est lu qu'une fois : le backend compile arêtes, géométries
et structures de routage en tableaux numpy (`graph_compile.npz`, régénéré si
`graph.pkl` est plus récent) et les requêtes n'utilisent que ces tableaux.

- **Backend** : `uvicorn backend.main:app --port 8000`. Sert aussi `frontend/dist`
  sur `/` s'il existe. Tests de fumée : `python backend/test_api.py` (serveur lancé).
- **Frontend** : `cd frontend && npm install && npm run build` (dev : `npm run dev`,
  proxy Vite `/api` → :8000). Node ≥ 18 requis. Détails téléphone Android
  (adb reverse, PWA) : `frontend/README.md`.
- Score sensoriel `S(e, h, profil) ∈ [0,1]` (backend/scoring.py) : bruit Lden
  normalisé × profil horaire de trafic + POI (bars, marchés, écoles, commerces)
  × leurs profils horaires, le tout modulé par des facteurs hebdomadaires
  (`FACTEUR_*_SEMAINE`, 0 = lundi … 6 = dimanche : trafic réduit le week-end,
  marchés le week-end, écoles fermées sam./dim., commerces au pic le samedi).
  Itinéraire calme : coût `length × (1 + β·S)` — β = 3 de base, amplifié par
  l'état du moment côté frontend (`betaApi` : ×1,15/1,25/1,4 → jusqu'à 4,2).

## Contrat d'API (FIGÉ — le frontend en dépend, ne pas le changer)

Erreurs : toujours `{"detail": "message en français"}`, 400 pour paramètres
invalides ou point hors zone. Le serveur ne crashe jamais.

| Endpoint | Paramètres | Réponse |
|---|---|---|
| `GET /api/health` | — | `{status, graph_loaded, edges, bruit_source: "reel"\|"synthetique"}` |
| `GET /api/heatmap` | `heure` 0-23, `poids_bruit` 0-1, `poids_foule` 0-1, `sud/nord/ouest/est` optionnels, `jour` 0-6 optionnel (défaut : aujourd'hui) | FeatureCollection, `properties: {score, lden}` ; rues (LineString) sur toute la zone ; au-delà de 20 000 tronçons visibles (vue large), « nuages » agrégés par quartier (Point + `nuage: true`, `demi_lat`/`demi_lon`) rendus côté client en une image floutée transparente (fondu continu) ; réponses gzippées ; scores caches par heure/jour/profil |
| `GET /api/route` | `from_lat/lon`, `to_lat/lon`, `heure`, `poids_bruit`, `poids_foule`, `beta`, `jour` 0-6 optionnel | `{rapide: {geojson, distance_m, duree_min, exposition}, calme: {idem + delta_duree_min, delta_exposition_pct}, confiance}` |
| `GET /api/quand` | `lat`, `lon`, `poids_bruit`, `poids_foule`, `jour` 0-6 optionnel | `{scores_horaires: [{heure, score}×24], creneau_optimal: {debut, fin}}` (rues < 150 m, créneau 2 h entre 8 h et 21 h) |
| `GET /api/adresses` | `q` (≥ 3 caractères, sinon `[]`) | `[{id, label, lat, lng}]` — proxy Nominatim côté serveur (timeout 5 s, 503 si indisponible) ; le navigateur ne doit PAS appeler Nominatim en direct (blocages/limites de débit) |
| `GET /api/adresse-inverse` | `lat`, `lon` (dans la zone, sinon 400) | `{label}` court (« 10 Rue X, Paris ») — proxy Nominatim reverse (timeout 5 s, 503 si indisponible) ; remplit les champs après un tap sur la carte |

`confiance` : 0,9 = bruit mesuré (Bruitparif), 0,5 = synthétique. Si
`bruit_source = "synthetique"`, le frontend affiche le bandeau « Démo : bruit simulé ».

## Frontend — 3 onglets

1. **Carte** : heatmap (`/api/heatmap`) recolorée selon curseur horaire 0-23 h
   (heure rappelée dans l'en-tête quand le menu est replié) ; géolocalisation au
   lancement (`geolocalisation.js`, HTTPS/localhost requis) : si position dans
   la zone → départ « Votre position », vue recentrée, bouton flottant
   « recentrer sur ma position » (`.bouton-position`). **Un tap sur la carte
   règle toujours l'arrivée** — le départ vient de la position ou du champ de
   recherche, jamais d'un tap ; hors zone/refus → saisir l'adresse de départ.
   → `/api/route` (β modulé par l'état du moment) → tracé rapide (gris
   pointillé) + calme (vert épais), vue cadrée automatiquement sur le trajet
   entier entre la barre d'outils et la fiche (`CadrerSurTrajet`, mesure le DOM)
   + bottom sheet comparatif (Δ durée, Δ exposition, croix « Effacer » qui
   remet le départ sur la position). Depuis la fiche : « Lancer le
   calme/rapide » → seul le tracé choisi reste, fiche en mode suivi, bouton
   « Quitter » (terre cuite `--erreur-texte`) pour revenir au choix.
2. **Quand y aller** : mini-carte avec heatmap d'ambiance (curseur « Heure
   affichée », via `CoucheHeatmapAuto`, erreurs silencieuses), centrée sur la
   position si disponible (marqueur « tu es ici ») ; tap → `/api/quand` →
   histogramme 24 barres fait main (divs CSS, pas de lib de charts), créneau
   optimal surligné (même s'il est passé), heures passées grisées, valeurs
   exactes dans un `<details>`.
3. **Mon profil** : curseurs Bruit (défaut 70) / Foule (défaut 50) avec phrase
   de niveau (4 paliers : ≤ 25/50/75/100) ; « Sons difficiles » (4 cases,
   stockage local seulement, pas encore de scoring) ; « État du moment »
   (Normal/Fatigué/Stressé/Surcharge proche → facteurs 1,0/1,15/1,25/1,4 sur
   les poids, plafonnés à 1 ; `FACTEURS_ETAT` exporté pour moduler plus tard
   le β d'itinéraire). **localStorage uniquement** (`calmap.profil.v1`,
   migration douce des anciens profils `journeeDifficile` → « stressé ») —
   le profil alimente les onglets 1 et 2 via un contexte React.

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

- `data/graph.pkl` ET `data/graph_compile.npz` absents → le backend refuse de
  démarrer : lancer `python pipeline/build_graph.py` d'abord. Le premier
  démarrage après un nouveau `graph.pkl` recompile le cache (~3 min).
- Service worker et installation PWA exigent HTTPS ou `localhost` : sur
  téléphone, passer par `adb reverse tcp:8000 tcp:8000` (cf. frontend/README.md).
- Coordonnées hors Paris + Issy-les-Moulineaux → 400 ; la carte est bornée (`maxBounds`) pour
  éviter le cas, mais le message calme reste géré.
- Le curseur horaire et le profil re-déclenchent heatmap **et** itinéraire
  affiché (debounce 250 ms).
