import { marketLabel, riskLabels } from "../lib/marketFormat";
import { VerifiedRow } from "./VerifiedLines";

// Bloc 8 (tennis) — équivalent tennis de components/BasketballVerifiedLines.js
// (réutilise VerifiedRow, le même indicateur crochet vert/croix rouge/"Indisponible")
// avec les métriques tennis : scores en sets, totaux/handicap de jeux, sets (total,
// "les deux gagnent un set", 1er set), aces, doubles fautes (Total + Total 1 + Total
// 2), jeu décisif — jamais de corners/cartons/rebonds. Les breaks restent toujours
// "Indisponible" (voir lib/sports/tennis/pronosticHistory.js pour le pourquoi).
// Partagée par components/TennisPronosticHistoryCard.js ("Probabilités réussies/
// échouées") et components/TennisMatchOutcomeRecap.js (compte-rendu affiché
// directement sur la page d'un match tennis déjà terminé). Contrairement au football/
// basket, le classement Succès/Échec global du match (voir la ligne "winner"
// ci-dessous) est la SEULE ligne qui détermine dans quel onglet le match apparaît —
// les autres restent affichées individuellement sans peser sur ce classement (voir
// PROMPT bloc 8).
const STAT_BLOCKS = [
  { key: "aces", label: "Aces" },
  { key: "doubleFaults", label: "Doubles fautes" },
  { key: "breaks", label: "Breaks" },
];

function StatBlockVerification({ label, block, verification }) {
  if (!block) return null;
  return (
    <div data-testid={`tennis-verified-group-${label}`}>
      <span style={st.statGroupLabel}>{label}</span>
      <VerifiedRow label={`Total match : ${marketLabel(block.total)}`} verified={verification?.total} />
      <VerifiedRow label={`Total 1 : ${marketLabel(block.home)}`} verified={verification?.home} />
      <VerifiedRow label={`Total 2 : ${marketLabel(block.away)}`} verified={verification?.away} />
    </div>
  );
}

export default function TennisVerifiedLines({
  setScores, gameTotals, gameHandicap, setsBlock, aces, doubleFaults, breaks, tiebreak,
  verification, homeName, awayName, sectionLabel = "Pronostics vérifiés ligne par ligne",
}) {
  if (!verification) return null;
  const handicapLabels = gameHandicap ? riskLabels(gameHandicap) : null;
  const correctScoresLabel = Array.isArray(setScores) && setScores.length > 0
    ? setScores.map((s) => s.score.replace("-", " - ")).join(" / ")
    : "–";
  const blocks = { aces, doubleFaults, breaks };

  return (
    <div data-testid="tennis-verified-lines">
      {sectionLabel && <p style={st.sectionLabel}>{sectionLabel}</p>}

      <VerifiedRow testId="tennis-verified-winner" label="Probabilité de victoire (joueur favori)" verified={verification.winner} />
      <VerifiedRow testId="tennis-verified-correct-scores" label={`Scores en sets : ${correctScoresLabel}`} verified={verification.correctScores} />
      <VerifiedRow label={`Total de jeux : ${marketLabel(gameTotals?.total)}`} verified={verification.totalGames} />
      <VerifiedRow label={`Total 1 (${homeName || "Joueur 1"}) : ${marketLabel(gameTotals?.home)}`} verified={verification.totalGamesHome} />
      <VerifiedRow label={`Total 2 (${awayName || "Joueur 2"}) : ${marketLabel(gameTotals?.away)}`} verified={verification.totalGamesAway} />

      {handicapLabels && (
        <>
          <VerifiedRow label={`Handicap jeux (sûr) : ${handicapLabels.safe}`} verified={verification.gameHandicap?.safe} />
          <VerifiedRow label={`Handicap jeux (risqué) : ${handicapLabels.risky}`} verified={verification.gameHandicap?.risky} />
        </>
      )}

      {setsBlock && (
        <>
          <VerifiedRow label={`Total sets : ${marketLabel({ lines: [setsBlock.totalSets] })}`} verified={verification.totalSets} />
          <VerifiedRow label={`Les deux joueurs gagnent un set : ${setsBlock.bothWinASet}`} verified={verification.bothWinASet} />
          <VerifiedRow
            label={`Vainqueur du 1er set : ${setsBlock.firstSetWinner === "away" ? (awayName || "Joueur 2") : (homeName || "Joueur 1")}`}
            verified={verification.firstSetWinner}
          />
          <VerifiedRow label={`Total jeux du 1er set : ${marketLabel(setsBlock.firstSetGames)}`} verified={verification.firstSetGames} />
        </>
      )}

      {STAT_BLOCKS.map(({ key, label }) => (
        <StatBlockVerification key={key} label={label} block={blocks[key]} verification={verification[key]} />
      ))}

      {tiebreak && <VerifiedRow label={`Jeu décisif dans le match : ${tiebreak.likely}`} verified={verification.tiebreak} />}
    </div>
  );
}

const st = {
  sectionLabel: { fontSize: 10, color: "var(--text-secondary)", textTransform: "uppercase", margin: "0 0 6px", letterSpacing: 0.4 },
  statGroupLabel: {
    display: "block", fontSize: 10.5, fontWeight: 800, color: "var(--text-primary)", margin: "10px 0 4px", textTransform: "uppercase", letterSpacing: 0.3,
  },
};
