import { useState, useEffect } from "react";

export default function Matches() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyses, setAnalyses] = useState({});
  const [analyzing, setAnalyzing] = useState(null);

  useEffect(() => {
    fetch("/api/matches")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

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

  const statusLabel = (s) => {
    if (s === "IN_PLAY" || s === "PAUSED" || s === "LIVE") return "EN DIRECT";
    if (s === "FINISHED") return "Terminé";
    return null;
  };

  return (
    <div style={st.page}>
      <header style={st.header}>
        <h1 style={st.h1}>Matchs</h1>
        <a href="/" style={st.smallBtn}>← Calculateur</a>
      </header>

      <main style={st.main}>
        {loading && <p style={st.hint}>Chargement des matchs…</p>}
        {!loading && !data && <p style={st.hint}>Impossible de charger les matchs pour le moment.</p>}

        {data?.competitions?.map((comp) => (
          <section key={comp.code} style={st.panel}>
            <h2 style={st.h2}>{comp.name}</h2>
            {comp.matches.length === 0 && <p style={st.hint}>Aucun match trouvé.</p>}
            {comp.matches.map((m) => {
              const key = m.id;
              const analysis = analyses[key];
              const live = statusLabel(m.status);
              return (
                <div key={key} style={st.matchCard}>
                  <div style={st.matchRow}>
                    <span style={st.teamName}>{m.homeTeam.name}</span>
                    <span style={st.score}>
                      {m.score.fullTime.home ?? "–"} : {m.score.fullTime.away ?? "–"}
                    </span>
                    <span style={st.teamName}>{m.awayTeam.name}</span>
                  </div>
                  <div style={st.metaRow}>
                    <span style={{ ...st.badge, ...(live ? st.badgeLive : {}) }}>
                      {live || new Date(m.utcDate).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
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
  smallBtn: {
    background: "transparent", border: "1px solid #1E3D2C", color: "#E9F1EC",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, textDecoration: "none",
  },
  main: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  panel: { background: "#12291E", border: "1px solid #1E3D2C", borderRadius: 14, padding: 16 },
  h2: { fontSize: 15, margin: "0 0 10px" },
  hint: { fontSize: 12.5, color: "#7EA694" },
  matchCard: { borderTop: "1px solid #1E3D2C", padding: "12px 0" },
  matchRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 13.5 },
  teamName: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  score: { fontWeight: 700, color: "#39B577", flexShrink: 0, padding: "0 8px" },
  metaRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  badge: { fontSize: 11, color: "#7EA694" },
  badgeLive: { color: "#D8685E", fontWeight: 700 },
  analyzeBtn: {
    background: "transparent", border: "1px solid #39B57766", color: "#39B577",
    borderRadius: 999, padding: "5px 12px", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
  },
  analysisBox: { marginTop: 10, background: "#0B1F16", border: "1px solid #1E3D2C", borderRadius: 10, padding: 12 },
  probRow: { display: "flex", gap: 8, marginBottom: 8 },
  probCell: { flex: 1, textAlign: "center", background: "#12291E", borderRadius: 8, padding: "8px 4px" },
  probLabel: { display: "block", fontSize: 9.5, color: "#7EA694", textTransform: "uppercase" },
  probValue: { fontSize: 15, fontWeight: 700 },
  noteText: { fontSize: 10.5, color: "#5C8A73", fontStyle: "italic", margin: "4px 0 0" },
};
