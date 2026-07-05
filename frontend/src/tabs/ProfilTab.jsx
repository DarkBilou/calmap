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

const ETATS_DU_MOMENT = [
  { cle: "normal", libelle: "Normal" },
  { cle: "fatigue", libelle: "Fatigué" },
  { cle: "stresse", libelle: "Stressé" },
  { cle: "surcharge", libelle: "Surcharge proche" },
];

const ICONES_PROFIL = {
  profil: "/profile-icons/account.png",
  bruit: "/profile-icons/marketing.png",
  foule: "/profile-icons/multiple-users-silhouette.png",
  heureux: "/profile-icons/happy-face.png",
  neutre: "/profile-icons/neutral-face.png",
  triste: "/profile-icons/sad-face.png",
};

function IconeProfil({ src, alt }) {
  return <img className="icone-profil" src={src} alt={alt} aria-hidden={alt ? undefined : "true"} />;
}

function Curseur({ id, libelle, valeur, phrases, icone, onChange }) {
  return (
    <div className="carte-reglage">
      <div className="rang-libelle">
        <label className="libelle-avec-icone" htmlFor={id}>
          <IconeProfil src={icone} alt="" />
          <span>{libelle}</span>
        </label>
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

  return (
    <div className="profil-onglet">
      <h1 className="titre-avec-icone">
        <IconeProfil src={ICONES_PROFIL.profil} alt="" />
        <span>Mon profil</span>
      </h1>
      <p className="consigne">Tes préférences sensorielles ajustent la carte et les heures conseillées.</p>

      <Curseur
        id="curseur-bruit"
        libelle="Sensibilité au bruit"
        valeur={profil.bruit}
        phrases={PHRASES_BRUIT}
        icone={ICONES_PROFIL.bruit}
        onChange={(v) => majProfil("bruit", v)}
      />
      <Curseur
        id="curseur-foule"
        libelle="Sensibilité à la foule"
        valeur={profil.foule}
        phrases={PHRASES_FOULE}
        icone={ICONES_PROFIL.foule}
        onChange={(v) => majProfil("foule", v)}
      />

      <section className="carte-reglage groupe-profil" aria-labelledby="titre-etat-moment">
        <h2 id="titre-etat-moment" className="titre-groupe-profil">
          <span>État du moment</span>
          <span className="icones-etat" aria-hidden="true">
            <IconeProfil src={ICONES_PROFIL.heureux} alt="" />
            <IconeProfil src={ICONES_PROFIL.neutre} alt="" />
            <IconeProfil src={ICONES_PROFIL.triste} alt="" />
          </span>
        </h2>
        <p className="description-groupe">
          Ton besoin de calme augmente tant que c'est sélectionné.
        </p>
        <div className="choix-etat" role="radiogroup" aria-labelledby="titre-etat-moment">
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
      </section>

      <p className="note-vie-privee">
        <strong>Ton profil reste sur ton téléphone.</strong>
        <br />
        Il n'est enregistré nulle part ailleurs.
      </p>
    </div>
  );
}
