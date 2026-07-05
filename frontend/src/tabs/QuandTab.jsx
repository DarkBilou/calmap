import { useEffect, useRef, useState } from "react";
import { MapContainer, CircleMarker } from "react-leaflet";
import { appelApi, jourSemaine } from "../api";
import { useGeolocalisation } from "../geolocalisation";
import { useProfil, poidsApi } from "../profil";
import { ACCENT, CENTRE_DEMO, LIMITES_DEMO, ZOOM_DEMO } from "../config";
import {
  CentrerSurPoint,
  ClicsCarte,
  CoucheHeatmapAuto,
  FondDeCarte,
  LimiterDezoomCarte,
  RafraichirTaille,
} from "../carte-utils";
import AdresseSearch from "../components/AdresseSearch";
import Histogramme from "../components/Histogramme";
import HourSlider from "../components/HourSlider";
import MessageCalme from "../components/MessageCalme";

const TEXTE_LIEU_CARTE = "Lieu choisi sur la carte";

export default function QuandTab({ actif }) {
  const { profil } = useProfil();
  const { poids_bruit, poids_foule } = poidsApi(profil);
  const { statut: statutPosition, position: maPosition } = useGeolocalisation();

  const [heureActuelle] = useState(() => new Date().getHours());
  const [heureCarte, setHeureCarte] = useState(heureActuelle);
  const [destination, setDestination] = useState(null);
  const [texteLieu, setTexteLieu] = useState("");
  const [adresseAuto, setAdresseAuto] = useState("");
  const compteurAdresse = useRef(0);
  const [pointRecentre, setPointRecentre] = useState(null);
  const [donnees, setDonnees] = useState(null);
  const [analyseEnCours, setAnalyseEnCours] = useState(false);
  const [erreur, setErreur] = useState("");

  // Position reçue : la mini-carte se centre dessus, tant que l'utilisateur
  // n'a pas encore choisi de lieu à analyser.
  useEffect(() => {
    if (statutPosition !== "ok" || destination || texteLieu !== "") return;
    setPointRecentre({ lat: maPosition.lat, lng: maPosition.lng });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statutPosition]);

  useEffect(() => {
    if (!destination) return undefined;
    let annule = false;
    setAnalyseEnCours(true);
    appelApi("/api/quand", {
      lat: destination.lat.toFixed(6),
      lon: destination.lng.toFixed(6),
      jour: jourSemaine(),
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

  function choisirSurCarte(latlng) {
    setDestination(latlng);
    setTexteLieu(TEXTE_LIEU_CARTE);
    setErreur("");
    // remplace le libellé neutre par l'adresse du lieu tapé
    const numero = ++compteurAdresse.current;
    appelApi("/api/adresse-inverse", {
      lat: latlng.lat.toFixed(6),
      lon: latlng.lng.toFixed(6),
    })
      .then((reponse) => {
        if (!reponse.label || compteurAdresse.current !== numero) return;
        setAdresseAuto(reponse.label);
        setTexteLieu(reponse.label);
      })
      .catch(() => {
        // adresse introuvable : le libellé neutre suffit
      });
  }

  function changerTexteLieu(valeur) {
    setTexteLieu(valeur);
    if (valeur.trim() === "") {
      setDestination(null);
      setPointRecentre(null);
      setDonnees(null);
      setErreur("");
    }
  }

  function choisirLieu(suggestion) {
    const point = { lat: suggestion.lat, lng: suggestion.lng };
    setDestination(point);
    setPointRecentre(point);
    setTexteLieu(suggestion.label);
    setErreur("");
  }

  return (
    <div className="quand-onglet">
      <h1>Quand y aller</h1>
      <p className="consigne">Recherche un lieu ou touche la carte.</p>

      <div className="recherche-quand">
        <AdresseSearch
          label="Lieu à analyser"
          value={texteLieu}
          onChange={changerTexteLieu}
          onChoisir={choisirLieu}
          placeholder="Rue, lieu, adresse..."
          rechercheDesactivee={texteLieu === TEXTE_LIEU_CARTE || texteLieu === adresseAuto}
        />
      </div>

      <div className="curseur-quand">
        <HourSlider heure={heureCarte} onChange={setHeureCarte} label="Heure affichée" />
      </div>

      <div className="mini-carte">
        <MapContainer
          center={CENTRE_DEMO}
          zoom={ZOOM_DEMO}
          minZoom={11}
          zoomSnap={0.25}
          maxBounds={LIMITES_DEMO}
          maxBoundsViscosity={1.0}
          zoomControl={false}
          className="carte-pleine"
        >
          <FondDeCarte />
          <RafraichirTaille actif={actif} />
          <LimiterDezoomCarte actif={actif} limites={LIMITES_DEMO} />
          <CoucheHeatmapAuto
            actif={actif}
            heure={heureCarte}
            poidsBruit={poids_bruit}
            poidsFoule={poids_foule}
          />
          <CentrerSurPoint point={pointRecentre} />
          <ClicsCarte onClic={choisirSurCarte} />
          {destination && (
            <CircleMarker
              center={destination}
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
      </div>

      {!destination && !erreur && (
        <MessageCalme>
          Choisis un lieu par recherche ou sur la carte. Tu verras les heures les plus calmes pour y aller,
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
