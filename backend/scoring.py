"""Score sensoriel spatio-temporel d'une arête : bruit + foule, modulés par l'heure.

Formules (spec produit) :
    s_bruit(e,h) = clip((lden - 45) / 30, 0, 1) * PROFIL_TRAFIC[h]
    s_foule(e,h) = clip(Σ_type n_type(e) * PROFIL_type[h] / 5, 0, 1)
    S(e,h,p)     = p.bruit * s_bruit + p.foule * s_foule   ∈ [0, 1]

Toutes les fonctions sont vectorisées : elles acceptent des scalaires ou des
tableaux numpy (utilisé par /api/heatmap et /api/quand pour scorer d'un coup
toutes les arêtes).
"""
from __future__ import annotations

from typing import Any

import numpy as np

Profil = dict[str, float]  # {"bruit": 0-1, "foule": 0-1}

BRUIT_DEFAUT = 60.0  # Lden de repli si une arête n'a pas d'attribut bruit

# ─────────────────────────────────────────────────────────────────────────────
# Profils horaires : 24 valeurs ∈ [0, 1], index = heure (0h → 23h)
# ─────────────────────────────────────────────────────────────────────────────

# Trafic routier : pointes 7-9 h et 17-19 h, creux nocturne
#                          0h    1h    2h    3h    4h    5h    6h    7h    8h    9h    10h   11h
PROFIL_TRAFIC = np.array([0.15, 0.10, 0.08, 0.08, 0.10, 0.20, 0.45, 0.85, 1.00, 0.90, 0.65, 0.60,
                          0.65, 0.60, 0.55, 0.60, 0.75, 0.95, 1.00, 0.85, 0.60, 0.45, 0.35, 0.25])
#                          12h   13h   14h   15h   16h   17h   18h   19h   20h   21h   22h   23h

# Bars / pubs / restaurants : montée dès 17 h, maximum 20 h - 1 h, quasi nul le matin
PROFIL_BAR = np.array([0.90, 0.80, 0.50, 0.20, 0.05, 0.00, 0.00, 0.00, 0.00, 0.00, 0.05, 0.10,
                       0.20, 0.20, 0.10, 0.10, 0.20, 0.40, 0.60, 0.80, 1.00, 1.00, 1.00, 0.95])

# Marchés : cloche 7 h - 13 h, nul ailleurs
PROFIL_MARCHE = np.array([0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.10, 0.40, 0.70, 0.90, 1.00, 1.00,
                          0.80, 0.50, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00])

# Écoles : pics courts 8h-8h30 et 16h30-17h30, approximés sur l'heure entière
PROFIL_ECOLE = np.array([0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.20, 1.00, 0.10, 0.00, 0.00,
                         0.00, 0.00, 0.00, 0.00, 0.50, 0.50, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00])

# Commerces : plateau 10 h - 19 h (le samedi est modulé par FACTEUR_COMMERCE_SEMAINE)
PROFIL_COMMERCE = np.array([0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.10, 0.30, 0.80, 0.85,
                            0.90, 0.85, 0.85, 0.85, 0.85, 0.90, 0.90, 0.80, 0.30, 0.10, 0.00, 0.00])

# ─────────────────────────────────────────────────────────────────────────────
# Facteurs hebdomadaires : 7 valeurs, index = jour (0 = lundi … 6 = dimanche).
# Heuristiques parisiennes plausibles, même esprit que les profils horaires.
# Les valeurs > 1 restent sans risque : les composantes sont bornées ensuite.
# ─────────────────────────────────────────────────────────────────────────────

#                                   lun   mar   mer   jeu   ven   sam   dim
FACTEUR_TRAFIC_SEMAINE = np.array([1.00, 1.00, 1.00, 1.00, 1.00, 0.85, 0.70])
FACTEUR_BAR_SEMAINE = np.array([0.80, 0.80, 0.90, 1.00, 1.15, 1.20, 0.90])
FACTEUR_MARCHE_SEMAINE = np.array([0.50, 0.50, 0.50, 0.50, 0.60, 1.00, 1.00])
FACTEUR_ECOLE_SEMAINE = np.array([1.00, 1.00, 0.60, 1.00, 1.00, 0.00, 0.00])
FACTEUR_COMMERCE_SEMAINE = np.array([0.90, 0.90, 0.90, 0.90, 1.00, 1.30, 0.35])


def s_bruit(lden: float | np.ndarray, heure: int,
            jour_semaine: int = 0) -> float | np.ndarray:
    """Composante bruit : Lden normalisé (45 → 75 dB) modulé par le trafic
    horaire et le jour de la semaine (week-end plus calme)."""
    return np.clip((np.asarray(lden, dtype=float) - 45.0) / 30.0, 0.0, 1.0) \
        * float(PROFIL_TRAFIC[heure]) * float(FACTEUR_TRAFIC_SEMAINE[jour_semaine])


def s_foule(n_bar: float | np.ndarray, n_marche: float | np.ndarray,
            n_ecole: float | np.ndarray, n_commerce: float | np.ndarray,
            heure: int, jour_semaine: int = 0) -> float | np.ndarray:
    """Composante foule : POI proches pondérés par leur profil horaire
    d'activité et le jour de la semaine (0 = lundi … 6 = dimanche) — marchés
    et commerces du week-end, écoles fermées samedi/dimanche…"""
    j = jour_semaine
    charge = (np.asarray(n_bar, dtype=float)
              * PROFIL_BAR[heure] * FACTEUR_BAR_SEMAINE[j]
              + np.asarray(n_marche, dtype=float)
              * PROFIL_MARCHE[heure] * FACTEUR_MARCHE_SEMAINE[j]
              + np.asarray(n_ecole, dtype=float)
              * PROFIL_ECOLE[heure] * FACTEUR_ECOLE_SEMAINE[j]
              + np.asarray(n_commerce, dtype=float)
              * PROFIL_COMMERCE[heure] * FACTEUR_COMMERCE_SEMAINE[j]) / 5.0
    return np.clip(charge, 0.0, 1.0)


def score(lden: float | np.ndarray, n_bar: float | np.ndarray,
          n_marche: float | np.ndarray, n_ecole: float | np.ndarray,
          n_commerce: float | np.ndarray, heure: int, profil: Profil,
          jour_semaine: int = 0) -> float | np.ndarray:
    """Score sensoriel S(e,h,p), borné à [0, 1] (deux poids à 1 pourraient dépasser 1)."""
    brut = profil["bruit"] * s_bruit(lden, heure, jour_semaine) \
        + profil["foule"] * s_foule(n_bar, n_marche, n_ecole, n_commerce, heure, jour_semaine)
    return np.clip(brut, 0.0, 1.0)


def score_arete(attrs: dict[str, Any], heure: int, profil: Profil,
                jour_semaine: int = 0) -> float:
    """Score sensoriel d'une arête du graphe à partir de ses attributs."""
    return float(score(attrs.get("lden", BRUIT_DEFAUT),
                       attrs.get("n_bar", 0), attrs.get("n_marche", 0),
                       attrs.get("n_ecole", 0), attrs.get("n_commerce", 0),
                       heure, profil, jour_semaine))


def confiance_arete(attrs: dict[str, Any]) -> float:
    """Confiance dans la donnée bruit : 0.9 si mesure réelle, 0.5 si synthétique."""
    return 0.9 if attrs.get("bruit_origine") == "reel" else 0.5
