import { useState, useEffect, useMemo, useCallback } from "react";
import { useRequireAuth } from "../lib/useRequireAuth";
import MatchCard from "../components/MatchCard";
import SiteHeader from "../components/SiteHeader";

const UPCOMING_STATUSES = ["SCHEDULED", "TIMED"];
// Les matchs à venir changent moins vite que le direct, mais un rafraîchissement
// périodique permet quand même de voir un match basculer en direct sans recharger la
// page, et de se rétablir tout seul après un incident passager de l'API (quota,
// réseau) sans jamais laisser l'utilisateur bloqué sur un message d'erreur permanent.
const WEEK_REFRESH_MS = 60000;

function normalize(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

// Page "Matchs à venir" (PROMPT 2 du plan) : deuxième et dernier bouton de
// navigation du site. Vraies données API (/api/matches, mêmes compétitions que
// PROMPT 1), jamais de match inventé.
export default function UpcomingMatches() {
  const { session, sessionChecked, authorized } = useRequireAuth();

  const [search, setSearch] = useState("");
  const [weekData, setWeekData] = useState(null);
  const [weekLoading, setWeekLoading] = useState(true);

  // silent=true (rafraîchissement automatique) : une erreur passagère ne doit jamais
  // effacer des matchs déjà affichés — on réessaie simplement au prochain cycle.
  const loadWeekMatches = useCallback((silent = false) => {
    if (!silent) setWeekLoading(true);
    return fetch("/api/matches")
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) {
          console.error("Erreur /api/matches:", d.error);
          if (silent) return;
        }
        setWeekData(d);
      })
      .catch((e) => {
        console.error("Erreur /api/matches:", e);
        if (!silent) setWeekData({ error: true, competitions: [] });
      })
      .finally(() => setWeekLoading(false));
  }, []);

  useEffect(() => {
    if (!authorized) return;
    loadWeekMatches();
  }, [authorized, loadWeekMatches]);

  useEffect(() => {
    if (!authorized) return;
    const id = setInterval(() => loadWeekMatches(true), WEEK_REFRESH_MS);
    return () => clearInterval(id);
  }, [authorized, loadWeekMatches]);

  const searchQuery = search.trim();

  const weekFeed = useMemo(() => {
    if (!weekData?.competitions) return [];
    const rows = [];
    const now = Date.now();
    weekData.competitions.forEach((comp) => {
      const validMatches = (comp.matches || []).filter((m) => m?.homeTeam && m?.awayTeam && m?.utcDate);
      let matches;
      if (searchQuery) {
        const q = normalize(searchQuery);
        matches = validMatches.filter(
          (m) =>
            normalize(m.homeTeam.name).includes(q) ||
            normalize(m.awayTeam.name).includes(q) ||
            normalize(comp.name).includes(q)
        );
      } else {
        matches = validMatches.filter(
          (m) => UPCOMING_STATUSES.includes(m.status) && new Date(m.utcDate).getTime() > now
        );
      }
      matches.forEach((m) => rows.push({ m, comp }));
    });
    rows.sort((a, b) => new Date(a.m.utcDate) - new Date(b.m.utcDate));
    return rows;
  }, [weekData, searchQuery]);

  if (!sessionChecked) {
    return (
      <div style={st.page}>
        <p style={st.hint}>Chargement…</p>
      </div>
    );
  }
  if (!authorized) return null;

  return (
    <div style={st.page}>
      <SiteHeader session={session} />

      <main style={st.main}>
        <section style={st.hero}>
          <h1 style={st.heroTitle}>Matchs à venir</h1>
          <p style={st.heroSubtitle}>
            Les prochains matchs programmés sur les compétitions suivies par Blume — Coupe du
            Monde, Ligue des Champions, Premier League, LaLiga, Serie A, Bundesliga, Ligue 1 et
            plus.
          </p>
        </section>

        <div style={st.searchRow}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une équipe, une compétition…"
            style={st.searchInput}
          />
          {search && (
            <button style={st.searchBtn} onClick={() => setSearch("")}>✕</button>
          )}
        </div>

        {weekLoading && <p style={st.hint}>Chargement des matchs…</p>}
        {!weekLoading && (!weekData || weekData?.error) && (
          <p style={st.hint}>Les matchs ne sont pas disponibles pour le moment. Réessaie dans quelques minutes.</p>
        )}
        {!weekLoading && weekData && !weekData.error && weekFeed.length === 0 && (
          <p style={st.hint}>
            {searchQuery ? "Aucun match ne correspond à ta recherche." : "Aucun match à venir cette semaine."}
          </p>
        )}

        <div data-testid="match-list">
          {weekFeed.map(({ m, comp }) => (
            <MatchCard key={m.id} m={m} comp={comp} />
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
  heroSubtitle: { fontSize: 12, color: "#7EA694", margin: 0, lineHeight: 1.5 },
  hint: { fontSize: 12.5, color: "#7EA694" },
  searchRow: { display: "flex", gap: 8 },
  searchInput: {
    flex: 1, background: "#12291E", border: "1px solid #1E3D2C", color: "#E9F1EC",
    borderRadius: 999, padding: "10px 16px", fontSize: 13,
  },
  searchBtn: {
    background: "#39B577", border: "none", color: "#06121F", fontWeight: 700,
    borderRadius: 999, padding: "0 18px", fontSize: 13, cursor: "pointer",
  },
};
