import { useEffect, useState } from "react";
import { useRouter } from "next/router";

const LIVE_STATUSES = ["IN_PLAY", "PAUSED", "LIVE"];

function statusLabel(status) {
  if (LIVE_STATUSES.includes(status)) return "EN DIRECT";
  if (status === "FINISHED") return "Terminé";
  return null;
}

function formatKickoff(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MatchPage() {
  const router = useRouter();
  const {
    competitionCode, competitionName, homeTeamId, awayTeamId,
    homeTeamName, awayTeamName, homeCrest, awayCrest,
    status, utcDate, scoreHome, scoreAway,
  } = router.query;

  const [pronostic, setPronostic] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!router.isReady) return;
    if (!competitionCode || !homeTeamId || !awayTeamId) {
      setLoading(false);
      return;
    }
    const params = new URLSearchParams({
      competitionCode, homeTeamId, awayTeamId, homeTeamName, awayTeamName,
    });
    setLoading(true);
    fetch(`/api/analyze?${params}`)
      .then((r) => r.json())
      .then((result) => setPronostic(result))
      .catch(() => setPronostic({ available: false, message: "Erreur lors du calcul des pronostics." }))
      .finally(() => setLoading(false));
  }, [router.isReady, competitionCode, homeTeamId, awayTeamId, homeTeamName, awayTeamName]);

  const live = statusLabel(status);

  return (
    <div style={st.page}>
      <header style={st.header}>
        <a href="/" style={st.smallBtn}>← Matchs</a>
      </header>

      <main style={st.main}>
        <section style={st.panel}>
          <p style={st.compName}>{competitionName}</p>
          <div style={st.matchRow}>
            <div style={st.teamBlock}>
              {homeCrest ? <img src={homeCrest} alt="" style={st.crest} onError={(e) => (e.target.style.display = "none")} /> : null}
              <span style={st.teamName}>{homeTeamName}</span>
            </div>
            <span style={st.score}>
              {scoreHome !== "" && scoreHome !== undefined ? scoreHome : "–"} : {scoreAway !== "" && scoreAway !== undefined ? scoreAway : "–"}
            </span>
            <div style={{ ...st.teamBlock, ...st.teamBlockAway }}>
              <span style={st.teamName}>{awayTeamName}</span>
              {awayCrest ? <img src={awayCrest} alt="" style={st.crest} onError={(e) => (e.target.style.display = "none")} /> : null}
            </div>
          </div>
          <p style={{ ...st.badge, ...(live === "EN DIRECT" ? st.badgeLive : {}) }}>
            {live || formatKickoff(utcDate)}
          </p>
        </section>

        <section style={st.panel}>
          <h2 style={st.h2}>Pronostics automatiques</h2>

          {loading && <p style={st.hint}>Calcul des pronostics…</p>}

          {!loading && pronostic?.available === false && (
            <p style={st.hint}>{pronostic.message}</p>
          )}

          {!loading && pronostic?.available && (
            <>
              <p style={st.sectionLabel}>% de victoire</p>
              <div style={st.probRow}>
                <div style={st.probCell}>
                  <span style={st.probLabel}>Domicile</span>
                  <span style={st.probValue}>{pronostic.probabilities.home}%</span>
                </div>
                <div style={st.probCell}>
                  <span style={st.probLabel}>Nul</span>
                  <span style={st.probValue}>{pronostic.probabilities.draw}%</span>
                </div>
                <div style={st.probCell}>
                  <span style={st.probLabel}>Extérieur</span>
                  <span style={st.probValue}>{pronostic.probabilities.away}%</span>
                </div>
              </div>

              <p style={st.sectionLabel}>Buts probables</p>
              <div style={st.probRow}>
                <div style={st.probCell}>
                  <span style={st.probLabel}>Attendus</span>
                  <span style={st.probValue}>{pronostic.goals.expectedHome} - {pronostic.goals.expectedAway}</span>
                </div>
                <div style={st.probCell}>
                  <span style={st.probLabel}>+2.5 buts</span>
                  <span style={st.probValue}>{pronostic.goals.over25}%</span>
                </div>
                <div style={st.probCell}>
                  <span style={st.probLabel}>Les 2 marquent</span>
                  <span style={st.probValue}>{pronostic.goals.bttsYes}%</span>
                </div>
              </div>

              <p style={st.sectionLabel}>Scores exacts les plus probables</p>
              <div style={st.probRow}>
                {pronostic.correctScores.map((cs) => (
                  <div key={cs.score} style={st.probCell}>
                    <span style={st.probLabel}>{cs.score}</span>
                    <span style={st.probValue}>{cs.probability}%</span>
                  </div>
                ))}
              </div>

              <p style={st.hint}>
                {pronostic.home.name} : {pronostic.home.position}ᵉ ({pronostic.home.points} pts) ·{" "}
                {pronostic.away.name} : {pronostic.away.position}ᵉ ({pronostic.away.points} pts)
              </p>
              <p style={st.noteText}>{pronostic.note}</p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

const st = {
  page: { minHeight: "100vh", padding: "20px 16px 60px" },
  header: { maxWidth: 640, margin: "0 auto 20px" },
  smallBtn: {
    background: "transparent", border: "1px solid #1E3D2C", color: "#E9F1EC",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, textDecoration: "none",
  },
  main: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  panel: { background: "#12291E", border: "1px solid #1E3D2C", borderRadius: 14, padding: 18 },
  compName: { fontSize: 11, color: "#7EA694", textTransform: "uppercase", margin: "0 0 10px" },
  matchRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 15 },
  teamBlock: { flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  teamBlockAway: { justifyContent: "flex-end" },
  crest: { width: 26, height: 26, objectFit: "contain", flexShrink: 0 },
  teamName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 },
  score: { fontWeight: 800, fontSize: 20, color: "#39B577", flexShrink: 0, padding: "0 10px" },
  badge: { fontSize: 12, color: "#7EA694", margin: "12px 0 0" },
  badgeLive: { color: "#D8685E", fontWeight: 700 },
  h2: { fontSize: 15, margin: "0 0 4px" },
  hint: { fontSize: 12.5, color: "#7EA694" },
  sectionLabel: { fontSize: 10, color: "#5C8A73", textTransform: "uppercase", margin: "14px 0 6px", letterSpacing: 0.4 },
  probRow: { display: "flex", gap: 8, marginBottom: 4 },
  probCell: { flex: 1, textAlign: "center", background: "#0B1F16", borderRadius: 8, padding: "10px 4px" },
  probLabel: { display: "block", fontSize: 9.5, color: "#7EA694", textTransform: "uppercase" },
  probValue: { fontSize: 15, fontWeight: 700 },
  noteText: { fontSize: 10.5, color: "#5C8A73", fontStyle: "italic", margin: "8px 0 0" },
};
