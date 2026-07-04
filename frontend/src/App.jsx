import { useEffect, useState } from "react";
import { FournisseurProfil } from "./profil";
import { appelApi } from "./api";
import TabBar from "./components/TabBar";
import CarteTab from "./tabs/CarteTab";
import QuandTab from "./tabs/QuandTab";
import ProfilTab from "./tabs/ProfilTab";

// Les trois onglets restent montés (cartes Leaflet conservées) ; seul
// l'onglet actif est visible.
export default function App() {
  const [onglet, setOnglet] = useState("carte");
  const [bruitSimule, setBruitSimule] = useState(false);

  useEffect(() => {
    appelApi("/api/health")
      .then((sante) => setBruitSimule(sante.bruit_source === "synthetique"))
      .catch(() => {
        // serveur injoignable : chaque onglet affichera son propre message
      });
  }, []);

  return (
    <FournisseurProfil>
      <div className="app">
        {bruitSimule && <p className="bandeau-demo">Démo : bruit simulé</p>}
        <main className="contenu">
          <div className={onglet === "carte" ? "onglet actif" : "onglet"}>
            <CarteTab actif={onglet === "carte"} />
          </div>
          <div className={onglet === "quand" ? "onglet actif" : "onglet"}>
            <QuandTab actif={onglet === "quand"} />
          </div>
          <div className={onglet === "profil" ? "onglet actif" : "onglet"}>
            <ProfilTab />
          </div>
        </main>
        <TabBar onglet={onglet} onChange={setOnglet} />
      </div>
    </FournisseurProfil>
  );
}
