import { marketLabel, riskLabels } from "../lib/marketFormat";
import { VerifiedRow } from "./VerifiedLines";

// Bloc 4 (basket) — équivalent basket de components/VerifiedLines.js#VerifiedLinesList
// (réutilise VerifiedRow, le même indicateur crochet vert/croix rouge/"Indisponible")
// avec les métriques basket : pas de corners/hors-jeu/cartons, mais rebonds/passes
// décisives/tirs à 3 points/fautes (Total + Total 1 + Total 2), ballons perdus/lancers
// francs (Total match seulement), écart de points (sûr/risqué) et les 3 lignes par
// période. Partagée par components/BasketballPronosticHistoryCard.js ("Probabilités
// réussies/échouées") et components/BasketballMatchOutcomeRecap.js (compte-rendu
// affiché directement sur la page d'un match basket déjà terminé).
const STAT_BLOCKS = [
  { key: "rebounds", label: "Rebonds" },
  { key: "assists", label: "Passes décisives" },
  { key: "threePointers", label: "Tirs à 3 points" },
  { key: "fouls", label: "Fautes" },
];

function StatBlockVerification({ label, block, verification }) {
  if (!block) return null;
  return (
    <div data-testid={`basket-verified-group-${label}`}>
      <span style={st.statGroupLabel}>{label}</span>
      <VerifiedRow label={`Total match : ${marketLabel(block.total)}`} verified={verification?.total} />
      <VerifiedRow label={`Total 1 : ${marketLabel(block.home)}`} verified={verification?.home} />
      <VerifiedRow label={`Total 2 : ${marketLabel(block.away)}`} verified={verification?.away} />
    </div>
  );
}

export default function BasketballVerifiedLines({
  markets, periods, pointSpread, rebounds, assists, threePointers, fouls, turnovers, freeThrows,
  verification, correctScores, sectionLabel = "Pronostics vérifiés ligne par ligne",
}) {
  if (!verification) return null;
  const spreadLabels = pointSpread ? riskLabels(pointSpread) : null;
  const correctScoresLabel = Array.isArray(correctScores) && correctScores.length > 0
    ? correctScores.map((s) => s.replace("-", " - ")).join(" / ")
    : "–";
  const blocks = { rebounds, assists, threePointers, fouls };

  return (
    <div data-testid="basket-verified-lines">
      {sectionLabel && <p style={st.sectionLabel}>{sectionLabel}</p>}

      <VerifiedRow testId="basket-verified-winner" label="Probabilité de victoire (équipe favorite)" verified={verification.winner} />
      <VerifiedRow testId="basket-verified-correct-scores" label={`Scores finaux : ${correctScoresLabel}`} verified={verification.correctScores} />
      <VerifiedRow label={`Total : ${marketLabel(markets?.totalPoints)}`} verified={verification.totalPoints} />
      <VerifiedRow label={`Total 1 : ${marketLabel(markets?.totalHome)}`} verified={verification.totalHome} />
      <VerifiedRow label={`Total 2 : ${marketLabel(markets?.totalAway)}`} verified={verification.totalAway} />
      <VerifiedRow label={`1er quart-temps : ${marketLabel(periods?.quarter1)}`} verified={verification.quarter1} />
      <VerifiedRow label={`1ère mi-temps : ${marketLabel(periods?.firstHalf)}`} verified={verification.firstHalf} />
      <VerifiedRow label={`2ème mi-temps : ${marketLabel(periods?.secondHalf)}`} verified={verification.secondHalf} />

      {spreadLabels && (
        <>
          <VerifiedRow label={`Écart de points (sûr) : ${spreadLabels.safe}`} verified={verification.pointSpread?.safe} />
          <VerifiedRow label={`Écart de points (risqué) : ${spreadLabels.risky}`} verified={verification.pointSpread?.risky} />
        </>
      )}

      {STAT_BLOCKS.map(({ key, label }) => (
        <StatBlockVerification key={key} label={label} block={blocks[key]} verification={verification[key]} />
      ))}

      <VerifiedRow label={`Ballons perdus : ${marketLabel(turnovers?.total)}`} verified={verification.turnovers?.total} />
      <VerifiedRow label={`Lancers francs réussis : ${marketLabel(freeThrows?.total)}`} verified={verification.freeThrows?.total} />
    </div>
  );
}

const st = {
  sectionLabel: { fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", margin: "0 0 6px", letterSpacing: 0.4 },
  statGroupLabel: {
    display: "block", fontSize: 10.5, fontWeight: 800, color: "var(--text-primary)", margin: "10px 0 4px", textTransform: "uppercase", letterSpacing: 0.3,
  },
};
