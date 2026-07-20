import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import MatchHeaderHero from "../../components/MatchHeaderHero";
import MatchTimeline from "../../components/MatchTimeline";
import FormBadges from "../../components/FormBadges";
import PronosticResults from "../../components/PronosticResults";
import ProbableScorers from "../../components/ProbableScorers";
import { useRequireAuth } from "../../lib/useRequireAuth";

const LIVE_STATUSES = ["IN_PLAY", "PAUSED"];
// 2s : rendu possible sans dépasser le quota de l'API grâce au cache partagé côté
// serveur (lib/liveMatchCache.js, actualisé toutes les 2,5s), qui mutualise les appels
// entre tous les visiteurs suivant ce match. Dès qu'un but est marqué, la requête
// suivante (au plus 2s après) le reflète.
const LIVE_REFRESH_MS = 2000;

function formatKickoff(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Aujourd'hui - ${time}`;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) + ` - ${time}`;
}

export default function MatchPage() {
  const { sessionChecked, authorized } = useRequireAuth();
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
        if (result?.error) {
          console.error("Erreur /api/analyze:", result.error);
          // Rafraîchissement silencieux (live) : une erreur passagère (quota API,
          // réseau) ne doit pas faire disparaître un pronostic déjà affiché — on
          // garde le dernier résultat connu et on réessaie au prochain cycle.
          if (silent) return;
        }
        setPronostic(result);
        if (result?.matchStatus) {
          setLiveState({
            status: result.matchStatus, minute: result.matchMinute, score: result.matchScore,
            events: result.events,
          });
        }
      })
      .catch((e) => {
        console.error("Erreur /api/analyze:", e);
        if (!silent) setPronostic({ error: "Erreur lors du calcul des pronostics." });
      })
      .finally(() => setLoading(false));
  }, [router.isReady, matchId, competitionCode, homeTeamId, awayTeamId, homeTeamName, awayTeamName]);

  // Lance l'analyse automatiquement dès que le match est chargé, et à chaque fois qu'on
  // navigue vers un AUTRE match (Next.js réutilise ce même composant, seul l'id d'URL
  // change : sans matchId en dépendance, l'ancienne analyse restait affichée).
  useEffect(() => {
    if (!router.isReady || !authorized) return;
    setPronostic(null);
    setHasRequested(false);
    setLiveState(null);
    runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, authorized, matchId]);

  const currentStatus = liveState?.status || initialStatus;

  // Rafraîchissement automatique (score + probabilités) tant que le match est en direct.
  useEffect(() => {
    if (!authorized || !LIVE_STATUSES.includes(currentStatus)) return;
    const intervalId = setInterval(() => runAnalysis(true), LIVE_REFRESH_MS);
    return () => clearInterval(intervalId);
  }, [authorized, currentStatus, runAnalysis]);

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

  if (!sessionChecked) {
    return (
      <div style={st.page}>
        <p style={st.hint}>Chargement…</p>
      </div>
    );
  }
  if (!authorized) return null;

  const kickoff = formatKickoff(utcDate);
  const venue = pronostic?.venue;
  const referee = pronostic?.referee;

  return (
    <div style={st.page}>
      <MatchHeaderHero m={matchForBlock} isLive={isLiveNow} />

      {isLiveNow && (
        // Épinglée juste sous le score (position: sticky) : en faisant défiler la page,
        // les moments forts restent visibles en premier, avant le reste du contenu —
        // seule la liste des événements défile en interne (hauteur bornée) une fois
        // qu'elle dépasse ce qui tient à l'écran.
        <section style={st.pinnedPanel} data-testid="pinned-highlights">
          <h2 style={st.h2}>Moments forts</h2>
          <div style={st.timelineScroll}>
            <MatchTimeline events={liveState?.events} homeTeamId={homeTeamId} isLive />
          </div>
        </section>
      )}

      <main style={st.main}>
        <section style={st.panel}>
          {pronostic?.home && pronostic?.away && (
            <div style={st.formRow}>
              <div style={st.formCell}>
                <FormBadges form={pronostic.home.form} />
              </div>
              <div style={st.formCell}>
                <FormBadges form={pronostic.away.form} />
              </div>
            </div>
          )}

          {homeTeamName && awayTeamName && (
            <p style={st.descText}>
              {homeTeamName} affronte {awayTeamName}
              {competitionName ? ` en ${competitionName}` : ""}. Retrouve ci-dessous l'analyse statistique :
              probabilités 1X2, buts/corners/tirs probables et score exact estimé.
            </p>
          )}

          <div style={st.infoGrid}>
            <div style={st.infoCell}>
              <span style={st.infoLabel}>Coup d'envoi</span>
              <span style={st.infoValue}>{kickoff || "Indisponible"}</span>
            </div>
            <div style={st.infoCell}>
              <span style={st.infoLabel}>Stade</span>
              <span style={st.infoValue}>{venue || "Indisponible"}</span>
            </div>
            <div style={st.infoCell}>
              <span style={st.infoLabel}>Arbitre</span>
              <span style={st.infoValue}>{referee || "Indisponible"}</span>
            </div>
          </div>

          <div style={st.divider} />

          <h2 style={st.h2}>{pronostic?.live ? "Pronostics en direct" : "Pronostics automatiques"}</h2>
          {isLiveNow && (
            <p style={st.liveHint}>Score et probabilités recalculés automatiquement en continu, dès qu'un but est marqué.</p>
          )}

          <button style={st.analyzeBtn} onClick={() => runAnalysis(false)} disabled={loading}>
            {loading ? "Analyse en cours…" : hasRequested ? "Actualiser les pronostics" : "Analyser ce match"}
          </button>
        </section>

        {/* Cartes de pronostics séparées de la section ci-dessus (voir
            components/PronosticResults.js) : "Probabilité de victoire" en premier,
            "Statistiques du match" ensuite — chacune sa propre carte visuelle. */}
        {!loading && hasRequested && <PronosticResults pronostic={pronostic} loading={loading} />}
        {!loading && hasRequested && <ProbableScorers pronostic={pronostic} />}

        {!isLiveNow && (
          <section style={st.panel}>
            <h2 style={st.h2}>Moments forts</h2>
            <MatchTimeline events={liveState?.events} homeTeamId={homeTeamId} />
          </section>
        )}
      </main>
    </div>
  );
}

