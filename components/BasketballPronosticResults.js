// Bloc 3 basket (voir CLAUDE.md/PROMPT) — équivalent basket de components/
// PronosticResults.js : mêmes cartes visuelles (fond, bordure, titres), même absence
// totale de cote, mais métriques basket. Blocs 1-4 du PROMPT, dans l'ordre :
//   Carte 1 — "Probabilité de victoire" : UNIQUEMENT domicile/extérieur (pas de nul
//   au basket), justification 1-2 phrases.
//   Carte 2 — "Scores finaux probables" : 3-4 scores dérivés des vrais points
//   attendus des deux équipes (lib/sports/basketball/pronosticModel.js), jamais un
//   tirage aléatoire.
//   Carte 3 — "Écart de points" : Plus/Moins de X,5 côté de l'équipe favorite, une
//   option sûre et une plus risquée (même mécanique que Corners/Cartons côté
//   football, voir components/CardsAndCorners.js).
//   Carte 4 — "Totaux de points" : Total, Total 1 (domicile), Total 2 (extérieur).
import { marketLabel, riskLabels } from "../lib/marketFormat";

function formatPercent(pct) {
  return pct == null ? "–" : `${pct} %`;
}

function clampPercent(pct) {
  return Math.min(100, Math.max(0, pct || 0));
}

export default function BasketballPronosticResults({ pronostic }) {
  if (pronostic?.available === false) {
    return <section style={st.card}><p style={{ ...st.hint, marginTop: 0 }}>{pronostic.reason || "Pronostics indisponibles pour ce match."}</p></section>;
  }
  if (!pronostic?.available || !pronostic?.probabilities || !pronostic?.markets) {
    return <section style={st.card}><p style={{ ...st.hint, marginTop: 0 }}>Pronostics indisponibles pour le moment.</p></section>;
  }

  const homeName = pronostic.home?.name || "Domicile";
  const awayName = pronostic.away?.name || "Extérieur";
  const markets = pronostic.markets;
  const spread = pronostic.pointSpread;
  const favoriteName = spread?.favorite === "away" ? awayName : homeName;
  const spreadLabels = riskLabels(spread);

  return (
    <>
      <section style={st.card} data-testid="basket-win-probability-card">
        <h3 style={st.cardTitle}>Probabilité de victoire</h3>
        <div style={st.marketList} data-testid="basket-win-probabilities">
          <div style={st.marketRow} data-testid="basket-prob-home">
            Victoire {homeName} : {formatPercent(pronostic.probabilities.home)}
            <div style={st.probBarTrack}>
              <div style={{ ...st.probBarFill, width: `${clampPercent(pronostic.probabilities.home)}%` }} data-testid="basket-prob-bar-home" />
            </div>
          </div>
          <div style={st.marketRow} data-testid="basket-prob-away">
            Victoire {awayName} : {formatPercent(pronostic.probabilities.away)}
            <div style={st.probBarTrack}>
              <div style={{ ...st.probBarFill, width: `${clampPercent(pronostic.probabilities.away)}%` }} data-testid="basket-prob-bar-away" />
            </div>
          </div>
        </div>
        {pronostic.narrative?.winProbability && <p style={st.justification}>{pronostic.narrative.winProbability}</p>}
      </section>

      {pronostic.correctScores && pronostic.correctScores.length > 0 && (
        <section style={st.card} data-testid="basket-final-scores-card">
          <h3 style={st.cardTitle}>Scores finaux probables</h3>
          <div style={st.scoresRow} data-testid="basket-correct-scores">
            {pronostic.correctScores.map((s, i) => (
              <div key={s} style={st.scoreCell}>
                <span style={st.probLabel}>{i === 0 ? "Le plus probable" : "Possible"}</span>
                <span style={st.probValue}>{s.replace("-", " - ")}</span>
              </div>
            ))}
          </div>
          <p style={st.bettingTip}>
            (Conseil : misez de petites sommes sur chaque score exact pour limiter le risque de perte.)
          </p>
        </section>
      )}

      {spread && (
        <section style={st.card} data-testid="basket-point-spread-card">
          <h3 style={st.cardTitle}>Écart de points</h3>
          <div style={st.marketGroup} data-testid="basket-point-spread">
            <span style={st.marketGroupLabel}>Écart en faveur de {favoriteName}</span>
            <div style={st.marketOptions}>
              <span style={st.marketOption}><span style={st.marketOptionTag}>Sûr</span> {spreadLabels.safe}</span>
              <span style={st.marketOption}><span style={st.marketOptionTag}>Risqué</span> {spreadLabels.risky}</span>
            </div>
          </div>
        </section>
      )}

      <section style={st.card} data-testid="basket-totals-card">
        <h3 style={st.cardTitle}>Totaux de points</h3>
        <div style={st.marketList} data-testid="basket-totals-markets">
          <div style={st.marketRow} data-testid="basket-market-total">Total : {marketLabel(markets.totalPoints)}</div>
          <div style={st.marketRow} data-testid="basket-market-total-1">Total 1 ({homeName}) : {marketLabel(markets.totalHome)}</div>
          <div style={st.marketRow} data-testid="basket-market-total-2">Total 2 ({awayName}) : {marketLabel(markets.totalAway)}</div>
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
  scoresRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  scoreCell: { flex: "1 1 calc(33.333% - 6px)", minWidth: 72, textAlign: "center", background: "var(--surface)", borderRadius: 8, padding: "10px 4px" },
  probLabel: { display: "block", fontSize: 9.5, color: "var(--text-secondary)", textTransform: "uppercase" },
  probValue: { fontSize: 15, fontWeight: 700 },
  marketGroup: { background: "var(--surface)", borderRadius: 8, padding: "10px 12px" },
  marketGroupLabel: { display: "block", fontSize: 13, fontWeight: 800, marginBottom: 6 },
  marketOptions: { display: "flex", gap: 16, flexWrap: "wrap" },
  marketOption: { fontSize: 13, fontWeight: 700 },
  marketOptionTag: {
    fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4,
    color: "var(--text-secondary)", marginRight: 5,
  },
  justification: { fontSize: 10.5, color: "var(--text-secondary)", margin: "4px 0 0", lineHeight: 1.35 },
  noteText: { fontSize: 10.5, color: "var(--text-secondary)", fontStyle: "italic", margin: "8px 0 0" },
  bettingTip: { fontSize: 10.5, color: "var(--text-secondary)", fontStyle: "italic", margin: "8px 0 0" },
};
