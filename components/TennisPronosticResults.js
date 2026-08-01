// Bloc 7 (pronostics tennis) — équivalent tennis de components/PronosticResults.js
// (football) et components/BasketballPronosticResults.js (basket) : mêmes cartes
// visuelles (fond, bordure, titres), même absence totale de cote. Blocs 1-5 du
// PROMPT, dans cet ordre, toujours identique :
//   Carte 1 — "Probabilité de victoire" : UNIQUEMENT le pourcentage joueur 1/joueur 2
//   (les SEULES valeurs en "%" de toute la page), avec une barre visuelle et une
//   courte justification (lib/sports/tennis/pronosticModel.js).
//   Carte 2 — "Scores en sets probables" : 3 à 4 scores, dérivés de la vraie
//   distribution du modèle de Markov (jamais un tirage aléatoire).
//   Carte 3 — "Totaux de jeux" : Total, Total 1, Total 2 — Plus/Moins de X,5.
//   Carte 4 — "Handicap jeux" : écart de jeux en faveur du favori, une option sûre et
//   une plus risquée (même mécanique que components/CardsAndCorners.js/
//   BasketballPronosticResults.js "Écart de points").
//   Carte 5 — "Sets" : total de sets, "les deux joueurs gagnent au moins un set"
//   (Oui/Non), vainqueur probable du 1er set + total de jeux du 1er set.
import { marketLabel, riskLabels } from "../lib/marketFormat";

function formatPercent(pct) {
  return pct == null ? "–" : `${pct} %`;
}

function clampPercent(pct) {
  return Math.min(100, Math.max(0, pct || 0));
}

export default function TennisPronosticResults({ pronostic }) {
  if (pronostic?.available === false) {
    return <section style={st.card}><p style={{ ...st.hint, marginTop: 0 }}>{pronostic.reason || "Pronostics indisponibles pour ce match."}</p></section>;
  }
  if (!pronostic?.available || !pronostic?.probabilities) {
    return <section style={st.card}><p style={{ ...st.hint, marginTop: 0 }}>Pronostics indisponibles pour le moment.</p></section>;
  }

  const homeName = pronostic.home?.name || "Joueur 1";
  const awayName = pronostic.away?.name || "Joueur 2";
  const setsBlock = pronostic.setsBlock;

  return (
    <>
      <section style={st.card} data-testid="tennis-win-probability-card">
        <h3 style={st.cardTitle}>Probabilité de victoire</h3>
        <div style={st.marketList} data-testid="tennis-win-probabilities">
          <div style={st.marketRow} data-testid="tennis-prob-home">
            Victoire {homeName} : {formatPercent(pronostic.probabilities.home)}
            <div style={st.probBarTrack}>
              <div style={{ ...st.probBarFill, width: `${clampPercent(pronostic.probabilities.home)}%` }} data-testid="tennis-prob-bar-home" />
            </div>
          </div>
          <div style={st.marketRow} data-testid="tennis-prob-away">
            Victoire {awayName} : {formatPercent(pronostic.probabilities.away)}
            <div style={st.probBarTrack}>
              <div style={{ ...st.probBarFill, width: `${clampPercent(pronostic.probabilities.away)}%` }} data-testid="tennis-prob-bar-away" />
            </div>
          </div>
        </div>
        {pronostic.narrative?.winProbability && <p style={st.justification}>{pronostic.narrative.winProbability}</p>}
      </section>

      {pronostic.setScores?.length > 0 && (
        <section style={st.card} data-testid="tennis-set-scores-card">
          <h3 style={st.cardTitle}>Scores en sets probables</h3>
          <div style={st.scoresRow} data-testid="tennis-set-scores">
            {pronostic.setScores.map((s, i) => (
              <div key={s.score} style={st.scoreCell}>
                <span style={st.probLabel}>{i === 0 ? "Le plus probable" : "Possible"}</span>
                <span style={st.probValue}>{s.score.replace("-", " - ")}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={st.card} data-testid="tennis-game-totals-card">
        <h3 style={st.cardTitle}>Totaux de jeux</h3>
        <div style={st.marketList} data-testid="tennis-game-totals-markets">
          <div style={st.marketRow} data-testid="tennis-market-total">Total : {marketLabel(pronostic.gameTotals?.total)}</div>
          <div style={st.marketRow} data-testid="tennis-market-total-1">Total 1 ({homeName}) : {marketLabel(pronostic.gameTotals?.home)}</div>
          <div style={st.marketRow} data-testid="tennis-market-total-2">Total 2 ({awayName}) : {marketLabel(pronostic.gameTotals?.away)}</div>
        </div>
      </section>

      {pronostic.gameHandicap && (
        <section style={st.card} data-testid="tennis-handicap-card">
          <h3 style={st.cardTitle}>Handicap jeux</h3>
          <div style={st.marketGroup} data-testid="tennis-handicap">
            <span style={st.marketGroupLabel}>
              Écart en faveur de {pronostic.gameHandicap.favorite === "away" ? awayName : homeName}
            </span>
            <div style={st.marketOptions}>
              <span style={st.marketOption}><span style={st.marketOptionTag}>Sûr</span> {riskLabels(pronostic.gameHandicap).safe}</span>
              <span style={st.marketOption}><span style={st.marketOptionTag}>Risqué</span> {riskLabels(pronostic.gameHandicap).risky}</span>
            </div>
          </div>
        </section>
      )}

      {setsBlock && (
        <section style={st.card} data-testid="tennis-sets-block-card">
          <h3 style={st.cardTitle}>Sets</h3>
          <div style={st.marketList} data-testid="tennis-sets-block">
            <div style={st.marketRow} data-testid="tennis-total-sets">
              Total sets : {marketLabel({ lines: [setsBlock.totalSets] })}
            </div>
            <div style={st.marketRow} data-testid="tennis-both-win-a-set">
              Les deux joueurs gagnent au moins un set : {setsBlock.bothWinASet}
            </div>
            <div style={st.marketRow} data-testid="tennis-first-set-winner">
              Vainqueur probable du 1er set : {setsBlock.firstSetWinner === "away" ? awayName : homeName}
            </div>
            <div style={st.marketRow} data-testid="tennis-first-set-games">
              Total jeux du 1er set : {marketLabel(setsBlock.firstSetGames)}
            </div>
          </div>
        </section>
      )}

      {pronostic.home && pronostic.away && (
        <p style={st.hint}>
          {homeName} : {pronostic.home.ranking != null ? `${pronostic.home.ranking}ᵉ mondial(e)` : pronostic.home.source || "estimation"}
          {" · "}
          {awayName} : {pronostic.away.ranking != null ? `${pronostic.away.ranking}ᵉ mondial(e)` : pronostic.away.source || "estimation"}
        </p>
      )}
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
};
