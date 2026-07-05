// Base des appels API. Vide par défaut : chemins relatifs, valables en
// production (frontend/dist servi par FastAPI) comme en dev (proxy Vite).
// Surchargeable : VITE_API_BASE_URL=http://192.168.1.10:8000 npm run dev
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

// Zone de démo : Paris + Issy-les-Moulineaux (doit correspondre au graphe backend).
export const CENTRE_DEMO = [48.8535, 2.345];
export const ZOOM_DEMO = 12;
export const LIMITES_DEMO = [
  [48.805, 2.22],
  [48.902, 2.47],
];

// Couleur d'accent unique de l'interface (voir CLAUDE.md, principes de design).
export const ACCENT = "#2A9D8F";
