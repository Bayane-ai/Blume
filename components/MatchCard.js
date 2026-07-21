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
    // Un seul bloc arrondi pour toute la carte (compétition + équipes/score +
    // bouton ANALYSER) : le bouton fait désormais partie de la carte, en dernière
    // ligne, avec la même marge intérieure que le reste du contenu — jamais collé
    // ni débordant des bords (voir st.card, padding partagé par les deux enfants).
    <div style={st.card} data-testid="match-card">
      {/* Bloc 1 (parcours vidéo) : cliquer n'importe où sur les infos du match
          (équipes, score, bandeau compétition) mène DIRECTEMENT sur la page du
          match, aucune page intermédiaire — un vrai <button> pleine largeur (pas un
          <div onClick>) pour rester accessible au clavier/lecteur d'écran. Le
          bouton ANALYSER juste en dessous reste disponible en plus, comme un appel
          à l'action explicite — les deux boutons sont frères (jamais imbriqués). */}
      <button
        type="button"
        style={st.cardBody}
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
    background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14,
    padding: 14, display: "flex", flexDirection: "column", gap: 14,
  },
  cardBody: {
    display: "block", width: "100%", textAlign: "left", cursor: "pointer",
    background: "transparent", border: "none", padding: 0, margin: 0, color: "inherit",
  },
  analyzeBtn: {
    display: "block", width: "100%", background: "linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 82%, black))",
    border: "none", color: "var(--on-accent)", fontWeight: 800, fontSize: 13.5, borderRadius: 10,
    padding: "13px 0", cursor: "pointer", letterSpacing: 0.4,
    boxShadow: "0 0 14px rgba(var(--accent-rgb),0.4)",
  },
};
