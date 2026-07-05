import { useEffect, useState } from "react";
import { LIMITES_DEMO } from "./config";

// Position demandée une seule fois, sans haute précision (suffisant pour un
// départ piéton, plus rapide et plus sobre en batterie).
const OPTIONS = { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 };

export function dansZoneDemo(lat, lng) {
  const [[sud, ouest], [nord, est]] = LIMITES_DEMO;
  return lat >= sud && lat <= nord && lng >= ouest && lng <= est;
}

/**
 * Position de l'appareil au lancement de l'application.
 * statut : "recherche" (en attente), "ok" (position dans la zone de démo),
 * "hors-zone" (position obtenue mais hors Paris + Issy), "indisponible"
 * (refus, timeout ou API absente — exige HTTPS ou localhost).
 */
export function useGeolocalisation() {
  const [etat, setEtat] = useState({ statut: "recherche", position: null });

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setEtat({ statut: "indisponible", position: null });
      return undefined;
    }
    let annule = false;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (annule) return;
        const position = { lat: coords.latitude, lng: coords.longitude };
        setEtat(dansZoneDemo(position.lat, position.lng)
          ? { statut: "ok", position }
          : { statut: "hors-zone", position });
      },
      () => {
        if (!annule) setEtat({ statut: "indisponible", position: null });
      },
      OPTIONS
    );
    return () => {
      annule = true;
    };
  }, []);

  return etat;
}
