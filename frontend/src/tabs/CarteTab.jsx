import { useEffect, useState } from "react";
import { MapContainer, CircleMarker } from "react-leaflet";
import { appelApi } from "../api";
import { useProfil, poidsApi } from "../profil";
import { couleurScore } from "../couleurs";
import { ACCENT, CENTRE_DEMO, ZOOM_DEMO } from "../config";
import { ClicsCarte, CoucheGeoJson, FondDeCarte, RafraichirTaille } from "../carte-utils";
import HourSlider from "../components/HourSlider";

// Zone de démo (quartier des Halles) : la carte n'en sort pas.
const LIMITES_DEMO = [
  [48.85, 2.325],
  [48.872, 2.365],
];

const STYLE_RAPIDE = { color: "#5B6770", weight: 3, dashArray: "6 10", opacity: 0.9 };
const STYLE_CALME = { color: ACCENT, weight: 6, opacity: 0.95 };

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

  const [modeItineraire, setModeItineraire] = useState(false);
  const [depart, setDepart] = useState(null);
  const [arrivee, setArrivee] = useState(null);
  const [route, setRoute] = useState(null);
  const [calculEnCours, setCalculEnCours] = useState(false);
  const [erreurRoute, setErreurRoute] = useState("");

  // Heatmap : suit l'heure et le profil, avec un léger debounce.
  useEffect(() => {
    let annule = false;
    const minuterie = setTimeout(() => {
      appelApi("/api/heatmap", { heure, poids_bruit, poids_foule })
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
  }, [heure, poids_bruit, poids_foule]);

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
    setRoute(null);
    setErreurRoute("");
  }

  function basculerMode() {
    if (modeItineraire) effacer();
    setModeItineraire(!modeItineraire);
  }

  function clicCarte(latlng) {
    if (!modeItineraire) return;
    if (!depart || (depart && arrivee)) {
      effacer();
      setDepart(latlng);
    } else {
      setArrivee(latlng);
    }
  }

  let indice = "";
  if (modeItineraire) {
    if (!depart) indice = "Touche la carte : point de départ.";
    else if (!arrivee) indice = "Touche encore : point d'arrivée.";
    else if (calculEnCours) indice = "Calcul de l'itinéraire…";
  }

  return (
    <div className="carte-onglet">
      <div className="zone-carte">
        <MapContainer
          center={CENTRE_DEMO}
          zoom={ZOOM_DEMO}
          minZoom={14}
          maxBounds={LIMITES_DEMO}
          maxBoundsViscosity={1.0}
          zoomControl={false}
          preferCanvas
          className="carte-pleine"
        >
          <FondDeCarte />
          <RafraichirTaille actif={actif} />
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

        <div className="outils-carte">
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
          {indice && <p className="indice" role="status">{indice}</p>}
          {erreurHeatmap && <p className="texte-erreur" role="status">{erreurHeatmap}</p>}
          {erreurRoute && <p className="texte-erreur" role="status">{erreurRoute}</p>}
          <div className="legende-heatmap">
            <span>calme</span>
            <span className="degrade" aria-hidden="true" />
            <span>animé</span>
          </div>
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
