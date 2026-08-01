import { VerifiedRow } from "./VerifiedLines";
import TennisVerifiedLines from "./TennisVerifiedLines";

// Bloc 8 (tennis, PROMPT point 4 : "Un clic sur un match terminé montre si ses
// pronostics ont été validés") : équivalent tennis de components/
// BasketballMatchOutcomeRecap.js — quand on ouvre la page d'un match tennis déjà
// terminé, un récapitulatif s'affiche directement, ligne par ligne (crochet vert/
// croix rouge). Le bilan global (Succès/Échec, tout en haut) juge UNIQUEMENT la
// probabilité de victoire (voir lib/sports/tennis/pronosticHistory.js, en-tête de
// fichier — règle explicite du bloc 8, différente du football/basket). Réutilise
// components/TennisVerifiedLines.js — même donnée (`pronostic.verification`, figée
// une fois pour toutes en fin de match).
export default function TennisMatchOutcomeRecap({ pronostic }) {
  if (!pronostic?.verification) return null;

  const hasHistoryStatus = pronostic.historyStatus === "success" || pronostic.historyStatus === "failure";
  const isSuccess = pronostic.historyStatus === "success";

  return (
    <section style={st.card} data-testid="tennis-match-outcome-recap">
      <h3 style={st.cardTitle}>Compte-rendu du match</h3>
      {hasHistoryStatus && (
        <VerifiedRow
          testId="tennis-recap-global"
          label={`Bilan global du match (probabilité de victoire) : ${isSuccess ? "Succès" : "Échec"}`}
          verified={isSuccess}
        />
      )}
      <TennisVerifiedLines
        setScores={pronostic.setScores}
        gameTotals={pronostic.gameTotals}
        gameHandicap={pronostic.gameHandicap}
        setsBlock={pronostic.setsBlock}
        aces={pronostic.aces}
        doubleFaults={pronostic.doubleFaults}
        breaks={pronostic.breaks}
        tiebreak={pronostic.tiebreak}
        verification={pronostic.verification}
        homeName={pronostic.home?.name}
        awayName={pronostic.away?.name}
      />
    </section>
  );
}

const st = {
  card: { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 },
  cardTitle: { fontSize: 15, fontWeight: 800, margin: "0 0 12px", color: "var(--text-primary)" },
};
