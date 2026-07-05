import { createContext, useContext, useEffect, useState } from "react";

// Profil sensoriel : stocké UNIQUEMENT dans le localStorage du téléphone.
const CLE_STOCKAGE = "calmap.profil.v1";

// État du moment : facteur appliqué aux sensibilités envoyées à l'API.
// Exporté pour pouvoir, plus tard, moduler aussi le calcul d'itinéraire
// (par exemple le β du coût « calme ») sans toucher au stockage.
export const FACTEURS_ETAT = {
  normal: 1.0,
  fatigue: 1.15,
  stresse: 1.25,
  surcharge: 1.4,
};

export const SONS_DIFFICILES_DEFAUT = {
  constants: false,
  soudains: false,
  humains: false,
  gravesAigus: false,
};

export const PROFIL_DEFAUT = {
  bruit: 70,
  foule: 50,
  etat: "normal",
  sonsDifficiles: SONS_DIFFICILES_DEFAUT,
};

function borner(valeur, defaut) {
  return Number.isFinite(valeur) ? Math.min(100, Math.max(0, valeur)) : defaut;
}

function chargerProfil() {
  try {
    const brut = localStorage.getItem(CLE_STOCKAGE);
    if (!brut) return PROFIL_DEFAUT;
    const p = JSON.parse(brut);

    // Migration douce des anciens profils : « journée difficile » (×1,3)
    // devient l'état « stressé » (×1,25), le plus proche.
    let etat = p.etat;
    if (!FACTEURS_ETAT[etat]) etat = p.journeeDifficile ? "stresse" : "normal";

    const sonsDifficiles = { ...SONS_DIFFICILES_DEFAUT };
    if (p.sonsDifficiles && typeof p.sonsDifficiles === "object") {
      for (const cle of Object.keys(sonsDifficiles)) {
        sonsDifficiles[cle] = Boolean(p.sonsDifficiles[cle]);
      }
    }

    return {
      bruit: borner(p.bruit, PROFIL_DEFAUT.bruit),
      foule: borner(p.foule, PROFIL_DEFAUT.foule),
      etat,
      sonsDifficiles,
    };
  } catch {
    return PROFIL_DEFAUT; // stockage vide, privé ou corrompu : repartir du défaut
  }
}

const ContexteProfil = createContext(null);

export function FournisseurProfil({ children }) {
  const [profil, setProfil] = useState(chargerProfil);

  useEffect(() => {
    try {
      localStorage.setItem(CLE_STOCKAGE, JSON.stringify(profil));
    } catch {
      // stockage indisponible (navigation privée) : le profil vit en mémoire
    }
  }, [profil]);

  const majProfil = (champ, valeur) => setProfil((p) => ({ ...p, [champ]: valeur }));

  return (
    <ContexteProfil.Provider value={{ profil, majProfil }}>
      {children}
    </ContexteProfil.Provider>
  );
}

export function useProfil() {
  return useContext(ContexteProfil);
}

/**
 * Poids envoyés à l'API (0-1). L'état du moment augmente la sensibilité
 * (jusqu'à ×1,4), plafonnée à 1. Renvoyés en chaînes à 2 décimales :
 * valeurs stables, utilisables comme dépendances d'effets React.
 */
export function poidsApi(profil) {
  const facteur = FACTEURS_ETAT[profil.etat] ?? 1.0;
  const borne = (v) => Math.min(1, (v / 100) * facteur).toFixed(2);
  return { poids_bruit: borne(profil.bruit), poids_foule: borne(profil.foule) };
}

/** Sensibilité affichée (0-100) une fois l'état du moment appliqué. */
export function sensibiliteEffective(valeur, etat) {
  const facteur = FACTEURS_ETAT[etat] ?? 1.0;
  return Math.min(100, Math.round(valeur * facteur));
}