const st = {
  page: { minHeight: "100vh", padding: "20px 16px 60px" },
  main: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  panel: { background: "#12291E", border: "1px solid #1E3D2C", borderRadius: 14, padding: 18 },
  pinnedPanel: {
    position: "sticky", top: 0, zIndex: 5, maxWidth: 640, margin: "0 auto 16px",
    background: "#12291E", border: "1px solid #39B577", borderRadius: 14, padding: 18,
    boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
  },
  timelineScroll: { maxHeight: "34vh", overflowY: "auto" },
  formRow: { display: "flex", justifyContent: "space-between", marginTop: 12 },
  formCell: { display: "flex" },
  descText: { fontSize: 12, color: "#7EA694", margin: "14px 0 0", lineHeight: 1.5 },
  infoGrid: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 },
  infoCell: { flex: "1 1 calc(33.333% - 6px)", minWidth: 100, background: "#0B1F16", borderRadius: 8, padding: "8px 10px" },
  infoLabel: { display: "block", fontSize: 9.5, color: "#7EA694", textTransform: "uppercase" },
  infoValue: { fontSize: 12.5, fontWeight: 600 },
  divider: { borderTop: "1px solid #1E3D2C", margin: "16px 0" },
  h2: { fontSize: 15, margin: "0 0 4px" },
  liveHint: { fontSize: 11, color: "#D8685E", margin: "0 0 12px" },
  hint: { fontSize: 12.5, color: "#7EA694" },
  analyzeBtn: {
    display: "block", width: "100%", background: "#39B577", border: "none", color: "#06121F",
    fontWeight: 800, fontSize: 15, borderRadius: 999, padding: "14px 0", cursor: "pointer",
    boxShadow: "0 0 18px rgba(57,181,119,0.45)",
  },
};
