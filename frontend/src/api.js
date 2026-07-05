import { API_BASE_URL } from "./config";

/**
 * Appelle l'API Calmap et renvoie le JSON, ou lève une Error au message
 * calme et actionnable (affiché tel quel dans l'interface, jamais brut).
 */
export async function appelApi(chemin, params = {}, { signal } = {}) {
  const url = new URL(API_BASE_URL + chemin, window.location.origin);
  for (const [cle, valeur] of Object.entries(params)) {
    url.searchParams.set(cle, valeur);
  }

  let reponse;
  try {
    reponse = await fetch(url, { signal });
  } catch (erreur) {
    if (erreur.name === "AbortError") throw erreur; // requête annulée, pas une panne
    throw new Error("Le serveur ne répond pas. Vérifie ta connexion, puis réessaie.");
  }

  if (!reponse.ok) {
    let detail = "";
    try {
      detail = (await reponse.json()).detail;
    } catch {
      // réponse sans corps JSON : on garde le message générique
    }
    throw new Error(
      typeof detail === "string" && detail
        ? premiereMajuscule(detail)
        : `Le serveur a renvoyé une erreur (${reponse.status}). Réessaie dans un instant.`
    );
  }
  return reponse.json();
}

// La recherche passe par notre backend (/api/adresses, proxy Nominatim avec
// timeout court) : l'appel direct du navigateur vers Nominatim restait parfois
// suspendu sans réponse (limite de débit, réseau filtré).
export async function rechercherAdresses(texte, { signal } = {}) {
  const requete = texte.trim();
  if (requete.length < 3) return [];

  const url = new URL(`${API_BASE_URL}/api/adresses`, window.location.origin);
  url.searchParams.set("q", requete);

  let reponse;
  try {
    reponse = await fetch(url, { signal });
  } catch (erreur) {
    if (erreur.name === "AbortError") throw erreur;
    throw new Error("Recherche indisponible pour le moment");
  }

  if (!reponse.ok) {
    throw new Error("Recherche indisponible pour le moment");
  }

  return reponse.json();
}

function premiereMajuscule(texte) {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

/** Jour de la semaine local au format de l'API (0 = lundi … 6 = dimanche) :
    les marchés du dimanche ou le calme du week-end comptent dans le score. */
export function jourSemaine() {
  return (new Date().getDay() + 6) % 7; // getDay() : 0 = dimanche
}
