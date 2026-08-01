import TennisVerifiedLines from "./TennisVerifiedLines";

function formatDate(iso) {
  if (!iso) return "Date indisponible";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Date indisponible";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Bloc 8 (tennis) — équivalent tennis de components/BasketballPronosticHistoryCard.js :
// une carte par match terminé et classé (Succès ou Échec, voir lib/sports/tennis/
// pronosticHistory.js — classement basé UNIQUEMENT sur la probabilité de victoire),
// les deux joueurs, le score final en sets, la date, le résumé de la probabilité de
// victoire, et CHAQUE ligne de pronostic comparée individuellement au vrai résultat
// (voir components/TennisVerifiedLines.js). Utilisée par pages/probabilites-reussies.js
// et pages/probabilites-echouees.js (onglet Tennis).
export default function TennisPronosticHistoryCard({ item }) {
  if (!item) return null;

  const home = item.home_team_name || "Joueur 1";
  const away = item.away_team_name || "Joueur 2";
  const scoreHome = item.final_score?.home;
  const scoreAway = item.final_score?.away;
  const hasScore = scoreHome != null && scoreAway != null;
  const prediction = item.prediction || {};
  const probs = prediction.probabilities;
  const verification = prediction.verification;
  const isSuccess = item.status === "success";

  return (
    <div style={st.card} data-testid="tennis-pronostic-history-card">
      <div style={st.headerRow}>
        <span style={st.teams}>{home} — {away}</span>
        <span style={{ ...st.badge, ...(isSuccess ? st.badgeSuccess : st.badgeFailure) }} data-testid="tennis-history-badge">
          {isSuccess ? "Succès" : "Échec"}
        </span>
      </div>

      <div style={st.metaRow}>
        <span style={st.date}>{formatDate(item.match_date)}</span>
        <span style={st.score} data-testid="tennis-history-final-score">
          {hasScore ? `${scoreHome} - ${scoreAway}` : "Score indisponible"}
        </span>
      </div>

      {probs && (
        <div style={st.predictions}>
          <span style={st.predictionRow}>
            Victoire {home} : {probs.home} % · Victoire {away} : {probs.away} %
          </span>
        </div>
      )}

      {verification && (
        <div style={st.verifiedSection}>
          <TennisVerifiedLines
            setScores={prediction.setScores}
            gameTotals={prediction.gameTotals}
            gameHandicap={prediction.gameHandicap}
            setsBlock={prediction.setsBlock}
            aces={prediction.aces}
            doubleFaults={prediction.doubleFaults}
            breaks={prediction.breaks}
            tiebreak={prediction.tiebreak}
            verification={verification}
            homeName={home}
            awayName={away}
          />
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
