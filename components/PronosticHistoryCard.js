import VerifiedLinesList from "./VerifiedLines";

function formatDate(iso) {
  if (!iso) return "Date indisponible";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Date indisponible";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Une carte par match terminé et vérifié (Succès ou Échec) : les deux équipes, le
// score final, la date, le résumé des probabilités, et — voir PROMPT — CHAQUE ligne de
// pronostic (fautes, total, Total 1, Total 2, corners, touches, hors-jeu, cartons,
// tirs...) comparée individuellement au vrai résultat du match, avec son propre
// indicateur ✓/✗ (voir components/VerifiedLines.js, partagé avec le compte-rendu
// affiché directement sur la page d'un match terminé — Bloc 4, voir
// components/MatchOutcomeRecap.js). Le badge global (Succès/Échec, voir
// lib/pronosticHistory.js, classifyOutcome) reste lui jugé UNIQUEMENT sur l'équipe
// favorite désignée avant le match (a-t-elle réellement gagné ?) — les indicateurs
// par ligne sont un complément plus détaillé, pas un remplacement. Utilisée par
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
        <div style={st.verifiedSection}>
          <VerifiedLinesList markets={markets} matchStats={matchStats} verification={verification} />
        </div>
      )}
    </div>
  );
}

const st = {
  card: { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 16 },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 },
  teams: { fontSize: 14, fontWeight: 800, color: "var(--text-primary)" },
  badge: {
    flexShrink: 0, fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "4px 10px", textTransform: "uppercase",
  },
  badgeSuccess: { background: "var(--accent-soft)", color: "var(--accent)" },
  badgeFailure: { background: "var(--negative-soft)", color: "var(--negative)" },
  metaRow: { display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 12.5, color: "var(--text-secondary)" },
  date: {},
  score: { fontWeight: 700, color: "var(--text-primary)" },
  predictions: { display: "flex", flexDirection: "column", gap: 4, marginTop: 10 },
  predictionRow: { fontSize: 12, color: "var(--text-secondary)" },
  verifiedSection: { marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--surface)" },
};
