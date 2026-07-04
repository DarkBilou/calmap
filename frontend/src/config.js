// Base des appels API. Vide par défaut : chemins relatifs, valables en
// production (frontend/dist servi par FastAPI) comme en dev (proxy Vite).
// Surchargeable : VITE_API_BASE_URL=http://192.168.1.10:8000 npm run dev
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

// Zone de démo : quartier des Halles, Paris (doit correspondre au graphe backend).
export const CENTRE_DEMO = [48.862, 2.3465];
export const ZOOM_DEMO = 16;

// Couleur d'accent unique de l'interface (voir CLAUDE.md, principes de design).
export const ACCENT = "#2A9D8F";
