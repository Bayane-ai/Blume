import { useState, useEffect, useCallback } from "react";
import { useRequireAuth } from "../lib/useRequireAuth";
import SiteHeader from "./SiteHeader";
import PronosticHistoryCard from "./PronosticHistoryCard";

// Corps partagé par pages/probabilites-reussies.js et pages/probabilites-echouees.js —
// même structure et même logique pour les deux (voir PROMPT étapes 3/4), seuls le
// statut interrogé, le titre et le message "liste vide" changent. La liste vient de
// /api/pronostic-history, qui nettoie les entrées de plus de 5 jours et revérifie les
// matchs encore "pending" à chaque appel — donc à chaque chargement de cette page.
export default function PronosticHistoryPage({ status, title, subtitle, emptyMessage, testId }) {
  const { session, sessionChecked, authorized } = useRequireAuth();
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    return fetch(`/api/pronostic-history?status=${status}`)
      .then((r) => r.json())
      .then((d) => setItems(Array.isArray(d?.items) ? d.items : []))
      .catch((e) => {
        console.error("Erreur /api/pronostic-history:", e);
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    if (!authorized) return;
    load();
  }, [authorized, load]);

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
          <h1 style={st.heroTitle}>{title}</h1>
          <p style={st.heroSubtitle}>{subtitle}</p>
        </section>

        {loading && <p style={st.hint}>Chargement…</p>}
        {!loading && list.length === 0 && <p style={st.hint}>{emptyMessage}</p>}

        <div style={st.list} data-testid={testId}>
          {list.map((item) => (
            <PronosticHistoryCard key={item.match_id} item={item} />
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
  heroSubtitle: { fontSize: 12, color: "#5C7A6A", margin: 0, lineHeight: 1.5 },
  hint: { fontSize: 12.5, color: "#5C7A6A" },
  list: { display: "flex", flexDirection: "column", gap: 10 },
};
