import { useState, useEffect } from "react";
import { useRequireAuth } from "../lib/useRequireAuth";
import { listMatchHistory } from "../lib/matchHistory";
import SiteHeader from "../components/SiteHeader";
import MatchHistoryCard from "../components/MatchHistoryCard";

// Page "Historique" (voir PROMPT) : les matchs dont l'utilisateur a déjà ouvert
// l'analyse/les pronostics, du plus récent au plus ancien — voir lib/matchHistory.js
// (journal côté navigateur, jamais effacé par la fin d'un match, seulement par le
// temps : ~10 jours après consultation). Aucun bouton "Analyser" ici (voir
// components/MatchHistoryCard.js) : cette page rappelle seulement ce qui a déjà été
// consulté.
export default function Historique() {
  const { session, sessionChecked, authorized } = useRequireAuth();
  const [items, setItems] = useState(null);

  useEffect(() => {
    if (!authorized) return;
    setItems(listMatchHistory());
  }, [authorized]);

  if (!sessionChecked) {
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
      <SiteHeader session={session} />

      <main style={st.main}>
        <section style={st.hero}>
          <h1 style={st.heroTitle}>Historique</h1>
          <p style={st.heroSubtitle}>
            Les matchs dont tu as déjà consulté les pronostics, du plus récent au plus ancien — chaque
            entrée disparaît automatiquement environ 10 jours après avoir été consultée.
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
