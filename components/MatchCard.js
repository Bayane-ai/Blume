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

  const goToMatch = () => router.push(matchHref(m, comp));

  return (
    <div>
      {/* Bloc 1 (parcours vidéo) : cliquer n'importe où sur la carte (équipes, score,
          bandeau compétition) mène DIRECTEMENT sur la page du match, aucune page
          intermédiaire — un vrai <button> pleine largeur (pas un <div onClick>) pour
          rester accessible au clavier/lecteur d'écran. Le bouton ANALYSER en dessous
          reste disponible en plus, comme un appel à l'action explicite. */}
      <button
        type="button"
        style={st.card}
        onClick={goToMatch}
        data-testid="match-card-body"
      >
        <MatchInfoBlock m={m} comp={comp} />
      </button>

      <button
        type="button"
        style={st.analyzeBtn}
        onClick={goToMatch}
      >
        ANALYSER
      </button>
    </div>
  );
}

const st = {
  card: {
    display: "block", width: "100%", textAlign: "left", cursor: "pointer",
    background: "#FFFFFF", border: "1px solid #D8E6DE", borderRadius: "14px 14px 0 0",
    padding: 16, borderBottom: "none",
  },
  analyzeBtn: {
    display: "block", width: "100%", background: "#39B577", border: "none", color: "#06121F",
    fontWeight: 800, fontSize: 13.5, borderRadius: "0 0 14px 14px", padding: "13px 0", cursor: "pointer",
    letterSpacing: 0.4, marginBottom: 12,
  },
};
