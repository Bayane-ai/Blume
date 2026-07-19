import { useRouter } from "next/router";

function formatKickoffTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function hideCrest(e) {
  e.target.style.display = "none";
}

// En-tête de la page d'un match, façon écran de match en direct : flèche de retour +
// nom de la compétition centré, puis logo/nom de chaque équipe de part et d'autre du
// score (gros chiffres blancs "X - X"), et la minute en direct juste en dessous en
// rouge/orange tant que le match est en cours. Le score/la minute viennent toujours
// de `m` (état réel du match, actualisé en continu par pages/match/[id].js) — jamais
// une valeur figée au moment du clic depuis la liste.
export default function MatchHeaderHero({ m, comp, isLive }) {
  const router = useRouter();
  const competitionName = m?.competition?.name || comp?.name || "Compétition";

  const scoreHome = m?.score?.fullTime?.home;
  const scoreAway = m?.score?.fullTime?.away;
  const hasScore =
    scoreHome !== null && scoreHome !== undefined && scoreAway !== null && scoreAway !== undefined;

  // Revient à la page précédente (liste des matchs en ligne ou à venir, selon
  // d'où la personne est arrivée), plutôt qu'une destination fixe.
  const goBack = () => router.back();

  return (
    <header style={st.header}>
      <div style={st.topRow}>
        <button type="button" onClick={goBack} aria-label="Retour" style={st.backBtn}>
          ←
        </button>
        <span style={st.compName}>{competitionName}</span>
        <span style={st.topRowSpacer} aria-hidden="true" />
      </div>

      <div style={st.teamsRow}>
        <div style={st.teamCol}>
          <span style={st.crestWrap}>
            {m?.homeTeam?.crest && (
              <img src={m.homeTeam.crest} alt="" style={st.crest} onError={hideCrest} />
            )}
          </span>
          <span style={st.teamName}>{m?.homeTeam?.name}</span>
        </div>

        <div style={st.scoreCol}>
          {hasScore ? (
            <span style={st.scoreText} data-testid="live-score">
              {scoreHome} - {scoreAway}
            </span>
          ) : (
            <span style={st.kickoffText} data-testid="header-kickoff">
              {formatKickoffTime(m?.utcDate)}
            </span>
          )}
          {isLive && m?.minute != null && (
            <span style={st.liveMinute} data-testid="live-minute">
              {m.minute}’
            </span>
          )}
        </div>

        <div style={{ ...st.teamCol, ...st.teamColAway }}>
          <span style={st.crestWrap}>
            {m?.awayTeam?.crest && (
              <img src={m.awayTeam.crest} alt="" style={st.crest} onError={hideCrest} />
            )}
          </span>
          <span style={st.teamName}>{m?.awayTeam?.name}</span>
        </div>
      </div>
    </header>
  );
}

const st = {
  header: {
    background: "#06121F", borderRadius: 14, padding: "14px 16px 18px",
    maxWidth: 640, margin: "0 auto 16px",
  },
  topRow: { display: "grid", gridTemplateColumns: "32px 1fr 32px", alignItems: "center", marginBottom: 16 },
  backBtn: {
    background: "transparent", border: "none", color: "#E9F1EC", fontSize: 20,
    cursor: "pointer", padding: 0, lineHeight: 1, justifySelf: "start",
  },
  compName: {
    textAlign: "center", fontSize: 12, fontWeight: 700, color: "#7EA694",
    textTransform: "uppercase", letterSpacing: 0.4, overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  topRowSpacer: { width: 32 },
  teamsRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between" },
  teamCol: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0 },
  teamColAway: {},
  crestWrap: { width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center" },
  crest: { width: 40, height: 40, objectFit: "contain" },
  teamName: {
    fontSize: 12, fontWeight: 700, color: "#E9F1EC", textAlign: "center",
    overflowWrap: "break-word", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
  },
  scoreCol: { flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "0 10px" },
  scoreText: { fontSize: 30, fontWeight: 800, color: "#FFFFFF", letterSpacing: 0.5, lineHeight: 1 },
  kickoffText: { fontSize: 18, fontWeight: 700, color: "#FFFFFF" },
  liveMinute: { fontSize: 13, fontWeight: 800, color: "#D8685E", letterSpacing: 0.3 },
};
