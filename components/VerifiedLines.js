import { marketLabel, riskLabels } from "../lib/marketFormat";

// Même structure que lib/pronostic.js:buildMatchStats — les 4 blocs "Corners/Hors-jeu/
// Fautes/Touches", chacun avec les mêmes 4 sous-lignes (Total match, Total 1, Total 2,
// mi-temps).
const STAT_BLOCKS = [
  { key: "corners", label: "Corners" },
  { key: "offsides", label: "Hors-jeu" },
  { key: "fouls", label: "Fautes" },
  { key: "throwIns", label: "Touches" },
];

// UNE ligne de pronostic, avec son indicateur visuel : crochet vert (ligne atteinte),
// croix rouge (ligne ratée), ou "Indisponible" quand aucune donnée réelle ne permet de
// trancher (jamais un crochet/une croix inventés — voir lib/pronosticVerification.js).
// Partagée par components/PronosticHistoryCard.js (pages "Probabilités réussies/
// échouées") et components/MatchOutcomeRecap.js (Bloc 4 : compte-rendu affiché
// directement sur la page d'un match déjà terminé).
export function VerifiedRow({ label, verified, testId = "verified-line" }) {
  return (
    <div style={st.verifiedRow} data-testid={testId}>
      <span style={st.verifiedLabel}>{label}</span>
      {verified === true && (
        <span style={{ ...st.verifiedIcon, ...st.iconSuccess }} data-testid="line-icon-success" role="img" aria-label="Ligne validée par le résultat réel">
          ✓
        </span>
      )}
      {verified === false && (
        <span style={{ ...st.verifiedIcon, ...st.iconFailure }} data-testid="line-icon-failure" role="img" aria-label="Ligne échouée">
          ✗
        </span>
      )}
      {verified == null && (
        <span style={st.verifiedUnavailable} data-testid="line-icon-unavailable">
          Indisponible
        </span>
      )}
    </div>
  );
}

// Bloc Corners/Hors-jeu/Fautes/Touches : mêmes 4 sous-lignes que components/
// LiveStatBlock.js — la ligne "mi-temps" reste toujours "Indisponible" (aucune source
// ne fournit de décompte réel par mi-temps), jamais une valeur inventée.
function StatBlockVerification({ label, block, verification }) {
  if (!block) return null;
  return (
    <div data-testid={`verified-group-${label}`}>
      <span style={st.statGroupLabel}>{label}</span>
      <VerifiedRow label={`Total match : ${marketLabel(block.total)}`} verified={verification?.total} />
      <VerifiedRow label={`Total 1 : ${marketLabel(block.home)}`} verified={verification?.home} />
      <VerifiedRow label={`Total 2 : ${marketLabel(block.away)}`} verified={verification?.away} />
      <VerifiedRow label={`${block.half?.label || "1ère mi-temps"} : ${marketLabel(block.half?.market)}`} verified={null} />
    </div>
  );
}

// CHAQUE ligne de pronostic (fautes, total, Total 1, Total 2, corners, touches,
// hors-jeu, cartons, tirs, tirs cadrés...) comparée individuellement au vrai résultat
// du match, avec son propre indicateur ✓/✗ — voir PROMPT. `sectionLabel` reste
// optionnel : la page de match (Bloc 4) affiche son propre titre de section autour de
// ce bloc, les cartes d'historique (Bloc 3) gardent celui par défaut.
export default function VerifiedLinesList({ markets, matchStats, verification, sectionLabel = "Pronostics vérifiés ligne par ligne" }) {
  if (!verification || !markets) return null;
  const yellowCardLabels = markets.yellowCards ? riskLabels(markets.yellowCards) : null;
  const redCardLabels = markets.redCards ? riskLabels(markets.redCards) : null;

  return (
    <div data-testid="verified-lines">
      {sectionLabel && <p style={st.sectionLabel}>{sectionLabel}</p>}

      <VerifiedRow label={`Total : ${marketLabel(markets.totalGoals)}`} verified={verification.totalGoals} />
      <VerifiedRow label={`Total 1 : ${marketLabel(markets.totalHome)}`} verified={verification.totalHome} />
      <VerifiedRow label={`Total 2 : ${marketLabel(markets.totalAway)}`} verified={verification.totalAway} />
      <VerifiedRow label={`Tirs : ${marketLabel(markets.shots)}`} verified={verification.shots} />
      <VerifiedRow label={`Tirs cadrés : ${marketLabel(markets.shotsOnTarget)}`} verified={verification.shotsOnTarget} />
      {yellowCardLabels && (
        <>
          <VerifiedRow label={`Cartons jaunes (sûr) : ${yellowCardLabels.safe}`} verified={verification.yellowCards?.safe} />
          <VerifiedRow label={`Cartons jaunes (risqué) : ${yellowCardLabels.risky}`} verified={verification.yellowCards?.risky} />
        </>
      )}
      {redCardLabels && (
        <>
          <VerifiedRow label={`Cartons rouges (sûr) : ${redCardLabels.safe}`} verified={verification.redCards?.safe} />
          <VerifiedRow label={`Cartons rouges (risqué) : ${redCardLabels.risky}`} verified={verification.redCards?.risky} />
        </>
      )}

      {STAT_BLOCKS.map(({ key, label }) => (
        <StatBlockVerification key={key} label={label} block={matchStats?.[key]} verification={verification[key]} />
      ))}
    </div>
  );
}

const st = {
  sectionLabel: { fontSize: 10, color: "#3F6151", textTransform: "uppercase", margin: "0 0 6px", letterSpacing: 0.4 },
  statGroupLabel: {
    display: "block", fontSize: 10.5, fontWeight: 800, color: "#13291D", margin: "10px 0 4px", textTransform: "uppercase", letterSpacing: 0.3,
  },
  verifiedRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
    background: "#EEF5F0", borderRadius: 8, padding: "6px 10px", marginBottom: 4,
  },
  verifiedLabel: { fontSize: 12, fontWeight: 600, color: "#13291D" },
  verifiedIcon: { fontSize: 13, fontWeight: 800, flexShrink: 0 },
  iconSuccess: { color: "#127A45" },
  iconFailure: { color: "#B23B2C" },
  verifiedUnavailable: { fontSize: 10, color: "#5C7A6A", fontStyle: "italic", flexShrink: 0 },
};
