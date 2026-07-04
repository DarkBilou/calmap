import { useEffect, useState } from "react";
import { MapContainer, CircleMarker } from "react-leaflet";
import { appelApi } from "../api";
import { useProfil, poidsApi } from "../profil";
import { ACCENT, CENTRE_DEMO } from "../config";
import { ClicsCarte, FondDeCarte, RafraichirTaille } from "../carte-utils";
import Histogramme from "../components/Histogramme";
import MessageCalme from "../components/MessageCalme";

const LIMITES_DEMO = [
  [48.85, 2.325],
  [48.872, 2.365],
];

export default function QuandTab({ actif }) {
  const { profil } = useProfil();
  const { poids_bruit, poids_foule } = poidsApi(profil);

  const [destination, setDestination] = useState(null);
  const [donnees, setDonnees] = useState(null);
  const [analyseEnCours, setAnalyseEnCours] = useState(false);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    if (!destination) return undefined;
    let annule = false;
    setAnalyseEnCours(true);
    appelApi("/api/quand", {
      lat: destination.lat.toFixed(6),
      lon: destination.lng.toFixed(6),
      poids_bruit,
      poids_foule,
    })
      .then((reponse) => {
        if (annule) return;
        setDonnees(reponse);
        setErreur("");
      })
      .catch((e) => {
        if (annule) return;
        setDonnees(null);
        setErreur(e.message);
      })
      .finally(() => {
        if (!annule) setAnalyseEnCours(false);
      });
    return () => {
      annule = true;
    };
  }, [destination, poids_bruit, poids_foule]);

  return (
    <div className="quand-onglet">
      <h1>Quand y aller</h1>
      <p className="consigne">Touche la carte pour choisir un lieu.</p>

      <div className="mini-carte">
        <MapContainer
          center={CENTRE_DEMO}
          zoom={15}
          minZoom={14}
          maxBounds={LIMITES_DEMO}
          maxBoundsViscosity={1.0}
          zoomControl={false}
          className="carte-pleine"
        >
          <FondDeCarte />
          <RafraichirTaille actif={actif} />
          <ClicsCarte onClic={setDestination} />
          {destination && (
            <CircleMarker
              center={destination}
              radius={9}
              pathOptions={{ color: "#1F2933", weight: 2, fillColor: ACCENT, fillOpacity: 1 }}
            />
          )}
        </MapContainer>
      </div>

      {!destination && !erreur && (
        <MessageCalme>
          Choisis un lieu sur la carte. Tu verras les heures les plus calmes pour y aller,
          selon ton profil.
        </MessageCalme>
      )}
      {analyseEnCours && <p className="texte-discret" role="status">Analyse du quartier…</p>}
      {erreur && <MessageCalme>{erreur}</MessageCalme>}

      {donnees && !analyseEnCours && (
        <Histogramme
          scores={donnees.scores_horaires}
          creneau={donnees.creneau_optimal}
          heureActuelle={new Date().getHours()}
        />
      )}
    </div>
  );
}
