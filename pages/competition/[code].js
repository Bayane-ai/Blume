import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useRequireAuth } from "../../lib/useRequireAuth";
import { COMPETITIONS } from "../../lib/competitions";
import MatchCard from "../../components/MatchCard";

const LIVE_STATUSES = ["IN_PLAY", "PAUSED", "LIVE"];
const REFRESH_MS = 60000;

export default function CompetitionPage() {
  const { sessionChecked, authorized } = useRequireAuth();
  const router = useRouter();
  const { code } = router.query;
  const comp = COMPETITIONS.find((c) => c.code === code);

  const [tab, setTab] = useState("calendrier"); // "calendrier" | "resultats" | "classement"

  const [upcoming, setUpcoming] = useState(null);
  const [upcomingLoading, setUpcomingLoading] = useState(true);
  const [results, setResults] = useState(null);
  const [resultsLoading, setResultsLoading] = useState(true);
  const [standings, setStandings] = useState(null);
  const [standingsLoading, setStandingsLoading] = useState(true);

  const loadUpcoming = useCallback((silent = false) => {
    if (!code) return Promise.resolve();
    if (!silent) setUpcomingLoading(true);
    return fetch(`/api/competition-matches?code=${code}&view=upcoming`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) {
          if (silent) return;
        }
        setUpcoming(d);
      })
      .catch(() => {
        if (!silent) setUpcoming({ error: true, matches: [] });
      })
      .finally(() => setUpcomingLoading(false));
  }, [code]);

  const loadResults = useCallback((silent = false) => {
    if (!code) return Promise.resolve();
    if (!silent) setResultsLoading(true);
    return fetch(`/api/competition-matches?code=${code}&view=results`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) {
          if (silent) return;
        }
        setResults(d);
      })
      .catch(() => {
        if (!silent) setResults({ error: true, matches: [] });
      })
      .finally(() => setResultsLoading(false));
  }, [code]);

  const loadStandings = useCallback((silent = false) => {
    if (!code) return Promise.resolve();
    if (!silent) setStandingsLoading(true);
    return fetch(`/api/competition-standings?code=${code}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) {
          if (silent) return;
        }
        setStandings(d);
      })
      .catch(() => {
        if (!silent) setStandings({ error: true, table: [] });
      })
      .finally(() => setStandingsLoading(false));
  }, [code]);

  useEffect(() => {
    if (!authorized || !code) return;
    loadUpcoming();
    loadResults();
    loadStandings();
  }, [authorized, code, loadUpcoming, loadResults, loadStandings]);

  useEffect(() => {
    if (!authorized || !code) return;
    const id = setInterval(() => {
      loadUpcoming(true);
      loadResults(true);
      loadStandings(true);
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [authorized, code, loadUpcoming, loadResults, loadStandings]);

  const liveCount = (upcoming?.matches || []).filter((m) => LIVE_STATUSES.includes(m.status)).length;

  if (!sessionChecked) {
    return (
      <div style={st.page}>
        <p style={st.hint}>Chargement…</p>
      </div>
    );
  }
  if (!authorized) return null;

  if (!comp) {
    return (
      <div style={st.page}>
        <header style={st.header}>
          <a href="/" style={st.smallBtn}>← Matchs</a>
        </header>
        <main style={st.main}>
          <p style={st.hint}>Compétition inconnue.</p>
        </main>
      </div>
    );
  }

  return (
    <div style={st.page}>
      <header style={st.header}>
        <a href="/" style={st.smallBtn}>← Matchs</a>
      </header>

      <main style={st.main}>
        <section style={st.panel}>
          <p style={st.compArea}>{comp.area}</p>
          <h1 style={st.compName}>{comp.name}</h1>
        </section>

        <div style={st.tabs}>
          <button
            type="button"
            style={{ ...st.tabBtn, ...(tab === "calendrier" ? st.tabBtnActive : {}) }}
            onClick={() => setTab("calendrier")}
          >
            Calendrier
          </button>
          <button
            type="button"
            style={{ ...st.tabBtn, ...(tab === "resultats" ? st.tabBtnActive : {}) }}
            onClick={() => setTab("resultats")}
          >
            Résultats
          </button>
          <button
            type="button"
            style={{ ...st.tabBtn, ...(tab === "classement" ? st.tabBtnActive : {}) }}
            onClick={() => setTab("classement")}
          >
            Classement
          </button>
        </div>

        {tab === "calendrier" && (
          <>
            <div style={st.sectionHeaderRow}>
              <h2 style={st.h2}>Calendrier — prochains matchs</h2>
              {liveCount > 0 && <span style={st.liveBadge}>LIVE — {liveCount} match{liveCount > 1 ? "s" : ""} analysé{liveCount > 1 ? "s" : ""}</span>}
            </div>
            {upcomingLoading && <p style={st.hint}>Chargement…</p>}
            {!upcomingLoading && (!upcoming || upcoming.error) && (
              <p style={st.hint}>Le calendrier n'est pas disponible pour le moment.</p>
            )}
            {!upcomingLoading && upcoming && !upcoming.error && (upcoming.matches || []).length === 0 && (
              <p style={st.hint}>Aucun match à venir trouvé pour cette compétition.</p>
            )}
            {!upcomingLoading &&
              (upcoming?.matches || []).map((m) => <MatchCard key={m.id} m={m} comp={comp} />)}
          </>
        )}

        {tab === "resultats" && (
          <>
            <h2 style={st.h2}>Résultats récents</h2>
            {resultsLoading && <p style={st.hint}>Chargement…</p>}
            {!resultsLoading && (!results || results.error) && (
              <p style={st.hint}>Les résultats ne sont pas disponibles pour le moment.</p>
            )}
            {!resultsLoading && results && !results.error && (results.matches || []).length === 0 && (
              <p style={st.hint}>Aucun résultat récent pour cette compétition.</p>
            )}
            {!resultsLoading &&
              (results?.matches || []).map((m) => <MatchCard key={m.id} m={m} comp={comp} />)}
          </>
        )}

        {tab === "classement" && (
          <>
            <h2 style={st.h2}>Classement</h2>
            {standingsLoading && <p style={st.hint}>Chargement…</p>}
            {!standingsLoading && (!standings || standings.error) && (
              <p style={st.hint}>Le classement n'est pas disponible pour le moment.</p>
            )}
            {!standingsLoading && standings && !standings.error && (standings.table || []).length === 0 && (
              <p style={st.hint}>Classement indisponible pour cette compétition (ex : phase à élimination directe).</p>
            )}
            {!standingsLoading && standings?.table?.length > 0 && (
              <div style={st.tableWrap}>
                <table style={st.table}>
                  <thead>
                    <tr>
                      <th style={st.th}>#</th>
                      <th style={{ ...st.th, textAlign: "left" }}>Équipe</th>
                      <th style={st.th}>J</th>
                      <th style={st.th}>V</th>
                      <th style={st.th}>N</th>
                      <th style={st.th}>D</th>
                      <th style={st.th}>+/-</th>
                      <th style={st.th}>Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.table.map((row) => (
                      <tr key={row.team?.id}>
                        <td style={st.td}>{row.position ?? "–"}</td>
                        <td style={{ ...st.td, textAlign: "left" }}>
                          <span style={st.teamCell}>
                            {row.team?.crest && <img src={row.team.crest} alt="" style={st.crest} onError={(e) => (e.target.style.display = "none")} />}
                            {row.team?.name}
                          </span>
                        </td>
                        <td style={st.td}>{row.playedGames ?? "–"}</td>
                        <td style={st.td}>{row.won ?? "–"}</td>
                        <td style={st.td}>{row.draw ?? "–"}</td>
                        <td style={st.td}>{row.lost ?? "–"}</td>
                        <td style={st.td}>
                          {row.goalsFor != null && row.goalsAgainst != null ? row.goalsFor - row.goalsAgainst : "–"}
                        </td>
                        <td style={{ ...st.td, fontWeight: 800, color: "var(--accent)" }}>{row.points ?? "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

const st = {
  page: { minHeight: "100vh", padding: "20px 16px 60px" },
  header: { maxWidth: 640, margin: "0 auto 20px" },
  smallBtn: {
    background: "transparent", border: "1px solid var(--border)", color: "var(--text-primary)",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, textDecoration: "none",
  },
  main: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  panel: { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 },
  compArea: { fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4, margin: "0 0 4px" },
  compName: { fontSize: 20, fontWeight: 800, margin: 0 },
  tabs: { display: "flex", gap: 8 },
  tabBtn: {
    flex: 1, background: "var(--card-bg)", border: "1px solid var(--border)", color: "var(--text-secondary)",
    borderRadius: 999, padding: "10px 8px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
  },
  tabBtnActive: { background: "var(--accent)", border: "1px solid var(--accent)", color: "var(--on-accent)" },
  sectionHeaderRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  h2: { fontSize: 14, margin: 0, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.4 },
  liveBadge: { fontSize: 11, color: "var(--negative)", fontWeight: 800 },
  hint: { fontSize: 12.5, color: "var(--text-secondary)" },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12.5 },
  th: { textAlign: "center", color: "var(--text-secondary)", fontSize: 10.5, textTransform: "uppercase", padding: "6px 4px", borderBottom: "1px solid var(--border)" },
  td: { textAlign: "center", padding: "8px 4px", borderBottom: "1px solid var(--border)", color: "var(--text-primary)" },
  teamCell: { display: "flex", alignItems: "center", gap: 8 },
  crest: { width: 18, height: 18, objectFit: "contain", flexShrink: 0 },
};
