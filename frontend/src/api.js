import { API_BASE_URL, NOMINATIM_SEARCH_URL, NOMINATIM_VIEWBOX } from "./config";

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

export async function rechercherAdresses(texte, { signal } = {}) {
  const requete = texte.trim();
  if (requete.length < 3) return [];

  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", requete);
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "fr");
  url.searchParams.set("countrycodes", "fr");
  url.searchParams.set("viewbox", NOMINATIM_VIEWBOX);
  url.searchParams.set("bounded", "1");

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

  const donnees = await reponse.json();
  return donnees
    .map((lieu) => ({
      id: lieu.place_id ?? `${lieu.osm_type}-${lieu.osm_id}`,
      label: lieu.display_name,
      lat: Number(lieu.lat),
      lng: Number(lieu.lon),
    }))
    .filter((lieu) => lieu.label && Number.isFinite(lieu.lat) && Number.isFinite(lieu.lng));
}

function premiereMajuscule(texte) {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}
