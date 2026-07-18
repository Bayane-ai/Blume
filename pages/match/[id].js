import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import MatchInfoBlock from "../../components/MatchInfoBlock";

const LIVE_STATUSES = ["IN_PLAY", "PAUSED"];
// 2s : rendu possible sans dépasser le quota de l'API grâce au cache partagé côté
// serveur (lib/liveMatchCache.js, actualisé toutes les 2,5s), qui mutualise les appels
// entre tous les visiteurs suivant ce match. Dès qu'un but est marqué, la requête
// suivante (au plus 2s après) le reflète.
const LIVE_REFRESH_MS = 2000;

export default function MatchPage() {
  const router = useRouter();
  const {
    id: matchId,
    competitionCode, competitionName, competitionEmblem, homeTeamId, awayTeamId,
    homeTeamName, awayTeamName, homeCrest, awayCrest,
    status: initialStatus, minute: initialMinute, utcDate, scoreHome, scoreAway,
  } = router.query;

  const [pronostic, setPronostic] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hasRequested, setHasRequested] = useState(false);
  // État réel du match (score/minute/statut) tel que renvoyé par l'API à la dernière
  // requête — prioritaire sur les query params, qui ne sont qu'un instantané pris au
  // moment du clic depuis la liste et peuvent être périmés.
  const [liveState, setLiveState] = useState(null);

  const runAnalysis = useCallback((silent = false) => {
    if (!router.isReady) return;
    setHasRequested(true);
    if (!competitionCode || !homeTeamId || !awayTeamId) {
      setPronostic({ error: "Informations du match manquantes pour calculer les pronostics." });
      return;
    }
    const params = new URLSearchParams({
      matchId: matchId || "", competitionCode, homeTeamId, awayTeamId, homeTeamName, awayTeamName,
    });
    if (!silent) setLoading(true);
    fetch(`/api/analyze?${params}`)
      .then((r) => r.json())
      .then((result) => {
        if (result?.error) console.error("Erreur /api/analyze:", result.error);
        setPronostic(result);
        if (result?.matchStatus) {
          setLiveState({ status: result.matchStatus, minute: result.matchMinute, score: result.matchScore });
        }
      })
      .catch((e) => {
        console.error("Erreur /api/analyze:", e);
        setPronostic({ error: "Erreur lors du calcul des pronostics." });
      })
      .finally(() => setLoading(false));
  }, [router.isReady, matchId, competitionCode, homeTeamId, awayTeamId, homeTeamName, awayTeamName]);

  // Lance l'analyse automatiquement dès que le match est chargé, et à chaque fois qu'on
  // navigue vers un AUTRE match (Next.js réutilise ce même composant, seul l'id d'URL
  // change : sans matchId en dépendance, l'ancienne analyse restait affichée).
  useEffect(() => {
    if (!router.isReady) return;
    setPronostic(null);
    setHasRequested(false);
    setLiveState(null);
    runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, matchId]);

  const currentStatus = liveState?.status || initialStatus;

  // Rafraîchissement automatique (score + probabilités) tant que le match est en direct.
  useEffect(() => {
    if (!LIVE_STATUSES.includes(currentStatus)) return;
    const intervalId = setInterval(() => runAnalysis(true), LIVE_REFRESH_MS);
    return () => clearInterval(intervalId);
  }, [currentStatus, runAnalysis]);

  const isLiveNow = LIVE_STATUSES.includes(currentStatus);

  const matchForBlock = {
    id: matchId || "current",
    status: currentStatus || "",
    minute: liveState?.minute ?? (initialMinute ? Number(initialMinute) : null),
    utcDate: utcDate || "",
    competition: { code: competitionCode || "", name: competitionName || "", emblem: competitionEmblem || "" },
    homeTeam: { name: homeTeamName || "", crest: homeCrest || "" },
    awayTeam: { name: awayTeamName || "", crest: awayCrest || "" },
    score: {
      fullTime: liveState?.score || {
        home: scoreHome !== "" && scoreHome !== undefined ? scoreHome : null,
        away: scoreAway !== "" && scoreAway !== undefined ? scoreAway : null,
      },
    },
  };

  return (
    <div style={st.page}>
      <header style={st.header}>
        <a href="/" style={st.smallBtn}>← Matchs</a>
      </header>

      <main style={st.main}>
        <section style={st.panel}>
          <MatchInfoBlock m={matchForBlock} />

          <div style={st.divider} />

          <h2 style={st.h2}>{pronostic?.live ? "Pronostics en direct" : "Pronostics automatiques"}</h2>
          {isLiveNow && (
            <p style={st.liveHint}>Score et probabilités recalculés automatiquement en continu, dès qu'un but est marqué.</p>
          )}

          <button style={st.analyzeBtn} onClick={() => runAnalysis(false)} disabled={loading}>
            {loading ? "Analyse en cours…" : hasRequested ? "Actualiser les pronostics" : "Analyser ce match"}
          </button>

          {!loading && pronostic?.error && (
            <p style={{ ...st.hint, marginTop: 14 }}>{pronostic.error}</p>
          )}

          {!loading && !pronostic?.error && pronostic?.available === false && (
            <p style={{ ...st.hint, marginTop: 14 }}>{pronostic.message || "Pronostics indisponibles pour ce match."}</p>
          )}

          {!loading && hasRequested && !pronostic?.error && pronostic?.available !== false &&
            !(pronostic?.available && pronostic?.probabilities && pronostic?.goals) && (
              <p style={{ ...st.hint, marginTop: 14 }}>Pronostics indisponibles pour ce match pour le moment.</p>
          )}

          {!loading && !pronostic?.error && pronostic?.available && pronostic.probabilities && pronostic.goals && (
            <>
              <p style={st.sectionLabel}>% de victoire</p>
              <div style={st.probRow}>
                <div style={st.probCell}>
                  <span style={st.probLabel}>Domicile</span>
                  <span style={st.probValue}>{pronostic.probabilities.home ?? "–"}%</span>
                </div>
                <div style={st.probCell}>
                  <span style={st.probLabel}>Nul</span>
                  <span style={st.probValue}>{pronostic.probabilities.draw ?? "–"}%</span>
                </div>
                <div style={st.probCell}>
                  <span style={st.probLabel}>Extérieur</span>
                  <span style={st.probValue}>{pronostic.probabilities.away ?? "–"}%</span>
                </div>
              </div>

              <p style={st.sectionLabel}>Buts probables{pronostic.live ? " (score final estimé)" : ""}</p>
              <div style={st.probRow}>
                <div style={st.probCell}>
                  <span style={st.probLabel}>Attendus</span>
                  <span style={st.probValue}>{pronostic.goals.expectedHome ?? "–"} - {pronostic.goals.expectedAway ?? "–"}</span>
                </div>
                <div style={st.probCell}>
                  <span style={st.probLabel}>+2.5 buts</span>
                  <span style={st.probValue}>{pronostic.goals.over25 ?? "–"}%</span>
                </div>
                <div style={st.probCell}>
                  <span style={st.probLabel}>Les 2 marquent</span>
                  <span style={st.probValue}>{pronostic.goals.bttsYes ?? "–"}%</span>
                </div>
              </div>

              {pronostic.extraStats && (
                <>
                  <p style={st.sectionLabel}>Corners probables</p>
                  <div style={st.probRow}>
                    <div style={st.probCell}>
                      <span style={st.probLabel}>Domicile</span>
                      <span style={st.probValue}>{pronostic.extraStats.corners.home}</span>
                    </div>
                    <div style={st.probCell}>
                      <span style={st.probLabel}>Total</span>
                      <span style={st.probValue}>{pronostic.extraStats.corners.total}</span>
                    </div>
                    <div style={st.probCell}>
                      <span style={st.probLabel}>Extérieur</span>
                      <span style={st.probValue}>{pronostic.extraStats.corners.away}</span>
                    </div>
                  </div>

                  <p style={st.sectionLabel}>Tirs / occasions probables</p>
                  <div style={st.probRow}>
                    <div style={st.probCell}>
                      <span style={st.probLabel}>Domicile</span>
                      <span style={st.probValue}>{pronostic.extraStats.shots.home}</span>
                    </div>
                    <div style={st.probCell}>
                      <span style={st.probLabel}>Total</span>
                      <span style={st.probValue}>{pronostic.extraStats.shots.total}</span>
                    </div>
                    <div style={st.probCell}>
                      <span style={st.probLabel}>Extérieur</span>
                      <span style={st.probValue}>{pronostic.extraStats.shots.away}</span>
                    </div>
                  </div>

                  <p style={st.sectionLabel}>Cartons probables</p>
                  <div style={st.probRow}>
                    <div style={st.probCell}>
                      <span style={st.probLabel}>Domicile</span>
                      <span style={st.probValue}>{pronostic.extraStats.cards.home}</span>
                    </div>
                    <div style={st.probCell}>
                      <span style={st.probLabel}>Total</span>
                      <span style={st.probValue}>{pronostic.extraStats.cards.total}</span>
                    </div>
                    <div style={st.probCell}>
                      <span style={st.probLabel}>Extérieur</span>
                      <span style={st.probValue}>{pronostic.extraStats.cards.away}</span>
                    </div>
                  </div>
                </>
              )}

              {(pronostic.correctScores || []).length > 0 && (
                <>
                  <p style={st.sectionLabel}>Scores {pronostic.live ? "finaux" : "exacts"} les plus probables</p>
                  <div style={st.scoresRow}>
                    {pronostic.correctScores.map((cs) => (
                      <div key={cs.score} style={st.scoreCell}>
                        <span style={st.probLabel}>{cs.score}</span>
                        <span style={st.probValue}>{cs.probability}%</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {pronostic.home && pronostic.away && (
                <p style={st.hint}>
                  {pronostic.home.name} :{" "}
                  {pronostic.home.position != null
                    ? `${pronostic.home.position}ᵉ (${pronostic.home.points} pts)`
                    : pronostic.home.source || "estimation"}
                  {" · "}
                  {pronostic.away.name} :{" "}
                  {pronostic.away.position != null
                    ? `${pronostic.away.position}ᵉ (${pronostic.away.points} pts)`
                    : pronostic.away.source || "estimation"}
                </p>
              )}
              {pronostic.note && <p style={st.noteText}>{pronostic.note}</p>}
              {pronostic.statsNote && <p style={st.noteText}>{pronostic.statsNote}</p>}
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
  divider: { borderTop: "1px solid #1E3D2C", margin: "16px 0" },
  h2: { fontSize: 15, margin: "0 0 4px" },
  liveHint: { fontSize: 11, color: "#D8685E", margin: "0 0 12px" },
  hint: { fontSize: 12.5, color: "#7EA694" },
  analyzeBtn: {
    display: "block", width: "100%", background: "#39B577", border: "none", color: "#06121F",
    fontWeight: 800, fontSize: 15, borderRadius: 999, padding: "14px 0", cursor: "pointer",
    boxShadow: "0 0 18px rgba(57,181,119,0.45)",
  },
  sectionLabel: { fontSize: 10, color: "#5C8A73", textTransform: "uppercase", margin: "14px 0 6px", letterSpacing: 0.4 },
  probRow: { display: "flex", gap: 8, marginBottom: 4 },
  probCell: { flex: 1, textAlign: "center", background: "#0B1F16", borderRadius: 8, padding: "10px 4px" },
  scoresRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  scoreCell: { flex: "1 1 calc(33.333% - 6px)", minWidth: 72, textAlign: "center", background: "#0B1F16", borderRadius: 8, padding: "10px 4px" },
  probLabel: { display: "block", fontSize: 9.5, color: "#7EA694", textTransform: "uppercase" },
  probValue: { fontSize: 15, fontWeight: 700 },
  noteText: { fontSize: 10.5, color: "#5C8A73", fontStyle: "italic", margin: "8px 0 0" },
};
