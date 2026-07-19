// Affiche un résultat de pronostic (probabilités, buts/corners/tirs/cartons,
// classement des deux équipes), utilisé par la page d'un match réel
// (pages/match/[id].js).
//
// Règle d'affichage : seules les probabilités de victoire (domicile/nul/extérieur)
// sont montrées en pourcentage. Tout le reste (buts, corners, tirs, cartons,
// possession, tendances +2.5 buts / les 2 marquent, scores exacts) est présenté
// sous forme d'intervalle, d'estimation ou de rang — jamais un "%" en dehors du
// 1X2. Les intervalles viennent de lib/pronostic.js (dérivés de la vraie variance
// du modèle pour ce match précis) ; un repli local ne sert qu'aux anciens objets
// pronostic qui n'auraient pas encore ce champ.
function rangeOrFallback(range, point) {
  if (range && typeof range.low === "number" && typeof range.high === "number") return range;
  const p = point || 0;
  const spread = Math.max(1, Math.round(Math.sqrt(Math.max(0, p))));
  const low = Math.max(0, Math.round(p - spread));
  const high = Math.round(p + spread);
  return { low, high: high <= low ? low + 1 : high };
}

// Convertit une probabilité (0-100) en repère "X/10" plutôt qu'en pourcentage — même
// idée que les intervalles ci-dessus, appliquée à une probabilité d'évènement plutôt
// qu'à une quantité.
function likelihoodTenths(pct) {
  if (pct == null) return null;
  return Math.max(0, Math.min(10, Math.round(pct / 10)));
}

export default function PronosticResults({ pronostic, loading }) {
  if (loading) return null;

  if (pronostic?.error) {
    return <p style={st.hint}>{pronostic.error}</p>;
  }
  if (pronostic?.available === false) {
    return <p style={st.hint}>{pronostic.message || "Pronostics indisponibles pour ce match."}</p>;
  }
  if (!pronostic?.available || !pronostic?.probabilities || !pronostic?.goals) {
    return <p style={st.hint}>Pronostics indisponibles pour le moment.</p>;
  }

  const goalsRange = rangeOrFallback(pronostic.goals.range, pronostic.goals.expectedTotal);
  const extraStats = pronostic.extraStats;
  const cornersRange = extraStats && rangeOrFallback(extraStats.corners.range, extraStats.corners.total);
  const shotsRange = extraStats && rangeOrFallback(extraStats.shots.range, extraStats.shots.total);
  const cardsRange = extraStats && rangeOrFallback(extraStats.cards.range, extraStats.cards.total);
  const over25Tenths = likelihoodTenths(pronostic.goals.over25);
  const bttsTenths = likelihoodTenths(pronostic.goals.bttsYes);

  return (
    <>
      <p style={st.sectionLabel}>% de victoire</p>
      <div style={st.probRow} data-testid="win-probabilities">
        <div style={st.probCell}>
          <span style={st.probLabel}>Domicile</span>
          <span style={st.probValue} data-testid="prob-home">{pronostic.probabilities.home ?? "–"}%</span>
        </div>
        <div style={st.probCell}>
          <span style={st.probLabel}>Nul</span>
          <span style={st.probValue} data-testid="prob-draw">{pronostic.probabilities.draw ?? "–"}%</span>
        </div>
        <div style={st.probCell}>
          <span style={st.probLabel}>Extérieur</span>
          <span style={st.probValue} data-testid="prob-away">{pronostic.probabilities.away ?? "–"}%</span>
        </div>
      </div>

      <p style={st.sectionLabel}>Statistiques probables{pronostic.live ? " (estimation fin de match)" : ""} — total du match</p>
      <div style={st.scoresRow} data-testid="extra-stats">
        <div style={st.scoreCell}>
          <span style={st.probLabel}>Buts attendus</span>
          <span style={st.probValue} data-testid="stat-goals">entre {goalsRange.low} et {goalsRange.high}</span>
        </div>
        {extraStats && (
          <>
            <div style={st.scoreCell}>
              <span style={st.probLabel}>Corners</span>
              <span style={st.probValue} data-testid="stat-corners">environ {cornersRange.low}-{cornersRange.high}</span>
            </div>
            <div style={st.scoreCell}>
              <span style={st.probLabel}>Tirs/occasions</span>
              <span style={st.probValue} data-testid="stat-shots">environ {shotsRange.low}-{shotsRange.high}</span>
            </div>
            <div style={st.scoreCell}>
              <span style={st.probLabel}>Cartons</span>
              <span style={st.probValue} data-testid="stat-cards">environ {cardsRange.low}-{cardsRange.high}</span>
            </div>
            {extraStats.possession && (
              <div style={st.scoreCell}>
                <span style={st.probLabel}>Possession</span>
                <span style={st.probValue} data-testid="stat-possession">
                  {extraStats.possession.home} - {extraStats.possession.away}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <p style={st.sectionLabel}>Tendances du match</p>
      <div style={st.probRow}>
        <div style={st.probCell}>
          <span style={st.probLabel}>+2.5 buts</span>
          <span style={st.probValue} data-testid="stat-over25">{over25Tenths != null ? `${over25Tenths}/10` : "–"}</span>
        </div>
        <div style={st.probCell}>
          <span style={st.probLabel}>Les 2 marquent</span>
          <span style={st.probValue} data-testid="stat-btts">{bttsTenths != null ? `${bttsTenths}/10` : "–"}</span>
        </div>
      </div>

      {pronostic.correctScores && pronostic.correctScores.length > 0 && (
        <>
          <p style={st.sectionLabel}>Scores probables</p>
          <div style={st.scoresRow} data-testid="correct-scores">
            {pronostic.correctScores.map((s, i) => (
              <div key={s.score} style={st.scoreCell}>
                <span style={st.probLabel}>{i === 0 ? "Le plus probable" : "Possible"}</span>
                <span style={st.probValue}>{s.score.replace("-", " - ")}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {pronostic.home && pronostic.away && (
        <p style={st.hint}>
          {pronostic.home.name} :{" "}
          {pronostic.home.position != null
            ? `${pronostic.home.position}ᵉ (${pronostic.home.points} pts)`
            : pronostic.home.source || "estimation"}
          {" · "}
          {pronostic.away.name} :{" "}
          {pronostic.away.position != null
            ? `${pronostic.away.position}ᵉ (${pronostic.away.points} pts)`
            : pronostic.away.source || "estimation"}
        </p>
      )}
      {pronostic.note && <p style={st.noteText}>{pronostic.note}</p>}
      {pronostic.statsNote && <p style={st.noteText}>{pronostic.statsNote}</p>}
    </>
  );
}

const st = {
  hint: { fontSize: 12.5, color: "#7EA694", marginTop: 14 },
  sectionLabel: { fontSize: 10, color: "#5C8A73", textTransform: "uppercase", margin: "14px 0 6px", letterSpacing: 0.4 },
  probRow: { display: "flex", gap: 8, marginBottom: 4 },
  probCell: { flex: 1, textAlign: "center", background: "#0B1F16", borderRadius: 8, padding: "10px 4px" },
  scoresRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  scoreCell: { flex: "1 1 calc(33.333% - 6px)", minWidth: 72, textAlign: "center", background: "#0B1F16", borderRadius: 8, padding: "10px 4px" },
  probLabel: { display: "block", fontSize: 9.5, color: "#7EA694", textTransform: "uppercase" },
  probValue: { fontSize: 15, fontWeight: 700 },
  noteText: { fontSize: 10.5, color: "#5C8A73", fontStyle: "italic", margin: "8px 0 0" },
};
