import { useId } from "react";

export default function HourSlider({ heure, onChange, label = "Heure" }) {
  const id = useId();

  return (
    <div className="curseur-heure">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min="0"
        max="23"
        step="1"
        value={heure}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output htmlFor={id}>{heure}&nbsp;h</output>
    </div>
  );
}
