import React from "react";
import ReactDOM from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import App from "./App";

// Garde-fou : en cas d'erreur imprévue, un message calme — jamais d'écran blanc.
class GardeFou extends React.Component {
  constructor(props) {
    super(props);
    this.state = { erreur: false };
  }

  static getDerivedStateFromError() {
    return { erreur: true };
  }

  render() {
    if (this.state.erreur) {
      return (
        <div className="garde-fou">
          <h1>Un souci est survenu</h1>
          <p>Ce n'est pas grave. Recharge la page pour reprendre.</p>
          <button className="bouton bouton-plein" onClick={() => window.location.reload()}>
            Recharger
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <GardeFou>
      <App />
    </GardeFou>
  </React.StrictMode>
);

// Service worker : uniquement en production (le cache gênerait le dev).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // hors HTTPS/localhost l'installation échoue : l'app marche quand même
    });
  });
}
