import { marketLabel } from "../lib/marketFormat";

function formatDate(iso) {
  if (!iso) return "Date indisponible";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Date indisponible";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Une carte par match terminé et vérifié (Succès ou Échec) : les deux équipes, le
// score final, la date, les pronostics qui avaient été donnés (1X2 + Total de buts —
// les deux critères objectivement jugés contre le vrai score final, voir
// lib/pronosticHistory.js), et un badge visible de couleur — vert pour Succès, rouge
// pour Échec. Utilisée par pages/probabilites-reussies.js et
// pages/probabilites-echouees.js.
export default function PronosticHistoryCard({ item }) {
  if (!item) return null;

  const home = item.home_team_name || "Domicile";
  const away = item.away_team_name || "Extérieur";
  const scoreHome = item.final_score?.home;
  const scoreAway = item.final_score?.away;
  const hasScore = scoreHome != null && scoreAway != null;
  const probs = item.prediction?.probabilities;
  const totalMarket = item.prediction?.markets?.totalGoals;
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

      {(probs || totalMarket) && (
        <div style={st.predictions}>
          {probs && (
            <span style={st.predictionRow}>
              Victoire {home} : {probs.home} % · Nul : {probs.draw} % · Victoire {away} : {probs.away} %
            </span>
          )}
          {totalMarket && (
            <span style={st.predictionRow}>Total pronostiqué : {marketLabel(totalMarket)}</span>
          )}
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
};
