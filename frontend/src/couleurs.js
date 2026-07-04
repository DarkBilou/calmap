// Dégradé sensoriel de la heatmap : vert (calme) → sable → orange (animé).
// Le passage par un jaune sable évite le brun terne d'un mélange direct
// vert/orange, tout en restant un dégradé vert → orange à la lecture.
const ARRETS = [
  [0x2a, 0x9d, 0x8f], // #2A9D8F — calme
  [0xe9, 0xc4, 0x6a], // #E9C46A — intermédiaire
  [0xe7, 0x6f, 0x51], // #E76F51 — animé
];

/** Couleur CSS pour un score sensoriel ∈ [0, 1]. */
export function couleurScore(score) {
  const s = Math.min(1, Math.max(0, Number(score) || 0));
  const position = s * (ARRETS.length - 1);
  const i = Math.min(ARRETS.length - 2, Math.floor(position));
  const t = position - i;
  const canal = (k) => Math.round(ARRETS[i][k] + (ARRETS[i + 1][k] - ARRETS[i][k]) * t);
  return `rgb(${canal(0)}, ${canal(1)}, ${canal(2)})`;
}
