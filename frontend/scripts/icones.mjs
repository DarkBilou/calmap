// Génère les icônes PWA (PNG) sans aucune dépendance : fond sarcelle #2A9D8F,
// anneau et point blancs (symbole « point calme sur la carte »).
// Usage : node scripts/icones.mjs   (depuis frontend/)
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const ACCENT = [0x2a, 0x9d, 0x8f];
const BLANC = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const octet of buf) crc = table[(crc ^ octet) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(data.length);
  const corps = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corps));
  return Buffer.concat([longueur, corps, crc]);
}

function png(taille, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(taille, 0);
  ihdr.writeUInt32BE(taille, 4);
  ihdr[8] = 8;  // 8 bits par canal
  ihdr[9] = 2;  // type couleur : RGB
  const lignes = [];
  for (let y = 0; y < taille; y++) {
    lignes.push(Buffer.from([0])); // filtre « aucun »
    lignes.push(pixels.subarray(y * taille * 3, (y + 1) * taille * 3));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(lignes))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Couverture anti-aliasée d'un disque : 1 dedans, 0 dehors, dégradé sur 1,5 px.
function disque(x, y, cx, cy, rayon) {
  const d = Math.hypot(x - cx, y - cy);
  return Math.min(1, Math.max(0, (rayon - d) / 1.5 + 0.5));
}

function dessiner(taille) {
  const pixels = Buffer.alloc(taille * taille * 3);
  const c = taille / 2;
  const r1 = taille * 0.32; // anneau extérieur
  const r2 = taille * 0.20; // anneau intérieur
  const r3 = taille * 0.09; // point central
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      const anneau = disque(x, y, c, c, r1) * (1 - disque(x, y, c, c, r2));
      const alpha = Math.max(anneau, disque(x, y, c, c, r3));
      const i = (y * taille + x) * 3;
      for (let k = 0; k < 3; k++) {
        pixels[i + k] = Math.round(ACCENT[k] + (BLANC[k] - ACCENT[k]) * alpha);
      }
    }
  }
  return pixels;
}

mkdirSync(new URL("../public/icons/", import.meta.url), { recursive: true });
for (const [nom, taille] of [["icon-192", 192], ["icon-512", 512], ["maskable-512", 512]]) {
  const chemin = new URL(`../public/icons/${nom}.png`, import.meta.url);
  writeFileSync(chemin, png(taille, dessiner(taille)));
  console.log(`✅ ${nom}.png (${taille}×${taille})`);
}
