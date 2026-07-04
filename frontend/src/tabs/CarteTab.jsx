import { useEffect, useState } from "react";
import { MapContainer, CircleMarker } from "react-leaflet";
import { appelApi } from "../api";
import { useProfil, poidsApi } from "../profil";
import { couleurScore } from "../couleurs";
import { ACCENT, CENTRE_DEMO, LIMITES_DEMO, ZOOM_DEMO } from "../config";
import {
  CentrerSurPoint,
  ClicsCarte,
  CoucheGeoJson,
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

function styleHeatmap(feature) {
  return { color: couleurScore(feature.properties.score), weight: 3, opacity: 0.75 };
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

  const [heure, setHeure] = useState(() => new Date().getHours());
  const [heatmap, setHeatmap] = useState(null);
  const [erreurHeatmap, setErreurHeatmap] = useState("");
  const [bornesCarte, setBornesCarte] = useState(null);

  const [menuCarteOuvert, setMenuCarteOuvert] = useState(false);
  const [modeItineraire, setModeItineraire] = useState(true);
  const [pointAPlacer, setPointAPlacer] = useState("depart");
  const [depart, setDepart] = useState(null);
  const [arrivee, setArrivee] = useState(null);
  const [texteDepart, setTexteDepart] = useState("");
  const [texteArrivee, setTexteArrivee] = useState("");
  const [pointRecentre, setPointRecentre] = useState(null);
  const [route, setRoute] = useState(null);
  const [calculEnCours, setCalculEnCours] = useState(false);
  const [erreurRoute, setErreurRoute] = useState("");

  // Heatmap : suit l'heure et le profil, avec un léger debounce.
  useEffect(() => {
    if (!bornesCarte) return undefined;
    let annule = false;
    const minuterie = setTimeout(() => {
      appelApi("/api/heatmap", { heure, poids_bruit, poids_foule, ...bornesCarte })
        .then((donnees) => {
          if (annule) return;
          setHeatmap(donnees);
          setErreurHeatmap("");
        })
        .catch((erreur) => {
          if (!annule) setErreurHeatmap(erreur.message);
        });
    }, 250);
    return () => {
      annule = true;
      clearTimeout(minuterie);
    };
  }, [heure, poids_bruit, poids_foule, bornesCarte]);

  // Itinéraire : recalculé si les points, l'heure ou le profil changent.
  useEffect(() => {
    if (!depart || !arrivee) return undefined;
    let annule = false;
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
      })
        .then((donnees) => {
          if (annule) return;
          setRoute(donnees);
          setErreurRoute("");
        })
        .catch((erreur) => {
          if (annule) return;
          setRoute(null);
          setErreurRoute(erreur.message);
        })
        .finally(() => {
          if (!annule) setCalculEnCours(false);
        });
    }, 250);
    return () => {
      annule = true;
      clearTimeout(minuterie);
    };
  }, [depart, arrivee, heure, poids_bruit, poids_foule]);

  function effacer() {
    setDepart(null);
    setArrivee(null);
    setTexteDepart("");
    setTexteArrivee("");
    setPointRecentre(null);
    setRoute(null);
    setErreurRoute("");
    setPointAPlacer("depart");
  }

  function basculerMode() {
    if (modeItineraire) effacer();
    else setPointAPlacer(!depart ? "depart" : "arrivee");
    setModeItineraire(!modeItineraire);
  }

  function clicCarte(latlng) {
    if (!modeItineraire) setModeItineraire(true);
    setErreurRoute("");
    if (pointAPlacer === "depart" || !depart) {
      setDepart(latlng);
      setTexteDepart(TEXTE_POINT_CARTE);
      setRoute(null);
      setPointAPlacer("arrivee");
    } else {
      setArrivee(latlng);
      setTexteArrivee(TEXTE_POINT_CARTE);
      setRoute(null);
      setPointAPlacer("depart");
    }
  }

  function changerTexteDepart(valeur) {
    setTexteDepart(valeur);
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
    setModeItineraire(true);
    setErreurRoute("");
    setRoute(null);
    setPointRecentre(point);
    if (typePoint === "depart") {
      setDepart(point);
      setTexteDepart(suggestion.label);
      setPointAPlacer("arrivee");
    } else {
      setArrivee(point);
      setTexteArrivee(suggestion.label);
      setPointAPlacer("depart");
    }
  }

  let indice = "";
  if (modeItineraire) {
    if (pointAPlacer === "depart") indice = depart ? "Touche la carte pour déplacer le départ." : "Touche la carte : point de départ.";
    else if (!arrivee) indice = "Touche la carte : point d'arrivée.";
    else if (calculEnCours) indice = "Calcul de l'itinéraire…";
  }

  let resumeMenu = "Recherche et itinéraire";
  if (calculEnCours) resumeMenu = "Calcul en cours";
  else if (route) resumeMenu = "Itinéraire prêt";
  else if (depart && arrivee) resumeMenu = "Départ et arrivée choisis";
  else if (depart) resumeMenu = "Départ choisi";

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
          <SuivreBornesCarte actif={actif} onChange={setBornesCarte} />
          <CentrerSurPoint point={pointRecentre} />
          <ClicsCarte onClic={clicCarte} />
          <CoucheGeoJson donnees={heatmap} style={styleHeatmap} />
          {route && <CoucheGeoJson donnees={route.rapide.geojson} style={() => STYLE_RAPIDE} />}
          {route && <CoucheGeoJson donnees={route.calme.geojson} style={() => STYLE_CALME} />}
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
        </MapContainer>

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
                  rechercheDesactivee={texteDepart === TEXTE_POINT_CARTE}
                />
                <AdresseSearch
                  label="Adresse d'arrivée"
                  value={texteArrivee}
                  onChange={changerTexteArrivee}
                  onChoisir={(suggestion) => choisirAdresse("arrivee", suggestion)}
                  placeholder="Rue, lieu, adresse..."
                  rechercheDesactivee={texteArrivee === TEXTE_POINT_CARTE}
                />
              </div>
              <HourSlider heure={heure} onChange={setHeure} />
              <div className="rang-boutons">
                <button
                  type="button"
                  className={modeItineraire ? "bouton bouton-plein" : "bouton"}
                  aria-pressed={modeItineraire}
                  onClick={basculerMode}
                >
                  Itinéraire
                </button>
                {modeItineraire && (depart || route) && (
                  <button type="button" className="bouton" onClick={effacer}>
                    Effacer
                  </button>
                )}
              </div>
              {modeItineraire && (
                <div className="rang-boutons choix-points">
                  <button
                    type="button"
                    className={pointAPlacer === "depart" ? "bouton bouton-plein" : "bouton"}
                    aria-pressed={pointAPlacer === "depart"}
                    onClick={() => setPointAPlacer("depart")}
                  >
                    Départ
                  </button>
                  <button
                    type="button"
                    className={pointAPlacer === "arrivee" ? "bouton bouton-plein" : "bouton"}
                    aria-pressed={pointAPlacer === "arrivee"}
                    disabled={!depart}
                    onClick={() => setPointAPlacer("arrivee")}
                  >
                    Arrivée
                  </button>
                </div>
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

        {route && (
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
            <button type="button" className="bouton" onClick={effacer}>
              Effacer
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
