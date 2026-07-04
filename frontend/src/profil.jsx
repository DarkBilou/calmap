import { createContext, useContext, useEffect, useState } from "react";

// Profil sensoriel : stocké UNIQUEMENT dans le localStorage du téléphone.
const CLE_STOCKAGE = "calmap.profil.v1";
export const PROFIL_DEFAUT = { bruit: 70, foule: 50, journeeDifficile: false };

function borner(valeur, defaut) {
  return Number.isFinite(valeur) ? Math.min(100, Math.max(0, valeur)) : defaut;
}

function chargerProfil() {
  try {
    const brut = localStorage.getItem(CLE_STOCKAGE);
    if (!brut) return PROFIL_DEFAUT;
    const p = JSON.parse(brut);
    return {
      bruit: borner(p.bruit, PROFIL_DEFAUT.bruit),
      foule: borner(p.foule, PROFIL_DEFAUT.foule),
      journeeDifficile: Boolean(p.journeeDifficile),
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
 * Poids envoyés à l'API (0-1). Une « journée difficile » augmente la
 * sensibilité de 30 %, plafonnée à 1. Renvoyés en chaînes à 2 décimales :
 * valeurs stables, utilisables comme dépendances d'effets React.
 */
export function poidsApi(profil) {
  const facteur = profil.journeeDifficile ? 1.3 : 1.0;
  const borne = (v) => Math.min(1, (v / 100) * facteur).toFixed(2);
  return { poids_bruit: borne(profil.bruit), poids_foule: borne(profil.foule) };
}

/** Sensibilité affichée (0-100) une fois la journée difficile appliquée. */
export function sensibiliteEffective(valeur, journeeDifficile) {
  return journeeDifficile ? Math.min(100, Math.round(valeur * 1.3)) : valeur;
}
