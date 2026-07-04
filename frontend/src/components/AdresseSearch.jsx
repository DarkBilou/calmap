import { useEffect, useId, useState } from "react";
import { rechercherAdresses } from "../api";

const DELAI_RECHERCHE_MS = 350;

export default function AdresseSearch({
  label,
  value,
  onChange,
  onChoisir,
  placeholder,
  rechercheDesactivee = false,
}) {
  const id = useId();
  const [suggestions, setSuggestions] = useState([]);
  const [message, setMessage] = useState("");
  const [chargement, setChargement] = useState(false);
  const [valeurChoisie, setValeurChoisie] = useState("");

  useEffect(() => {
    const requete = value.trim();
    if (rechercheDesactivee || requete.length < 3 || requete === valeurChoisie) {
      setSuggestions([]);
      setMessage("");
      setChargement(false);
      return undefined;
    }

    const controleur = new AbortController();
    const minuterie = setTimeout(() => {
      setChargement(true);
      rechercherAdresses(requete, { signal: controleur.signal })
        .then((resultats) => {
          setSuggestions(resultats);
          setMessage(resultats.length === 0 ? "Adresse introuvable" : "");
        })
        .catch((erreur) => {
          if (erreur.name !== "AbortError") {
            setSuggestions([]);
            setMessage("Recherche indisponible pour le moment");
          }
        })
        .finally(() => {
          if (!controleur.signal.aborted) setChargement(false);
        });
    }, DELAI_RECHERCHE_MS);

    return () => {
      clearTimeout(minuterie);
      controleur.abort();
    };
  }, [rechercheDesactivee, value, valeurChoisie]);

  function changerValeur(evenement) {
    setValeurChoisie("");
    onChange(evenement.target.value);
  }

  function choisirSuggestion(suggestion) {
    setValeurChoisie(suggestion.label);
    setSuggestions([]);
    setMessage("");
    onChoisir(suggestion);
  }

  const listeId = `${id}-suggestions`;
  const suggestionsVisibles = suggestions.length > 0;

  return (
    <div className="champ-adresse">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="search"
        value={value}
        onChange={changerValeur}
        placeholder={placeholder}
        autoComplete="off"
        aria-autocomplete="list"
        aria-controls={listeId}
      />

      {chargement && <p className="texte-discret">Recherche...</p>}

      {suggestionsVisibles && (
        <ul className="suggestions-adresse" id={listeId}>
          {suggestions.map((suggestion) => (
            <li key={suggestion.id}>
              <button type="button" onClick={() => choisirSuggestion(suggestion)}>
                {suggestion.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {message && <p className="texte-erreur" role="status">{message}</p>}
    </div>
  );
}
