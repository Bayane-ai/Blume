import { marketLabel, riskLabels } from "../lib/marketFormat";

function formatDate(iso) {
  if (!iso) return "Date indisponible";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Date indisponible";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

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
function VerifiedRow({ label, verified }) {
  return (
    <div style={st.verifiedRow} data-testid="verified-line">
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

// Une carte par match terminé et vérifié (Succès ou Échec) : les deux équipes, le
// score final, la date, le résumé des probabilités, et — voir PROMPT — CHAQUE ligne de
// pronostic (fautes, total, Total 1, Total 2, corners, touches, hors-jeu, cartons,
// tirs...) comparée individuellement au vrai résultat du match, avec son propre
// indicateur ✓/✗. Le badge global (Succès/Échec, voir lib/pronosticHistory.js) reste
// lui jugé sur l'issue (1X2) et le Total de buts uniquement — les indicateurs par
// ligne sont un complément plus détaillé, pas un remplacement. Utilisée par
// pages/probabilites-reussies.js et pages/probabilites-echouees.js.
export default function PronosticHistoryCard({ item }) {
  if (!item) return null;

  const home = item.home_team_name || "Domicile";
  const away = item.away_team_name || "Extérieur";
  const scoreHome = item.final_score?.home;
  const scoreAway = item.final_score?.away;
  const hasScore = scoreHome != null && scoreAway != null;
  const probs = item.prediction?.probabilities;
  const markets = item.prediction?.markets;
  const matchStats = item.prediction?.matchStats;
  const verification = item.prediction?.verification;
  const isSuccess = item.status === "success";
  const yellowCardLabels = markets?.yellowCards ? riskLabels(markets.yellowCards) : null;
  const redCardLabels = markets?.redCards ? riskLabels(markets.redCards) : null;

  return (
    <div style={st.card} data-testid="pronostic-history-card">
      <div style={st.headerRow}>
        <span style={st.teams}>{home} — {away}</span>
        <span style={{ ...st.badge, ...(isSuccess ? st.badgeSuccess : st.badgeFailure) }} data-testid="history-badge">
          {isSuccess ? "Succès" : "Échec"}
        </span>
      </div>

      <div style={st.metaRow}>
        <span style={st.date}>{formatDate(item.match_date)}</span>
        <span style={st.score} data-testid="history-final-score">
          {hasScore ? `${scoreHome} - ${scoreAway}` : "Score indisponible"}
        </span>
      </div>

      {probs && (
        <div style={st.predictions}>
          <span style={st.predictionRow}>
            Victoire {home} : {probs.home} % · Nul : {probs.draw} % · Victoire {away} : {probs.away} %
          </span>
        </div>
      )}

      {verification && markets && (
        <div style={st.verifiedSection} data-testid="verified-lines">
          <p style={st.sectionLabel}>Pronostics vérifiés ligne par ligne</p>

          <VerifiedRow label={`Total : ${marketLabel(markets.totalGoals)}`} verified={verification.totalGoals} />
          <VerifiedRow label={`Total 1 : ${marketLabel(markets.totalHome)}`} verified={verification.totalHome} />
          <VerifiedRow label={`Total 2 : ${marketLabel(markets.totalAway)}`} verified={verification.totalAway} />
          <VerifiedRow label={`Tirs : ${marketLabel(markets.shots)}`} verified={verification.shots} />
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
      )}
    </div>
  );
}

const st = {
  card: { background: "#FFFFFF", border: "1px solid #D8E6DE", borderRadius: 14, padding: 16 },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  teams: { fontSize: 14, fontWeight: 800, color: "#13291D" },
  badge: {
    flexShrink: 0, fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "4px 10px", textTransform: "uppercase",
  },
  badgeSuccess: { background: "#DCF5E6", color: "#127A45" },
  badgeFailure: { background: "#FBE1DE", color: "#B23B2C" },
  metaRow: { display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12.5, color: "#5C7A6A" },
  date: {},
  score: { fontWeight: 700, color: "#13291D" },
  predictions: { display: "flex", flexDirection: "column", gap: 4, marginTop: 10 },
  predictionRow: { fontSize: 12, color: "#3F6151" },
  verifiedSection: { marginTop: 12, paddingTop: 10, borderTop: "1px solid #EEF5F0" },
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
