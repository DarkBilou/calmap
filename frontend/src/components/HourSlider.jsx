export default function HourSlider({ heure, onChange }) {
  return (
    <div className="curseur-heure">
      <label htmlFor="curseur-heure">Heure</label>
      <input
        id="curseur-heure"
        type="range"
        min="0"
        max="23"
        step="1"
        value={heure}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output htmlFor="curseur-heure">{heure}&nbsp;h</output>
    </div>
  );
}
