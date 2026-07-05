import { useEffect, useRef, useState } from "react";
import { MapContainer, CircleMarker } from "react-leaflet";
import { appelApi } from "../api";
import { useGeolocalisation } from "../geolocalisation";
import { useProfil, poidsApi } from "../profil";
import { couleurScore } from "../couleurs";
import { ACCENT, CENTRE_DEMO, LIMITES_DEMO, ZOOM_DEMO } from "../config";
import {
  CentrerSurPoint,
  ClicsCarte,
  CoucheGeoJson,
  CoucheNuages,
  FondDeCarte,
  LimiterDezoomCarte,
  RafraichirTaille,
  SuivreBornesCarte,
} from "../carte-utils";
import AdresseSearch from "../components/AdresseSearch";
import HourSlider from "../components/HourSlider";

const STYLE_RAPIDE = { color: "#111111", weight: 3, dashArray: "6 10", opacity: 0.9 };
const STYLE_CALME = { color: "#2563EB", weight: 6, opacity: 0.95 };
const TEXTE_POINT_CARTE = "Point choisi sur la carte";
const TEXTE_MA_POSITION = "Votre position";

function styleHeatmap(feature) {
  return { color: couleurScore(feature.properties.score), weight: 3, opacity: 0.75 };
}

// Vue dézoomée : le backend agrège les rues en « nuages » (Points + taille de
// cellule), rendus en une seule image floutée. Vue rapprochée : les rues.
function estHeatmapNuages(donnees) {
  return Boolean(donnees?.features?.[0]?.properties?.nuage);
}

function texteDistance(m) {
  if (m < 950) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;
}

function texteDeltaDuree(delta) {
  if (Math.abs(delta) < 0.75) return "même durée";
  const minutes = Math.round(Math.abs(delta));
  return delta > 0 ? `+${minutes} min` : `−${minutes} min`;
}

function texteDeltaExposition(pct) {
  const p = Math.abs(Math.round(pct));
  if (p === 0) return "exposition identique";
  return pct < 0 ? `−${p} % d'exposition` : `+${p} % d'exposition`;
}

function libelleConfiance(confiance) {
  if (confiance >= 0.75) return "fiabilité élevée";
  if (confiance >= 0.55) return "fiabilité moyenne";
  return "estimation";
}

