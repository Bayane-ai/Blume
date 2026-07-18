const LIVE_STATUSES = ["IN_PLAY", "PAUSED"];

function formatKickoff(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function hideCrest(e) {
  e.target.parentElement.style.display = "none";
}

// Bloc d'affichage d'un match (bandeau compétition + équipes + score),
// partagé entre la liste des matchs et la page dédiée d'un match, pour
// que les deux pages montrent exactement le même bloc.
export default function MatchInfoBlock({ m, comp }) {
  if (!m || !m.homeTeam || !m.awayTeam) return null;

  const isLive = LIVE_STATUSES.includes(m.status);
  const isFinished = m.status === "FINISHED";
  const competitionName = m.competition?.name || comp?.name || "Compétition";
  const competitionEmblem = m.competition?.emblem || "";

  const scoreHome = m.score?.fullTime?.home;
  const scoreAway = m.score?.fullTime?.away;
  const hasScore = scoreHome !== null && scoreHome !== undefined;

  return (
    <div>
      <div style={st.compBanner}>
        <div style={st.compLeft}>
          {competitionEmblem && (
            <img src={competitionEmblem} alt={competitionName} style={st.compEmblem} onError={(e) => (e.target.style.display = "none")} />
          )}
          <span style={st.compName}>{competitionName}</span>
        </div>
        {isLive && <span style={st.liveTag}>LIVE{m.minute ? ` · ${m.minute}’` : ""}</span>}
        {isFinished && <span style={st.finishedTag}>Terminé</span>}
      </div>

      <div style={st.teamRow}>
        <div style={st.teamBlock}>
          {m.homeTeam.crest && (
            <span style={st.crestWrap}>
              <img src={m.homeTeam.crest} alt="" style={st.crest} onError={hideCrest} />
            </span>
          )}
          <span style={st.teamName}>{m.homeTeam.name}</span>
        </div>
        <div style={{ ...st.teamBlock, ...st.teamBlockAway }}>
          <span style={{ ...st.teamName, ...st.teamNameAway }}>{m.awayTeam.name}</span>
          {m.awayTeam.crest && (
            <span style={st.crestWrap}>
              <img src={m.awayTeam.crest} alt="" style={st.crest} onError={hideCrest} />
            </span>
          )}
        </div>
      </div>

      <div style={st.centerSlot}>
        {hasScore ? `${scoreHome ?? "–"} : ${scoreAway ?? "–"}` : formatKickoff(m.utcDate)}
      </div>
    </div>
  );
}

const st = {
  compBanner: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  compLeft: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  compEmblem: { width: 18, height: 18, objectFit: "contain", flexShrink: 0 },
  compName: {
    fontSize: 11, color: "#7EA694", textTransform: "uppercase", letterSpacing: 0.3,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  liveTag: { fontSize: 11, color: "#D8685E", fontWeight: 800, flexShrink: 0, letterSpacing: 0.3 },
  finishedTag: { fontSize: 11, color: "#7EA694", fontWeight: 600, flexShrink: 0 },
  teamRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, fontSize: 14 },
  teamBlock: { flex: 1, display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
  teamBlockAway: { justifyContent: "flex-end" },
  crestWrap: {
    width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "radial-gradient(circle, rgba(57,181,119,0.25) 0%, rgba(57,181,119,0) 70%)",
    boxShadow: "0 0 12px rgba(57,181,119,0.35)",
  },
  crest: { width: 30, height: 30, objectFit: "contain", filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.4))" },
  teamName: {
    fontWeight: 600, overflowWrap: "break-word", display: "-webkit-box",
    WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
  },
  teamNameAway: { textAlign: "right" },
  centerSlot: { fontWeight: 800, color: "#39B577", fontSize: 16, textAlign: "center", marginTop: 10 },
};
