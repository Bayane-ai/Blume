import { useState, useEffect } from "react";
import { useRequireAuth } from "../lib/useRequireAuth";
import { useSport } from "../lib/useSport";
import { listMatchHistory } from "../lib/matchHistory";
import SiteHeader from "../components/SiteHeader";
import MatchHistoryCard from "../components/MatchHistoryCard";

// Page "Historique" (voir PROMPT) : les matchs dont CE COMPTE a déjà ouvert l'analyse/
// les pronostics, QUEL QUE SOIT LE SPORT (bloc 9 : football/basket/tennis mélangés
// dans une seule liste, chaque entrée portant son propre badge de sport, voir
// components/MatchHistoryCard.js), du plus récent au plus ancien — voir
// lib/matchHistory.js (table match_history, personnelle à chaque compte, filtrée côté
// serveur par profile_id, voir pages/api/match-history.js, jamais effacée par la fin
// d'un match, seulement par le temps : ~10 jours après consultation). Aucun bouton
// "Analyser" ici (voir components/MatchHistoryCard.js) : cette page rappelle
// seulement ce qui a déjà été consulté. pages/match/[id].js ajoute déjà CHAQUE match
// consulté à l'historique, quel que soit son sport (aucune condition `isBasketball`/
// `isTennis` sur cet ajout) — cette page se contentait jusqu'ici de le masquer
// derrière un placeholder "bientôt disponible" pour Basket/Tennis alors que la donnée
// existait déjà : ce gate est donc simplement retiré, jamais une nouvelle collecte.
export default function Historique() {
  const { session, sessionChecked, authorized } = useRequireAuth();
  const { sport, setSport, sportReady } = useSport();
  const userId = session?.id;
  const [items, setItems] = useState(null);

  useEffect(() => {
    if (!authorized || !userId) return;
    listMatchHistory(userId).then(setItems);
  }, [authorized, userId]);

  if (!sessionChecked || !sportReady) {
    return (
      <div style={st.page}>
        <p style={st.hint}>Chargement…</p>
      </div>
    );
  }
  if (!authorized) return null;

  const list = items || [];

  return (
    <div style={st.page}>
      <SiteHeader session={session} sport={sport} onSportChange={setSport} />

      <main style={st.main}>
        <section style={st.hero}>
          <h1 style={st.heroTitle}>Historique</h1>
          <p style={st.heroSubtitle}>
            Les matchs (football, basket, tennis) dont tu as déjà consulté les pronostics, du plus récent au
            plus ancien — chaque entrée disparaît automatiquement environ 10 jours après avoir été consultée.
          </p>
        </section>

        {items === null && <p style={st.hint}>Chargement…</p>}
        {items !== null && list.length === 0 && (
          <p style={st.hint} data-testid="match-history-empty">Aucun match consulté pour le moment.</p>
        )}

        <div style={st.list} data-testid="match-history-list">
          {list.map((entry) => (
            <MatchHistoryCard key={entry.id} entry={entry} />
          ))}
        </div>
      </main>
    </div>
  );
}

const st = {
  page: { minHeight: "100vh", padding: "20px 16px 60px" },
  main: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  hero: { textAlign: "center", padding: "8px 4px" },
  heroTitle: { fontSize: 21, fontWeight: 800, margin: "0 0 8px", lineHeight: 1.25 },
  heroSubtitle: { fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 },
  hint: { fontSize: 12.5, color: "var(--text-secondary)" },
  list: { display: "flex", flexDirection: "column", gap: 10 },
};
