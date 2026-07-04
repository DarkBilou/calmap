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

function appliquerLimiteDezoom(map, limites) {
  const bounds = L.latLngBounds(limites);
  const minZoom = map.getBoundsZoom(bounds, true);
  if (Number.isFinite(minZoom)) {
    map.setMinZoom(minZoom);
    if (map.getZoom() < minZoom) map.setZoom(minZoom, { animate: false });
  }
  map.setMaxBounds(bounds);
  map.panInsideBounds(bounds, { animate: false });
}

/** Empeche le dezoom d'afficher plus grand que le rectangle modelise. */
export function LimiterDezoomCarte({ actif, limites }) {
  const map = useMap();

  useEffect(() => {
    if (!actif) return undefined;

    const appliquer = () => {
      map.invalidateSize();
      appliquerLimiteDezoom(map, limites);
    };

    appliquer();
    map.on("resize", appliquer);
    return () => {
      map.off("resize", appliquer);
    };
  }, [actif, limites, map]);

  return null;
}

/** Recentre la carte sur un point choisi par recherche, sans animation. */
export function CentrerSurPoint({ point }) {
  const map = useMap();
  useEffect(() => {
    if (!point) return;
    map.setView([point.lat, point.lng], Math.max(map.getZoom(), 16), { animate: false });
  }, [map, point]);
  return null;
}

/** Calcule les limites visibles dans le format attendu par l'API. */
function bornesVisibles(map) {
  const bornes = map.getBounds();
  return {
    sud: bornes.getSouth().toFixed(6),
    nord: bornes.getNorth().toFixed(6),
    ouest: bornes.getWest().toFixed(6),
    est: bornes.getEast().toFixed(6),
  };
}

/** Remonte les limites visibles pour charger seulement les rues affichees. */
export function SuivreBornesCarte({ actif, onChange }) {
  const map = useMapEvents({
    moveend: () => {
      if (actif) onChange(bornesVisibles(map));
    },
    zoomend: () => {
      if (actif) onChange(bornesVisibles(map));
    },
  });

  useEffect(() => {
    if (actif) onChange(bornesVisibles(map));
  }, [actif, map, onChange]);

  return null;
}

/** Couche GeoJSON geree a la main : recreee quand `donnees` change. */
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
