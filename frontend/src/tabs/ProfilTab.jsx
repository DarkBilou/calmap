import { useProfil } from "../profil";

// Phrases de niveau : la valeur du curseur (pas la valeur ajustée par l'état
// du moment) choisit la phrase — le texte reste stable quand l'état change.
const PHRASES_BRUIT = [
  "Les bruits de fond me gênent rarement.",
  "Les lieux animés peuvent me fatiguer après un moment.",
  "Je préfère éviter les rues très bruyantes.",
  "Certains bruits peuvent vite devenir difficiles.",
];

const PHRASES_FOULE = [
  "Les zones fréquentées ne me gênent pas vraiment.",
  "La foule peut me fatiguer après un moment.",
  "Je préfère éviter les zones denses ou les files d'attente.",
  "Les lieux bondés peuvent vite devenir difficiles.",
];

function phraseNiveau(valeur, phrases) {
  if (valeur <= 25) return phrases[0];
  if (valeur <= 50) return phrases[1];
  if (valeur <= 75) return phrases[2];
  return phrases[3];
}

const SONS_DIFFICILES = [
  { cle: "constants", titre: "Bruits constants", exemples: "circulation, ventilation, fond sonore continu" },
  { cle: "soudains", titre: "Bruits soudains", exemples: "klaxons, sirènes, cris, travaux" },
  { cle: "humains", titre: "Bruits humains", exemples: "conversations, enfants, groupes" },
  { cle: "gravesAigus", titre: "Bruits graves ou aigus", exemples: "métro, freins, alarmes" },
];

const ETATS_DU_MOMENT = [
  { cle: "normal", libelle: "Normal" },
  { cle: "fatigue", libelle: "Fatigué" },
  { cle: "stresse", libelle: "Stressé" },
  { cle: "surcharge", libelle: "Surcharge proche" },
];

function Curseur({ id, libelle, valeur, phrases, onChange }) {
  return (
    <div className="carte-reglage">
      <div className="rang-libelle">
        <label htmlFor={id}>{libelle}</label>
        <output htmlFor={id}>{valeur} / 100</output>
      </div>
      <input
        id={id}
        type="range"
        min="0"
        max="100"
        step="5"
        value={valeur}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <p className="phrase-niveau">{phraseNiveau(valeur, phrases)}</p>
    </div>
  );
}

export default function ProfilTab() {
  const { profil, majProfil } = useProfil();

  function majSon(cle, coche) {
    majProfil("sonsDifficiles", { ...profil.sonsDifficiles, [cle]: coche });
  }

  return (
    <div className="profil-onglet">
      <h1>Mon profil</h1>
      <p className="consigne">Tes préférences sensorielles ajustent la carte et les heures conseillées.</p>

      <Curseur
        id="curseur-bruit"
        libelle="Sensibilité au bruit"
        valeur={profil.bruit}
        phrases={PHRASES_BRUIT}
        onChange={(v) => majProfil("bruit", v)}
      />
      <Curseur
        id="curseur-foule"
        libelle="Sensibilité à la foule"
        valeur={profil.foule}
        phrases={PHRASES_FOULE}
        onChange={(v) => majProfil("foule", v)}
      />

      <fieldset className="carte-reglage groupe-profil">
        <legend>Sons difficiles</legend>
        <p className="description-groupe">
          Coche ce qui te gêne le plus.
        </p>
        {SONS_DIFFICILES.map(({ cle, titre, exemples }) => (
          <label key={cle} className="case-son">
            <input
              type="checkbox"
              checked={profil.sonsDifficiles[cle]}
              onChange={(e) => majSon(cle, e.target.checked)}
            />
            <span>
              <strong>{titre}</strong>
              <span className="exemples-son">{exemples}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="carte-reglage groupe-profil">
        <legend>État du moment</legend>
        <p className="description-groupe">
          Ton besoin de calme augmente tant que c'est sélectionné.
        </p>
        <div className="choix-etat">
          {ETATS_DU_MOMENT.map(({ cle, libelle }) => (
            <label key={cle} className={profil.etat === cle ? "bouton-etat actif" : "bouton-etat"}>
              <input
                type="radio"
                name="etat-du-moment"
                value={cle}
                checked={profil.etat === cle}
                onChange={() => majProfil("etat", cle)}
              />
              {libelle}
            </label>
          ))}
        </div>
      </fieldset>

      <p className="note-vie-privee">
        <strong>Ton profil reste sur ton téléphone.</strong>
        <br />
        Il n'est enregistré nulle part ailleurs.
      </p>
    </div>
  );
}
