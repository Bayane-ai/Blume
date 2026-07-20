import { useRouter } from "next/router";
import MatchInfoBlock from "./MatchInfoBlock";

export function matchHref(m, comp) {
  return {
    pathname: `/match/${m.id}`,
    query: {
      competitionCode: m.competition?.code || comp?.code || "",
      competitionName: m.competition?.name || comp?.name || "",
      competitionEmblem: m.competition?.emblem || "",
      homeTeamId: m.homeTeam?.id ?? "",
      awayTeamId: m.awayTeam?.id ?? "",
      homeTeamName: m.homeTeam?.name || "",
      awayTeamName: m.awayTeam?.name || "",
      homeCrest: m.homeTeam?.crest || "",
      awayCrest: m.awayTeam?.crest || "",
      status: m.status || "",
      minute: m.minute ?? "",
      utcDate: m.utcDate || "",
      scoreHome: m.score?.fullTime?.home ?? "",
      scoreAway: m.score?.fullTime?.away ?? "",
    },
  };
}

export default function MatchCard({ m, comp }) {
  const router = useRouter();
  if (!m || !m.homeTeam || !m.awayTeam) return null;

  return (
    <div>
      <div style={st.card}>
        <MatchInfoBlock m={m} comp={comp} />
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
    background: "#FFFFFF", border: "1px solid #D8E6DE", borderRadius: "14px 14px 0 0",
    padding: 16, borderBottom: "none",
  },
  analyzeBtn: {
    display: "block", width: "100%", background: "#39B577", border: "none", color: "#06121F",
    fontWeight: 800, fontSize: 13.5, borderRadius: "0 0 14px 14px", padding: "13px 0", cursor: "pointer",
    letterSpacing: 0.4, marginBottom: 12,
  },
};
