// Histogramme 24 barres fait main (aucune lib de charts) : une barre par
// heure, hauteur = charge sensorielle. Créneau conseillé en vert, heures
// passées grisées. Les valeurs exactes sont lisibles dans le tableau replié.
const HEURES_AXE = [0, 6, 12, 18];

export default function Histogramme({ scores, creneau, heureActuelle }) {
  const maxScore = Math.max(0.05, ...scores.map((s) => s.score));

  // Le créneau conseillé reste surligné même s'il est déjà passé :
  // c'est l'information principale de l'écran.
  function classeBarre(heure) {
    if (heure >= creneau.debut && heure < creneau.fin) return "barre optimale";
    if (heure < heureActuelle) return "barre passee";
    return "barre";
  }

  function etatBarre(heure) {
    if (heure < heureActuelle) return ", heure passée";
    if (heure >= creneau.debut && heure < creneau.fin) return ", créneau conseillé";
    return "";
  }

  const resume = `Charge sensorielle par heure. Créneau le plus calme : de ${creneau.debut} h à ${creneau.fin} h.`;

  return (
    <div className="bloc-histogramme">
      <p className="creneau-conseille">
        Créneau le plus calme : <strong>{creneau.debut} h – {creneau.fin} h</strong>
      </p>

      <div className="histogramme" role="img" aria-label={resume}>
        {scores.map(({ heure, score }) => (
          <div
            key={heure}
            className={classeBarre(heure)}
            style={{ height: `${Math.max(3, (score / maxScore) * 100)}%` }}
          />
        ))}
      </div>
      <div className="axe-heures" aria-hidden="true">
        {scores.map(({ heure }) => (
          <span key={heure}>{HEURES_AXE.includes(heure) ? `${heure} h` : ""}</span>
        ))}
      </div>

      <p className="note-lecture">
        Plus la barre est basse, plus c'est calme. Les heures passées sont grisées.
      </p>

      <details className="details-valeurs">
        <summary>Voir les valeurs heure par heure</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Heure</th>
              <th scope="col">Charge</th>
            </tr>
          </thead>
          <tbody>
            {scores.map(({ heure, score }) => (
              <tr key={heure}>
                <td>{heure} h</td>
                <td>
                  {Math.round(score * 100)} %{etatBarre(heure)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
