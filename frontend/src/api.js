import { API_BASE_URL } from "./config";

/**
 * Appelle l'API Calmap et renvoie le JSON, ou lève une Error au message
 * calme et actionnable (affiché tel quel dans l'interface, jamais brut).
 */
export async function appelApi(chemin, params = {}) {
  const url = new URL(API_BASE_URL + chemin, window.location.origin);
  for (const [cle, valeur] of Object.entries(params)) {
    url.searchParams.set(cle, valeur);
  }

  let reponse;
  try {
    reponse = await fetch(url);
  } catch {
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

function premiereMajuscule(texte) {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}
