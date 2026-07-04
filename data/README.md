# Dossier data

Contenu généré et données optionnelles du pipeline Calmap.

## `graph.pkl` (généré, mais commité)

Graphe piéton enrichi (MultiDiGraph NetworkX picklé) de la zone de démo,
produit par :

```bash
python pipeline/build_graph.py
```

Committé dans le dépôt (~500 Ko) pour que le déploiement en ligne n'ait pas
besoin d'appeler l'API Overpass au démarrage. Si tu changes la zone de démo ou
les données de bruit, relance le pipeline puis recommite le nouveau fichier.

Chaque arête porte : `length`, `lden`, `bruit_origine` (`reel`/`synthetique`),
`n_bar`, `n_marche`, `n_ecole`, `n_commerce`.

## `bruit_lden.geojson` (optionnel — données réelles Bruitparif)

Carte stratégique de bruit routier Lden de Bruitparif (polygones avec une
colonne `DB_LOW`). À télécharger manuellement (open data Bruitparif /
data.gouv.fr), à déposer ici sous ce nom exact, puis relancer le pipeline.

**S'il est absent, le pipeline génère un bruit synthétique plausible à partir
du type de voie OSM : le projet fonctionne sans aucune donnée externe.**
L'indicateur de confiance de l'API reflète l'origine des données
(0.9 = réel, 0.5 = synthétique).
