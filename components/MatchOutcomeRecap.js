import VerifiedLinesList, { VerifiedRow } from "./VerifiedLines";

// Bloc 4 (parcours vidéo) : quand on appuie sur un match déjà terminé, un
// récapitulatif s'affiche directement sur sa page — pronostic par pronostic, s'il a
// été validé (crochet vert) ou raté (croix rouge), y compris le résultat Réussi/Échec
// de la probabilité de victoire (voir lib/pronosticHistory.js, classifyOutcome : jugé
// uniquement sur l'équipe favorite désignée avant le match). Réutilise le même
// composant que les cartes "Probabilités réussies/échouées" (voir
// components/VerifiedLines.js) — même logique, même donnée (`pronostic.verification`,
// figée une fois pour toutes en fin de match par lib/pronosticHistory.js).
export default function MatchOutcomeRecap({ pronostic }) {
  if (!pronostic?.verification || !pronostic?.markets) return null;

  const hasHistoryStatus = pronostic.historyStatus === "success" || pronostic.historyStatus === "failure";
  const isSuccess = pronostic.historyStatus === "success";

  return (
    <section style={st.card} data-testid="match-outcome-recap">
      <h3 style={st.cardTitle}>Compte-rendu du match</h3>
      {hasHistoryStatus && (
        <VerifiedRow
          testId="recap-win-probability"
          label={`Probabilité de victoire : ${isSuccess ? "Réussi" : "Échec"}`}
          verified={isSuccess}
        />
      )}
      <VerifiedLinesList markets={pronostic.markets} matchStats={pronostic.matchStats} verification={pronostic.verification} />
    </section>
  );
}

const st = {
  card: { background: "#FFFFFF", border: "1px solid #D8E6DE", borderRadius: 14, padding: 18 },
  cardTitle: { fontSize: 15, fontWeight: 800, margin: "0 0 12px", color: "#13291D" },
};
