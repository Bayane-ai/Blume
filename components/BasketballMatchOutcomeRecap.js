import { VerifiedRow } from "./VerifiedLines";
import BasketballVerifiedLines from "./BasketballVerifiedLines";

// Bloc 4 (basket, PROMPT point 4 : "En cliquant sur un match terminé, on voit si ses
// pronostics ont été validés ou non") : équivalent basket de components/
// MatchOutcomeRecap.js — quand on ouvre la page d'un match basket déjà terminé, un
// récapitulatif s'affiche directement, pronostic par pronostic (crochet vert/croix
// rouge). Le bilan global (Succès/Échec, tout en haut) juge la MAJORITÉ de toutes ces
// lignes (voir lib/sports/basketball/pronosticHistory.js, classifyByMajority).
// Réutilise components/BasketballVerifiedLines.js — même donnée
// (`pronostic.verification`, figée une fois pour toutes en fin de match).
export default function BasketballMatchOutcomeRecap({ pronostic }) {
  if (!pronostic?.verification) return null;

  const hasHistoryStatus = pronostic.historyStatus === "success" || pronostic.historyStatus === "failure";
  const isSuccess = pronostic.historyStatus === "success";

  return (
    <section style={st.card} data-testid="basket-match-outcome-recap">
      <h3 style={st.cardTitle}>Compte-rendu du match</h3>
      {hasHistoryStatus && (
        <VerifiedRow
          testId="basket-recap-global"
          label={`Bilan global du match (majorité des lignes) : ${isSuccess ? "Succès" : "Échec"}`}
          verified={isSuccess}
        />
      )}
      <BasketballVerifiedLines
        markets={pronostic.markets}
        periods={pronostic.periods}
        pointSpread={pronostic.pointSpread}
        rebounds={pronostic.rebounds}
        assists={pronostic.assists}
        threePointers={pronostic.threePointers}
        fouls={pronostic.fouls}
        turnovers={pronostic.turnovers}
        freeThrows={pronostic.freeThrows}
        verification={pronostic.verification}
        correctScores={pronostic.correctScores}
      />
    </section>
  );
}

const st = {
  card: { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 },
  cardTitle: { fontSize: 15, fontWeight: 800, margin: "0 0 12px", color: "var(--text-primary)" },
};
