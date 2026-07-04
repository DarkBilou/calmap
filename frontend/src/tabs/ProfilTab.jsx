import { useProfil, sensibiliteEffective } from "../profil";

function Curseur({ id, libelle, valeur, journeeDifficile, onChange }) {
  const effective = sensibiliteEffective(valeur, journeeDifficile);
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
      {journeeDifficile && effective !== valeur && (
        <p className="valeur-effective">Aujourd'hui : {effective} / 100</p>
      )}
    </div>
  );
}

export default function ProfilTab() {
  const { profil, majProfil } = useProfil();

  return (
    <div className="profil-onglet">
      <h1>Mon profil</h1>
      <p className="consigne">Ces réglages ajustent la carte et les heures conseillées.</p>

      <Curseur
        id="curseur-bruit"
        libelle="Sensibilité au bruit"
        valeur={profil.bruit}
        journeeDifficile={profil.journeeDifficile}
        onChange={(v) => majProfil("bruit", v)}
      />
      <Curseur
        id="curseur-foule"
        libelle="Sensibilité à la foule"
        valeur={profil.foule}
        journeeDifficile={profil.journeeDifficile}
        onChange={(v) => majProfil("foule", v)}
      />

      <div className="carte-reglage rang-bascule">
        <div>
          <label htmlFor="journee-difficile">Journée difficile</label>
          <p className="description-bascule" id="journee-difficile-desc">
            Sensibilité augmentée de 30&nbsp;% tant que c'est activé.
          </p>
        </div>
        <input
          id="journee-difficile"
          type="checkbox"
          role="switch"
          checked={profil.journeeDifficile}
          aria-describedby="journee-difficile-desc"
          onChange={(e) => majProfil("journeeDifficile", e.target.checked)}
        />
      </div>

      <p className="note-vie-privee">
        <strong>Ton profil reste sur ton téléphone.</strong>
        <br />
        Il n'est enregistré nulle part ailleurs.
      </p>
    </div>
  );
}
