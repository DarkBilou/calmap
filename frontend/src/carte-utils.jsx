import { useEffect } from "react";
import L from "leaflet";
import { TileLayer, useMap, useMapEvents } from "react-leaflet";

// Fond de carte volontairement sobre (CARTO Positron) : la couleur est
// réservée aux données sensorielles, le fond reste en retrait.
export function FondDeCarte() {
  return (
    <TileLayer
      url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
      subdomains="abcd"
      maxZoom={20}
    />
  );
}

/** Recalcule la taille de la carte quand son onglet redevient visible. */
export function RafraichirTaille({ actif }) {
  const map = useMap();
  useEffect(() => {
    if (actif) map.invalidateSize();
  }, [actif, map]);
  return null;
}

/** Couche GeoJSON gérée à la main : recréée quand `donnees` change. */
export function CoucheGeoJson({ donnees, style, interactive = false }) {
  const map = useMap();
  useEffect(() => {
    if (!donnees) return undefined;
    const couche = L.geoJSON(donnees, { style, interactive });
    couche.addTo(map);
    return () => {
      map.removeLayer(couche);
    };
    // `style` est une fonction recréée à chaque rendu : seule la donnée compte
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [donnees, map]);
  return null;
}

/** Remonte les taps sur la carte (latlng Leaflet). */
export function ClicsCarte({ onClic }) {
  useMapEvents({ click: (e) => onClic(e.latlng) });
  return null;
}
