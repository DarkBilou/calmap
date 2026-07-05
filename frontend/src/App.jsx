import { useState } from "react";
import { FournisseurProfil } from "./profil";
import TabBar from "./components/TabBar";
import CarteTab from "./tabs/CarteTab";
import QuandTab from "./tabs/QuandTab";
import ProfilTab from "./tabs/ProfilTab";

// Les trois onglets restent montés (cartes Leaflet conservées) ; seul
// l'onglet actif est visible.
export default function App() {
  const [onglet, setOnglet] = useState("carte");

  return (
    <FournisseurProfil>
      <div className="app">
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
