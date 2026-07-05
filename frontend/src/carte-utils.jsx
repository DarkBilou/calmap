import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { TileLayer, useMap, useMapEvents } from "react-leaflet";
import { appelApi } from "./api";
import { composantesScore, couleurScore } from "./couleurs";

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
  // Marge de 35 % autour de la zone : sans elle, le centre serait verrouillé
  // dès que la fenêtre dépasse la zone, et le cadrage d'un itinéraire au-dessus
  // de la fiche comparative deviendrait impossible sur téléphone.
  const bounds = L.latLngBounds(limites).pad(0.35);
  // Le dézoom s'arrête quand la zone de démo entière est visible : on peut
  // ainsi voir tout Paris d'un coup, sans dériver loin au-delà de la zone.
  const minZoom = map.getBoundsZoom(bounds, false);
  if (Number.isFinite(minZoom)) {
    map.setMinZoom(minZoom);
    if (map.getZoom() < minZoom) map.setZoom(minZoom, { animate: false });
  }
  map.setMaxBounds(bounds);
  map.panInsideBounds(bounds, { animate: false });
}

/** Empêche le dézoom d'afficher plus grand que la zone modélisée. */
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

/** Limites à demander à l'API : la vue élargie de 30 %, pour que les petits
    déplacements restent couverts par la dernière réponse. */
function bornesAvecMarge(map) {
  const bornes = map.getBounds().pad(0.3);
  return {
    sud: bornes.getSouth().toFixed(6),
    nord: bornes.getNorth().toFixed(6),
    ouest: bornes.getWest().toFixed(6),
    est: bornes.getEast().toFixed(6),
  };
}

/** Remonte les limites visibles pour charger seulement les rues affichées.
    Ne signale un changement que si la vue sort de la zone déjà chargée ou
    demande plus de détail (zoom avant) : évite un rechargement complet de la
    heatmap à chaque petit déplacement de la carte. */
