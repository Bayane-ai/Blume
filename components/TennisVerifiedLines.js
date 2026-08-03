import { marketLabel } from "../lib/marketFormat";
import { VerifiedRow } from "./VerifiedLines";

// Simplifié pour Live Tennis API (voir lib/sports/tennis/livePronostic.js et
// lib/sports/tennis/pronosticHistory.js) : SEULES 3 lignes sont vérifiables après
// coup (winner, totalGames, totalSets) — le vainqueur du set en cours est une
// métrique transitoire, sans sens une fois le match terminé (pas de crochet). Partagée
// par components/TennisPronosticHistoryCard.js et TennisMatchOutcomeRecap.js.
export default function TennisVerifiedLines({
  gameTotals, totalSets, verification, homeName, awayName, sectionLabel = "Pronostics vérifiés ligne par ligne",
}) {
  if (!verification) return null;

  return (
    <div data-testid="tennis-verified-lines">
      {sectionLabel && <p style={st.sectionLabel}>{sectionLabel}</p>}
      <VerifiedRow testId="tennis-verified-winner" label="Vainqueur du match (joueur favori)" verified={verification.winner} />
      <VerifiedRow label={`Total de jeux : ${marketLabel(gameTotals)}`} verified={verification.totalGames} />
      {totalSets?.line != null && (
        <VerifiedRow
          label={`Total sets : ${totalSets.side} de ${String(totalSets.line).replace(".", ",")}`}
          verified={verification.totalSets}
        />
      )}
    </div>
  );
}

const st = {
  sectionLabel: { fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", margin: "0 0 6px", letterSpacing: 0.4 },
};
