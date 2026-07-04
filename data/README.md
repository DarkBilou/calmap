# Dossier data

Contenu généré et données optionnelles du pipeline Calmap.

## `graph.pkl` (généré)

Graphe piéton enrichi (MultiDiGraph NetworkX picklé), produit par :

```bash
python pipeline/build_graph.py
```

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