export function SuivreBornesCarte({ actif, onChange }) {
  const derniereZone = useRef(null); // { bornes: LatLngBounds élargies, zoom }

  function signaler(map) {
    const visibles = map.getBounds();
    const zoom = map.getZoom();
    const d = derniereZone.current;
    if (d && d.zoom >= zoom && d.bornes.contains(visibles)) return;
    derniereZone.current = { bornes: visibles.pad(0.3), zoom };
    onChange(bornesAvecMarge(map));
  }

  const map = useMapEvents({
    // moveend suffit : Leaflet l'émet aussi à la fin d'un zoom
    moveend: () => {
      if (actif) signaler(map);
    },
  });

  useEffect(() => {
    if (actif) signaler(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actif, map, onChange]);

  return null;
}

/** Couche GeoJSON geree a la main : recreee quand `donnees` change. */
export function CoucheGeoJson({ donnees, style, pointToLayer, interactive = false }) {
  const map = useMap();
  useEffect(() => {
    if (!donnees) return undefined;
    const couche = L.geoJSON(donnees, { style, pointToLayer, interactive });
    couche.addTo(map);
    return () => {
      map.removeLayer(couche);
    };
    // `style` et `pointToLayer` sont recréés à chaque rendu : seule la donnée compte
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [donnees, map]);
  return null;
}

const OPACITE_NUAGES = 0.28; // on voit la carte à travers la nappe

/** Image floutée construite à partir des nuages (Points + demi-cellule). */
function imageNuages(features) {
  const { demi_lon: demiLon, demi_lat: demiLat } = features[0].properties;
  const pasLon = 2 * demiLon;
  const pasLat = 2 * demiLat;

  let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  for (const f of features) {
    const [lon, lat] = f.geometry.coordinates;
    if (lon < lonMin) lonMin = lon;
    if (lon > lonMax) lonMax = lon;
    if (lat < latMin) latMin = lat;
    if (lat > latMax) latMax = lat;
  }
  const colonnes = Math.round((lonMax - lonMin) / pasLon) + 1;
  const lignes = Math.round((latMax - latMin) / pasLat) + 1;

  // 1 pixel par cellule de la grille, cellules vides transparentes
  const grille = document.createElement("canvas");
  grille.width = colonnes;
  grille.height = lignes;
  const contexteGrille = grille.getContext("2d");
  const pixels = contexteGrille.createImageData(colonnes, lignes);
  for (const f of features) {
    const [lon, lat] = f.geometry.coordinates;
    const c = Math.round((lon - lonMin) / pasLon);
    const r = Math.round((latMax - lat) / pasLat); // l'axe y du canvas descend
    const [rouge, vert, bleu] = composantesScore(f.properties.score);
    const o = (r * colonnes + c) * 4;
    pixels.data[o] = rouge;
    pixels.data[o + 1] = vert;
    pixels.data[o + 2] = bleu;
    pixels.data[o + 3] = Math.round(OPACITE_NUAGES * 255);
  }
  contexteGrille.putImageData(pixels, 0, 0);

  // Agrandissement + flou gaussien : les cellules fondent les unes dans les
  // autres et les bords de la nappe s'estompent en douceur.
  const echelle = 8;
  const image = document.createElement("canvas");
  image.width = colonnes * echelle;
  image.height = lignes * echelle;
  const contexte = image.getContext("2d");
  contexte.filter = `blur(${echelle}px)`;
  contexte.imageSmoothingEnabled = true;
  contexte.drawImage(grille, 0, 0, image.width, image.height);

  return {
    url: image.toDataURL("image/png"),
    bornes: [
      [latMin - demiLat, lonMin - demiLon],
      [latMax + demiLat, lonMax + demiLon],
    ],
  };
}

/** Nappe « nuages » de la vue dézoomée : image floutée posée sur la carte. */
export function CoucheNuages({ donnees }) {
  const map = useMap();
  useEffect(() => {
    if (!donnees || !donnees.features || donnees.features.length === 0) return undefined;
    const { url, bornes } = imageNuages(donnees.features);
    const couche = L.imageOverlay(url, bornes, { interactive: false });
    couche.addTo(map);
    return () => {
      map.removeLayer(couche);
    };
  }, [donnees, map]);
  return null;
}

function styleRuesHeatmap(feature) {
  return { color: couleurScore(feature.properties.score), weight: 3, opacity: 0.75 };
}

/** Heatmap autonome : suit la vue de la carte, charge /api/heatmap et bascule
    d'elle-même entre nuages (vue large) et rues (vue rapprochée). Couche
    d'ambiance : en cas d'erreur réseau elle disparaît sans message, l'onglet
    hôte garde ses propres messages calmes. */
export function CoucheHeatmapAuto({ actif, heure, poidsBruit, poidsFoule }) {
  const [donnees, setDonnees] = useState(null);
  const [bornes, setBornes] = useState(null);

  useEffect(() => {
    if (!bornes) return undefined;
    const controleur = new AbortController();
    const minuterie = setTimeout(() => {
      appelApi(
        "/api/heatmap",
        { heure, poids_bruit: poidsBruit, poids_foule: poidsFoule, ...bornes },
        { signal: controleur.signal }
      )
        .then((reponse) => {
          if (!controleur.signal.aborted) setDonnees(reponse);
        })
        .catch(() => {
          // couche décorative : pas de message dédié
        });
    }, 250);
    return () => {
      clearTimeout(minuterie);
      controleur.abort();
    };
  }, [heure, poidsBruit, poidsFoule, bornes]);

  const enNuages = Boolean(donnees?.features?.[0]?.properties?.nuage);
  return (
    <>
      <SuivreBornesCarte actif={actif} onChange={setBornes} />
      {enNuages
        ? <CoucheNuages donnees={donnees} />
        : <CoucheGeoJson donnees={donnees} style={styleRuesHeatmap} />}
    </>
  );
}

/** Cadre la carte pour montrer les tracés rapide + calme en intégralité,
    dans la zone réellement libre entre la barre d'outils et la fiche
    comparative : leurs hauteurs sont mesurées dans le DOM (elles varient
    selon les textes et la largeur d'écran). Sans animation (design). */
export function CadrerSurTrajet({ route, actif, demande = 0 }) {
  const map = useMap();
  useEffect(() => {
    if (!actif || !route) return;
    const points = [
      ...route.rapide.geojson.geometry.coordinates,
      ...route.calme.geojson.geometry.coordinates,
    ].map(([lon, lat]) => [lat, lon]);
    if (points.length === 0) return;
    map.invalidateSize();

    const cadre = map.getContainer().getBoundingClientRect();
    const parent = map.getContainer().parentElement; // .zone-carte (overlays)
    const barre = parent.querySelector(".outils-carte");
    const feuille = parent.querySelector(".feuille");
    const marge = 24;
    let haut = barre
      ? barre.getBoundingClientRect().bottom - cadre.top + marge
      : 90;
    let bas = feuille
      ? cadre.bottom - feuille.getBoundingClientRect().top + marge
      : 330;
    // Petit écran : on garantit au moins 150 px de carte visible, quitte à
    // laisser le bas du trajet passer sous la fiche.
    const visibleMin = 150;
    if (cadre.height - haut - bas < visibleMin) {
      bas = Math.max(marge, cadre.height - haut - visibleMin);
    }

    map.fitBounds(L.latLngBounds(points), {
      paddingTopLeft: L.point(36, haut),
      paddingBottomRight: L.point(36, bas),
      animate: false,
    });
  }, [map, route, actif, demande]);
  return null;
}

/** Remonte les taps sur la carte (latlng Leaflet). */
export function ClicsCarte({ onClic }) {
  useMapEvents({ click: (e) => onClic(e.latlng) });
  return null;
}
