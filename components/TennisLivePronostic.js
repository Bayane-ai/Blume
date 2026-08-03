import { marketLabel } from "../lib/marketFormat";

// Remplace components/TennisPronosticResults.js + TennisSecondaryStats.js +
// TennisServiceReturnContext.js + TennisMatchScenario.js (11 blocs, bâtis sur des
// profils joueur réels indisponibles avec Live Tennis API — voir lib/sports/tennis/
// livePronostic.js) : SEULEMENT les 4 lignes réellement calculables avec ce plan
// gratuit (classement + score en direct), jamais de cote affichée.
function formatPercent(pct) {
  return pct == null ? "–" : `${pct} %`;
}

function clampPercent(pct) {
  return Math.min(100, Math.max(0, pct || 0));
}

export default function TennisLivePronostic({ pronostic }) {
  if (pronostic?.available === false) {
    return <section style={st.card}><p style={{ ...st.hint, marginTop: 0 }}>{pronostic.reason || "Pronostics indisponibles pour ce match."}</p></section>;
  }
  if (!pronostic?.available || !pronostic?.probabilities) {
    return <section style={st.card}><p style={{ ...st.hint, marginTop: 0 }}>Pronostics indisponibles pour le moment.</p></section>;
  }

  const homeName = pronostic.home?.name || "Joueur 1";
  const awayName = pronostic.away?.name || "Joueur 2";

  return (
    <>
      <section style={st.card} data-testid="tennis-win-probability-card">
        <h3 style={st.cardTitle}>Vainqueur du match</h3>
        <div style={st.marketList}>
          <div style={st.marketRow} data-testid="tennis-prob-home">
            {homeName} : {formatPercent(pronostic.probabilities.home)}
            <div style={st.probBarTrack}>
              <div style={{ ...st.probBarFill, width: `${clampPercent(pronostic.probabilities.home)}%` }} />
            </div>
          </div>
          <div style={st.marketRow} data-testid="tennis-prob-away">
            {awayName} : {formatPercent(pronostic.probabilities.away)}
            <div style={st.probBarTrack}>
              <div style={{ ...st.probBarFill, width: `${clampPercent(pronostic.probabilities.away)}%` }} />
            </div>
          </div>
        </div>
      </section>

      {pronostic.currentSetProbabilities && (
        <section style={st.card} data-testid="tennis-current-set-card">
          <h3 style={st.cardTitle}>Vainqueur du set en cours</h3>
          <div style={st.marketList}>
            <div style={st.marketRow} data-testid="tennis-current-set-home">
              {homeName} : {formatPercent(pronostic.currentSetProbabilities.home)}
            </div>
            <div style={st.marketRow} data-testid="tennis-current-set-away">
              {awayName} : {formatPercent(pronostic.currentSetProbabilities.away)}
            </div>
          </div>
        </section>
      )}

      <section style={st.card} data-testid="tennis-totals-card">
        <h3 style={st.cardTitle}>Totaux</h3>
        <div style={st.marketList}>
          <div style={st.marketRow} data-testid="tennis-total-games">
            Total jeux : {marketLabel(pronostic.gameTotals)}
          </div>
          {pronostic.totalSets?.line != null && (
            <div style={st.marketRow} data-testid="tennis-total-sets">
              Total sets : {pronostic.totalSets.side} de {String(pronostic.totalSets.line).replace(".", ",")}
            </div>
          )}
        </div>
      </section>

      {pronostic.note && <p style={st.noteText}>{pronostic.note}</p>}
    </>
  );
}

const st = {
  card: { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 },
  cardTitle: { fontSize: 15, fontWeight: 800, margin: "0 0 12px", color: "var(--text-primary)" },
  hint: { fontSize: 12.5, color: "var(--text-secondary)", marginTop: 14 },
  marketList: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 },
  marketRow: { background: "var(--surface)", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700 },
  probBarTrack: { marginTop: 8, height: 6, borderRadius: 999, background: "var(--border)", overflow: "hidden" },
  probBarFill: { height: "100%", borderRadius: 999, background: "var(--accent)" },
  noteText: { fontSize: 10.5, color: "var(--text-secondary)", fontStyle: "italic", margin: "8px 0 0" },
};
