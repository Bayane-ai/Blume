import { useRouter } from "next/router";

const LIVE_STATUSES = ["IN_PLAY", "PAUSED"];

function formatKickoff(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("fr-FR", {
    weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function hideImg(e) {
  e.target.style.display = "none";
}

function matchHref(m, comp) {
  return {
    pathname: `/match/${m.id}`,
    query: {
      competitionCode: m.competition?.code || comp?.code || "",
      competitionName: m.competition?.name || comp?.name || "",
      homeTeamId: m.homeTeam?.id ?? "",
      awayTeamId: m.awayTeam?.id ?? "",
      homeTeamName: m.homeTeam?.name || "",
      awayTeamName: m.awayTeam?.name || "",
      homeCrest: m.homeTeam?.crest || "",
      awayCrest: m.awayTeam?.crest || "",
      status: m.status || "",
      utcDate: m.utcDate || "",
      scoreHome: m.score?.fullTime?.home ?? "",
      scoreAway: m.score?.fullTime?.away ?? "",
    },
  };
}

export default function MatchCard({ m, comp }) {
  const router = useRouter();
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
      <div style={st.card}>
        <div style={st.compBanner}>
          <div style={st.compLeft}>
            {competitionEmblem && (
              <img src={competitionEmblem} alt={competitionName} style={st.compEmblem} onError={hideImg} />
            )}
            <span style={st.compName}>{competitionName}</span>
          </div>
          {isLive && (
            <span style={st.liveTag}>LIVE{m.minute ? ` · ${m.minute}’` : ""}</span>
          )}
          {isFinished && <span style={st.finishedTag}>Terminé</span>}
        </div>

        <div style={st.teamRow}>
          <div style={st.teamBlock}>
            {m.homeTeam.crest && (
              <img src={m.homeTeam.crest} alt="" style={st.crest} onError={hideImg} />
            )}
            <span style={st.teamName}>{m.homeTeam.name}</span>
          </div>
          <span style={st.centerSlot}>
            {hasScore ? `${scoreHome ?? "–"} : ${scoreAway ?? "–"}` : formatKickoff(m.utcDate)}
          </span>
          <div style={{ ...st.teamBlock, ...st.teamBlockAway }}>
            <span style={st.teamName}>{m.awayTeam.name}</span>
            {m.awayTeam.crest && (
              <img src={m.awayTeam.crest} alt="" style={st.crest} onError={hideImg} />
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        style={st.analyzeBtn}
        onClick={() => router.push(matchHref(m, comp))}
      >
        ANALYSER
      </button>
    </div>
  );
}

const st = {
  card: {
    background: "#12291E", border: "1px solid #1E3D2C", borderRadius: "14px 14px 0 0",
    padding: 16, borderBottom: "none",
  },
  compBanner: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  compLeft: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  compEmblem: { width: 18, height: 18, objectFit: "contain", flexShrink: 0 },
  compName: {
    fontSize: 11, color: "#7EA694", textTransform: "uppercase", letterSpacing: 0.3,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  liveTag: { fontSize: 11, color: "#D8685E", fontWeight: 800, flexShrink: 0, letterSpacing: 0.3 },
  finishedTag: { fontSize: 11, color: "#7EA694", fontWeight: 600, flexShrink: 0 },
  teamRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 14 },
  teamBlock: { flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  teamBlockAway: { justifyContent: "flex-end" },
  crest: { width: 26, height: 26, objectFit: "contain", flexShrink: 0 },
  teamName: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 },
  centerSlot: { fontWeight: 800, color: "#39B577", flexShrink: 0, padding: "0 8px", fontSize: 15 },
  analyzeBtn: {
    display: "block", width: "100%", background: "#39B577", border: "none", color: "#06121F",
    fontWeight: 800, fontSize: 13.5, borderRadius: "0 0 14px 14px", padding: "13px 0", cursor: "pointer",
    letterSpacing: 0.4, marginBottom: 12,
  },
};