export default function CarteTab({ actif }) {
  const { profil } = useProfil();
  const { poids_bruit, poids_foule } = poidsApi(profil);
  const { statut: statutPosition, position: maPosition } = useGeolocalisation();

  const [heure, setHeure] = useState(() => new Date().getHours());
  const [heatmap, setHeatmap] = useState(null);
  const [erreurHeatmap, setErreurHeatmap] = useState("");
  const [bornesCarte, setBornesCarte] = useState(null);

  const [menuCarteOuvert, setMenuCarteOuvert] = useState(false);
  const [pointAPlacer, setPointAPlacer] = useState("depart");
  const [depart, setDepart] = useState(null);
  const [arrivee, setArrivee] = useState(null);
  const [texteDepart, setTexteDepart] = useState("");
  const [texteArrivee, setTexteArrivee] = useState("");
  // Libellés remplis automatiquement (adresse du point tapé sur la carte) :
  // mémorisés pour ne pas déclencher la recherche de suggestions dessus.
  const [adresseAutoDepart, setAdresseAutoDepart] = useState("");
  const [adresseAutoArrivee, setAdresseAutoArrivee] = useState("");
  const compteurAdresse = useRef({ depart: 0, arrivee: 0 });
  // Vrai tant que le point de départ est la position géolocalisée : les taps
  // sur la carte règlent alors toujours l'arrivée.
  const [departEstPosition, setDepartEstPosition] = useState(false);
  const [pointRecentre, setPointRecentre] = useState(null);
  const [route, setRoute] = useState(null);
  const [calculEnCours, setCalculEnCours] = useState(false);
  const [erreurRoute, setErreurRoute] = useState("");
  const [relanceRoute, setRelanceRoute] = useState(0);
  // Itinéraire lancé ("calme" | "rapide" | null) : seul son tracé reste
  // affiché, la fiche passe en mode suivi avec le bouton Quitter.
  const [itineraireLance, setItineraireLance] = useState(null);

  // Les points ont changé → le trajet suivi n'existe plus : retour au choix.
  useEffect(() => {
    if (!route) setItineraireLance(null);
  }, [route]);

  // Heatmap : suit l'heure et le profil, avec un léger debounce. La requête
  // précédente est annulée : les réponses obsolètes ne s'empilent pas.
  useEffect(() => {
    if (!bornesCarte || itineraireLance) return undefined;
    const controleur = new AbortController();
    const minuterie = setTimeout(() => {
      appelApi("/api/heatmap", { heure, poids_bruit, poids_foule, ...bornesCarte },
        { signal: controleur.signal })
        .then((donnees) => {
          if (controleur.signal.aborted) return;
          setHeatmap(donnees);
          setErreurHeatmap("");
        })
        .catch((erreur) => {
          if (erreur.name !== "AbortError") setErreurHeatmap(erreur.message);
        });
    }, 250);
    return () => {
      clearTimeout(minuterie);
      controleur.abort();
    };
  }, [heure, poids_bruit, poids_foule, bornesCarte, itineraireLance]);

  // Itinéraire : recalculé si les points, l'heure ou le profil changent.
  useEffect(() => {
    if (!depart || !arrivee) {
      setCalculEnCours(false); // un point vient d'être effacé : plus rien à calculer
      return undefined;
    }
    const controleur = new AbortController();
    setCalculEnCours(true);
    const minuterie = setTimeout(() => {
      appelApi("/api/route", {
        from_lat: depart.lat.toFixed(6),
        from_lon: depart.lng.toFixed(6),
        to_lat: arrivee.lat.toFixed(6),
        to_lon: arrivee.lng.toFixed(6),
        heure,
        poids_bruit,
        poids_foule,
      }, { signal: controleur.signal })
        .then((donnees) => {
          if (controleur.signal.aborted) return;
          setRoute(donnees);
          setErreurRoute("");
        })
        .catch((erreur) => {
          if (controleur.signal.aborted || erreur.name === "AbortError") return;
          setRoute(null);
          setErreurRoute(erreur.message);
          setMenuCarteOuvert(true);
        })
        .finally(() => {
          if (!controleur.signal.aborted) setCalculEnCours(false);
        });
    }, 250);
    return () => {
      clearTimeout(minuterie);
      controleur.abort();
    };
  }, [depart, arrivee, heure, poids_bruit, poids_foule, relanceRoute]);

  function rechercherOuVoirRoute() {
    if (!depart || !arrivee || calculEnCours) return;
    setErreurRoute("");
    if (!route) setRelanceRoute((n) => n + 1);
    setMenuCarteOuvert(false);
    setPointRecentre({ lat: depart.lat, lng: depart.lng });
  }

  function lancerItineraire(type) {
    setItineraireLance(type);
    setMenuCarteOuvert(false);
    // zoom sur le départ : on démarre le trajet
    if (depart) setPointRecentre({ lat: depart.lat, lng: depart.lng });
  }

  function utiliserMaPosition() {
    if (!maPosition) return;
    setDepart({ lat: maPosition.lat, lng: maPosition.lng });
    setTexteDepart(TEXTE_MA_POSITION);
    setDepartEstPosition(true);
    setRoute(null);
    setErreurRoute("");
    setPointAPlacer("arrivee");
    setPointRecentre({ lat: maPosition.lat, lng: maPosition.lng });
  }

  // Position reçue au lancement : elle devient le départ et la carte se
  // recentre dessus — seulement si l'utilisateur n'a encore rien choisi.
  useEffect(() => {
    if (statutPosition !== "ok" || depart || texteDepart !== "") return;
    utiliserMaPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statutPosition]);

  function effacer() {
    setDepart(null);
    setArrivee(null);
    setTexteDepart("");
    setTexteArrivee("");
    setDepartEstPosition(false);
    setAdresseAutoDepart("");
    setAdresseAutoArrivee("");
    setPointRecentre(null);
    setRoute(null);
    setErreurRoute("");
    setPointAPlacer("depart");
  }

  // Remplace « Point choisi sur la carte » par l'adresse du lieu tapé, dès
  // que le géocodage inverse répond. En cas d'échec, le texte neutre reste.
  function remplirAdresse(champ, latlng) {
    const numero = ++compteurAdresse.current[champ];
    appelApi("/api/adresse-inverse", {
      lat: latlng.lat.toFixed(6),
      lon: latlng.lng.toFixed(6),
    })
      .then((reponse) => {
        // on ignore la réponse si un tap plus récent a déplacé ce point
        if (!reponse.label || compteurAdresse.current[champ] !== numero) return;
        if (champ === "depart") {
          setAdresseAutoDepart(reponse.label);
          setTexteDepart(reponse.label);
        } else {
          setAdresseAutoArrivee(reponse.label);
          setTexteArrivee(reponse.label);
        }
      })
      .catch(() => {
        // adresse introuvable : le libellé neutre suffit
      });
  }

  function clicCarte(latlng) {
    setErreurRoute("");
    if (pointAPlacer === "depart" || !depart) {
      setDepart(latlng);
      setDepartEstPosition(false);
      setTexteDepart(TEXTE_POINT_CARTE);
      setRoute(null);
      setPointAPlacer("arrivee");
      remplirAdresse("depart", latlng);
    } else {
      setArrivee(latlng);
      setTexteArrivee(TEXTE_POINT_CARTE);
      setRoute(null);
      // départ = ta position : les taps suivants continuent d'ajuster l'arrivée
      setPointAPlacer(departEstPosition ? "arrivee" : "depart");
      remplirAdresse("arrivee", latlng);
    }
  }

  function changerTexteDepart(valeur) {
    setTexteDepart(valeur);
    setDepartEstPosition(false);
    if (valeur.trim() === "") {
      setDepart(null);
      setRoute(null);
      setErreurRoute("");
      setPointAPlacer("depart");
    }
  }

  function changerTexteArrivee(valeur) {
    setTexteArrivee(valeur);
    if (valeur.trim() === "") {
      setArrivee(null);
      setRoute(null);
      setErreurRoute("");
      if (depart) setPointAPlacer("arrivee");
    }
  }

  function choisirAdresse(typePoint, suggestion) {
    const point = { lat: suggestion.lat, lng: suggestion.lng };
    setErreurRoute("");
    setRoute(null);
    setPointRecentre(point);
    if (typePoint === "depart") {
      setDepart(point);
      setDepartEstPosition(false);
      setTexteDepart(suggestion.label);
      setPointAPlacer("arrivee");
    } else {
      setArrivee(point);
      setTexteArrivee(suggestion.label);
      setPointAPlacer("depart");
    }
  }

  let indice = "";
  if (pointAPlacer === "depart") indice = depart ? "Touche la carte pour déplacer le départ." : "Touche la carte : point de départ.";
  else if (!arrivee) indice = "Touche la carte : point d'arrivée.";
  else if (calculEnCours) indice = "Calcul de l'itinéraire…";

  let resumeMenu = "Recherche et itinéraire";
  if (calculEnCours) resumeMenu = "Calcul en cours";
  else if (route) resumeMenu = "Itinéraire prêt";
  else if (depart && arrivee) resumeMenu = "Départ et arrivée choisis";
  else if (depart) resumeMenu = "Départ choisi";

  const heatmapActive = actif && !itineraireLance;
  const afficherOutilsCarte = !itineraireLance;
  const afficherFeuilleChoix = route && !itineraireLance && !menuCarteOuvert;
  const libelleRecherche = calculEnCours
    ? "Calcul…"
    : route
      ? "Voir l'itinéraire"
      : erreurRoute
        ? "Réessayer"
        : "Rechercher";

  return (
    <div className="carte-onglet">
      <div className="zone-carte">
        <MapContainer
          center={CENTRE_DEMO}
          zoom={ZOOM_DEMO}
          minZoom={11}
          maxBounds={LIMITES_DEMO}
          maxBoundsViscosity={1.0}
          zoomControl={false}
          preferCanvas
          className="carte-pleine"
        >
          <FondDeCarte />
          <RafraichirTaille actif={actif} />
          <LimiterDezoomCarte actif={actif} limites={LIMITES_DEMO} />
          <SuivreBornesCarte actif={heatmapActive} onChange={setBornesCarte} />
          <CentrerSurPoint point={pointRecentre} />
          <ClicsCarte onClic={clicCarte} />
          {/* Pendant un itinéraire lancé, la heatmap s'efface : seul le trajet
              à suivre reste lisible. Elle revient en quittant l'itinéraire. */}
          {!itineraireLance && (estHeatmapNuages(heatmap)
            ? <CoucheNuages donnees={heatmap} />
            : <CoucheGeoJson donnees={heatmap} style={styleHeatmap} />)}
          {route && itineraireLance !== "calme" && (
            <CoucheGeoJson donnees={route.rapide.geojson} style={() => STYLE_RAPIDE} />
          )}
          {route && itineraireLance !== "rapide" && (
            <CoucheGeoJson donnees={route.calme.geojson} style={() => STYLE_CALME} />
          )}
          {depart && (
            <CircleMarker
              center={depart}
              radius={9}
              pathOptions={{ color: "#1F2933", weight: 2, fillColor: "#FFFFFF", fillOpacity: 1 }}
            />
          )}
          {arrivee && (
            <CircleMarker
              center={arrivee}
              radius={9}
              pathOptions={{ color: "#1F2933", weight: 2, fillColor: ACCENT, fillOpacity: 1 }}
            />
          )}
          {maPosition && (
            <CircleMarker
              center={maPosition}
              radius={7}
              pathOptions={{ color: "#FFFFFF", weight: 3, fillColor: ACCENT, fillOpacity: 1 }}
            />
          )}
        </MapContainer>

        {afficherOutilsCarte && (
          <div className={menuCarteOuvert ? "outils-carte" : "outils-carte outils-carte-ferme"}>
            <div className="entete-outils">
              <p className="resume-outils">{resumeMenu}</p>
              <button
                type="button"
                className="bouton bouton-menu"
                aria-expanded={menuCarteOuvert}
                onClick={() => setMenuCarteOuvert(!menuCarteOuvert)}
              >
                {menuCarteOuvert ? "Réduire" : "Ouvrir"}
              </button>
            </div>
            {menuCarteOuvert && (
              <div className="contenu-outils">
                <div className="recherche-itineraire" aria-label="Recherche d'itineraire">
                  <AdresseSearch
                    label="Adresse de départ"
                    value={texteDepart}
                    onChange={changerTexteDepart}
                    onChoisir={(suggestion) => choisirAdresse("depart", suggestion)}
                    placeholder="Rue, lieu, adresse..."
                    rechercheDesactivee={texteDepart === TEXTE_POINT_CARTE
                      || texteDepart === TEXTE_MA_POSITION
                      || texteDepart === adresseAutoDepart}
                  />
                  {statutPosition === "ok" && !departEstPosition && (
                    <button type="button" className="bouton" onClick={utiliserMaPosition}>
                      Partir de ma position
                    </button>
                  )}
                  <AdresseSearch
                    label="Adresse d'arrivée"
                    value={texteArrivee}
                    onChange={changerTexteArrivee}
                    onChoisir={(suggestion) => choisirAdresse("arrivee", suggestion)}
                    placeholder="Rue, lieu, adresse..."
                    rechercheDesactivee={texteArrivee === TEXTE_POINT_CARTE
                      || texteArrivee === adresseAutoArrivee}
                  />
                </div>
                <HourSlider heure={heure} onChange={setHeure} />
                <div className="rang-boutons">
                  <button
                    type="button"
                    className="bouton bouton-plein bouton-rechercher"
                    disabled={!depart || !arrivee || calculEnCours}
                    aria-busy={calculEnCours}
                    onClick={rechercherOuVoirRoute}
                  >
                    {libelleRecherche}
                  </button>
                </div>
                {statutPosition === "hors-zone" && (
                  <p className="texte-discret" role="status">
                    Tu es en dehors de la zone de démo (Paris + Issy) : choisis le départ sur la carte.
                  </p>
                )}
                {indice && <p className="indice" role="status">{indice}</p>}
                {erreurHeatmap && <p className="texte-erreur" role="status">{erreurHeatmap}</p>}
                {erreurRoute && <p className="texte-erreur" role="status">{erreurRoute}</p>}
                <div className="legende-heatmap">
                  <span>calme</span>
                  <span className="degrade" aria-hidden="true" />
                  <span>animé</span>
                </div>
              </div>
            )}
          </div>
        )}

        {afficherFeuilleChoix && (
          <section className="feuille" aria-label="Comparaison des itinéraires">
            <div className="feuille-titre">
              <h2>Itinéraire calme</h2>
              <span className="badge">{libelleConfiance(route.confiance)}</span>
            </div>
            <p className="feuille-deltas">
              {texteDeltaDuree(route.calme.delta_duree_min)}
              {" · "}
              {texteDeltaExposition(route.calme.delta_exposition_pct)}
            </p>
            <ul className="legende-routes">
              <li>
                <span className="cle-trace cle-calme" aria-hidden="true" />
                Calme — {Math.round(route.calme.duree_min)} min · {texteDistance(route.calme.distance_m)}
              </li>
              <li>
                <span className="cle-trace cle-rapide" aria-hidden="true" />
                Rapide — {Math.round(route.rapide.duree_min)} min · {texteDistance(route.rapide.distance_m)}
              </li>
            </ul>
            <div className="rang-boutons">
              <button
                type="button"
                className="bouton bouton-plein bouton-lancer"
                onClick={() => lancerItineraire("calme")}
              >
                Lancer le calme
              </button>
              <button
                type="button"
                className="bouton bouton-lancer"
                onClick={() => lancerItineraire("rapide")}
              >
                Lancer le rapide
              </button>
            </div>
            <div className="rang-boutons">
              <button type="button" className="bouton" onClick={effacer}>
                Effacer
              </button>
            </div>
          </section>
        )}

        {route && itineraireLance && (
          <section className="feuille" aria-label="Itinéraire en cours">
            <div className="feuille-titre">
              <h2>{itineraireLance === "calme" ? "Itinéraire calme en cours" : "Itinéraire rapide en cours"}</h2>
              <span className="badge">{libelleConfiance(route.confiance)}</span>
            </div>
            <p className="feuille-deltas">
              {Math.round(route[itineraireLance].duree_min)} min
              {" · "}
              {texteDistance(route[itineraireLance].distance_m)}
            </p>
            <div className="rang-boutons">
              <button
                type="button"
                className="bouton bouton-quitter"
                onClick={() => setItineraireLance(null)}
              >
                Quitter
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
