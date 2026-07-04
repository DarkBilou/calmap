const ICONES = {
  carte: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  quand: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.8 2" />
    </svg>
  ),
  profil: (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5c1.6-3 4-4.5 7-4.5s5.4 1.5 7 4.5" />
    </svg>
  ),
};

const ONGLETS = [
  { id: "carte", libelle: "Carte" },
  { id: "quand", libelle: "Quand y aller" },
  { id: "profil", libelle: "Mon profil" },
];

export default function TabBar({ onglet, onChange }) {
  return (
    <nav className="barre-onglets" aria-label="Navigation principale">
      {ONGLETS.map(({ id, libelle }) => (
        <button
          key={id}
          type="button"
          aria-current={onglet === id ? "page" : undefined}
          onClick={() => onChange(id)}
        >
          {ICONES[id]}
          <span>{libelle}</span>
        </button>
      ))}
    </nav>
  );
}
