import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

const LIVE_STATUSES = ["IN_PLAY", "PAUSED", "LIVE"];
const UPCOMING_STATUSES = ["SCHEDULED", "TIMED"];
const LIVE_REFRESH_MS = 30000;

function statusLabel(status) {
  if (LIVE_STATUSES.includes(status)) return "EN DIRECT";
  if (status === "FINISHED") return "Terminé";
  return null;
}

function formatKickoff(iso) {
  return new Date(iso).toLocaleString("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Home() {
  const [session, setSession] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("live"); // "live" | "upcoming"
  const [analyses, setAnalyses] = useState({});
  const [analyzing, setAnalyzing] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionChecked(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadMatches = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    return fetch("/api/matches")
      .then((r) => r.json())
      .then((d) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  // Rafraîchissement automatique des matchs en direct.
  useEffect(() => {
    if (tab !== "live") return;
    const id = setInterval(() => loadMatches(true), LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [tab, loadMatches]);

  const analyze = async (match, compCode) => {
    const key = match.id;
    setAnalyzing(key);
    try {
      const params = new URLSearchParams({
        competitionCode: compCode,
        homeTeamId: match.homeTeam.id,
        awayTeamId: match.awayTeam.id,
        homeTeamName: match.homeTeam.name,
        awayTeamName: match.awayTeam.name,
      });
      const res = await fetch(`/api/analyze?${params}`);
      const result = await res.json();
      setAnalyses((prev) => ({ ...prev, [key]: result }));
    } catch (e) {
      setAnalyses((prev) => ({ ...prev, [key]: { available: false, message: "Erreur d'analyse" } }));
    } finally {
      setAnalyzing(null);
    }
  };

  const logout = async () => supabase.auth.signOut();

  // Répartit chaque compétition en deux listes : en direct / terminés vs à venir.
  const competitions = useMemo(() => {
    if (!data?.competitions) return [];
    return data.competitions
      .map((comp) => {
        const matches =
          tab === "live"
            ? comp.matches.filter((m) => LIVE_STATUSES.includes(m.status) || m.status === "FINISHED")
            : comp.matches.filter((m) => UPCOMING_STATUSES.includes(m.status));
        const sorted = [...matches].sort((a, b) => {
          if (tab === "live") {
            const aLive = LIVE_STATUSES.includes(a.status) ? 0 : 1;
            const bLive = LIVE_STATUSES.includes(b.status) ? 0 : 1;
            if (aLive !== bLive) return aLive - bLive;
            return new Date(b.utcDate) - new Date(a.utcDate);
          }
          return new Date(a.utcDate) - new Date(b.utcDate);
        });
        return { ...comp, matches: sorted };
      })
      .filter((comp) => comp.matches.length > 0);
  }, [data, tab]);

  const liveCount = useMemo(() => {
    if (!data?.competitions) return 0;
    return data.competitions.reduce(
      (n, comp) => n + comp.matches.filter((m) => LIVE_STATUSES.includes(m.status)).length,
      0
    );
  }, [data]);

  return (
    <div style={st.page}>
      <header style={st.header}>
        <h1 style={st.h1}>Matchs</h1>
        <div style={st.headerRight}>
          <a href="/calculateur" style={st.smallBtn}>Calculateur</a>
          {sessionChecked &&
            (session ? (
              <button onClick={logout} style={st.smallBtn}>Déconnexion</button>
            ) : (
              <a href="/login" style={st.smallBtn}>Se connecter</a>
            ))}
        </div>
      </header>

      <main style={st.main}>
        <div style={st.tabs}>
          <button
            style={{ ...st.tabBtn, ...(tab === "live" ? st.tabBtnActive : {}) }}
            onClick={() => setTab("live")}
          >
            Matchs en direct{liveCount > 0 ? ` (${liveCount})` : ""}
          </button>
          <button
            style={{ ...st.tabBtn, ...(tab === "upcoming" ? st.tabBtnActive : {}) }}
            onClick={() => setTab("upcoming")}
          >
            Matchs à venir
          </button>
        </div>

        {loading && <p style={st.hint}>Chargement des matchs…</p>}
        {!loading && !data && <p style={st.hint}>Impossible de charger les matchs pour le moment.</p>}
        {!loading && data && competitions.length === 0 && (
          <p style={st.hint}>
            {tab === "live" ? "Aucun match en direct ou terminé pour le moment." : "Aucun match à venir pour le moment."}
          </p>
        )}

        {competitions.map((comp) => (
          <section key={comp.code} style={st.panel}>
            <h2 style={st.h2}>{comp.name}</h2>
            {comp.matches.map((m) => {
              const key = m.id;
              const analysis = analyses[key];
              const live = statusLabel(m.status);
              return (
                <div key={key} style={st.matchCard}>
                  <div style={st.matchRow}>
                    <div style={st.teamBlock}>
                      {m.homeTeam.crest && (
                        <img src={m.homeTeam.crest} alt="" style={st.crest} onError={(e) => (e.target.style.display = "none")} />
                      )}
                      <span style={st.teamName}>{m.homeTeam.name}</span>
                    </div>
                    <span style={st.score}>
                      {m.score.fullTime.home ?? "–"} : {m.score.fullTime.away ?? "–"}
                    </span>
                    <div style={{ ...st.teamBlock, ...st.teamBlockAway }}>
                      <span style={st.teamName}>{m.awayTeam.name}</span>
                      {m.awayTeam.crest && (
                        <img src={m.awayTeam.crest} alt="" style={st.crest} onError={(e) => (e.target.style.display = "none")} />
                      )}
                    </div>
                  </div>
                  <div style={st.metaRow}>
                    <span style={{ ...st.badge, ...(live === "EN DIRECT" ? st.badgeLive : {}) }}>
                      {live || formatKickoff(m.utcDate)}
                    </span>
                    <button
                      style={st.analyzeBtn}
                      onClick={() => analyze(m, comp.code)}
                      disabled={analyzing === key}
                    >
                      {analyzing === key ? "…" : "Analyser"}
                    </button>
                  </div>
                  {analysis && (
                    <div style={st.analysisBox}>
                      {analysis.available === false ? (
                        <p style={st.hint}>{analysis.message}</p>
                      ) : (
                        <>
                          <p style={st.sectionLabel}>Résultat</p>
                          <div style={st.probRow}>
                            <div style={st.probCell}>
                              <span style={st.probLabel}>Domicile</span>
                              <span style={st.probValue}>{analysis.probabilities.home}%</span>
                            </div>
                            <div style={st.probCell}>
                              <span style={st.probLabel}>Nul</span>
                              <span style={st.probValue}>{analysis.probabilities.draw}%</span>
                            </div>
                            <div style={st.probCell}>
                              <span style={st.probLabel}>Extérieur</span>
                              <span style={st.probValue}>{analysis.probabilities.away}%</span>
                            </div>
                          </div>

                          <p style={st.sectionLabel}>Buts</p>
                          <div style={st.probRow}>
                            <div style={st.probCell}>
                              <span style={st.probLabel}>+2.5 buts</span>
                              <span style={st.probValue}>{analysis.goals.over25}%</span>
                            </div>
                            <div style={st.probCell}>
                              <span style={st.probLabel}>-2.5 buts</span>
                              <span style={st.probValue}>{analysis.goals.under25}%</span>
                            </div>
                            <div style={st.probCell}>
                              <span style={st.probLabel}>Les 2 marquent</span>
                              <span style={st.probValue}>{analysis.goals.bttsYes}%</span>
                            </div>
                          </div>

                          <p style={st.sectionLabel}>Scores exacts les plus probables</p>
                          <div style={st.probRow}>
                            {analysis.correctScores.map((cs) => (
                              <div key={cs.score} style={st.probCell}>
                                <span style={st.probLabel}>{cs.score}</span>
                                <span style={st.probValue}>{cs.probability}%</span>
                              </div>
                            ))}
                          </div>

                          <p style={st.hint}>
                            {analysis.home.name} : {analysis.home.position}ᵉ ({analysis.home.points} pts) ·{" "}
                            {analysis.away.name} : {analysis.away.position}ᵉ ({analysis.away.points} pts)
                          </p>
                          <p style={st.noteText}>{analysis.note}</p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </main>
    </div>
  );
}

const st = {
  page: { minHeight: "100vh", padding: "20px 16px 60px" },
  header: { maxWidth: 640, margin: "0 auto 20px", display: "flex", justifyContent: "space-between", alignItems: "center" },
  h1: { fontSize: 20, fontWeight: 800, margin: 0 },
  headerRight: { display: "flex", alignItems: "center", gap: 10 },
  smallBtn: {
    background: "transparent", border: "1px solid #1E3D2C", color: "#E9F1EC",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, textDecoration: "none", cursor: "pointer",
  },
  main: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  tabs: { display: "flex", gap: 8 },
  tabBtn: {
    flex: 1, background: "#12291E", border: "1px solid #1E3D2C", color: "#7EA694",
    borderRadius: 999, padding: "10px 8px", fontSize: 13, fontWeight: 700, cursor: "pointer",
  },
  tabBtnActive: { background: "#39B577", borderColor: "#39B577", color: "#06121F" },
  panel: { background: "#12291E", border: "1px solid #1E3D2C", borderRadius: 14, padding: 16 },
  h2: { fontSize: 15, margin: "0 0 10px" },
  hint: { fontSize: 12.5, color: "#7EA694" },
  matchCard: { borderTop: "1px solid #1E3D2C", padding: "12px 0" },
  matchRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13.5 },
  teamBlock: { flex: 1, display: "flex", alignItems: "center", gap: 6, minWidth: 0 },
  teamBlockAway: { justifyContent: "flex-end" },
  crest: { width: 18, height: 18, objectFit: "contain", flexShrink: 0 },
  teamName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  score: { fontWeight: 700, color: "#39B577", flexShrink: 0, padding: "0 8px" },
  metaRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  badge: { fontSize: 11, color: "#7EA694" },
  badgeLive: { color: "#D8685E", fontWeight: 700 },
  analyzeBtn: {
    background: "transparent", border: "1px solid #39B57766", color: "#39B577",
    borderRadius: 999, padding: "5px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
  },
  analysisBox: { marginTop: 10, background: "#0B1F16", border: "1px solid #1E3D2C", borderRadius: 10, padding: 12 },
  sectionLabel: { fontSize: 10, color: "#5C8A73", textTransform: "uppercase", margin: "10px 0 6px", letterSpacing: 0.4 },
  probRow: { display: "flex", gap: 8, marginBottom: 4 },
  probCell: { flex: 1, textAlign: "center", background: "#12291E", borderRadius: 8, padding: "8px 4px" },
  probLabel: { display: "block", fontSize: 9.5, color: "#7EA694", textTransform: "uppercase" },
  probValue: { fontSize: 15, fontWeight: 700 },
  noteText: { fontSize: 10.5, color: "#5C8A73", fontStyle: "italic", margin: "4px 0 0" },
};
