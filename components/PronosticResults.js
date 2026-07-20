// Bloc de pronostics d'un match, présenté comme dans une app de paris sportifs — mais
// SANS jamais afficher de cote (pas de 1.85, 2.40...). Structure fixe, toujours dans
// cet ordre, identique pour tous les matchs (en ligne et à venir) :
//   1. Probabilité de victoire (1X2) — les seules valeurs en "%" de tout le bloc.
//   2. Total (buts du match entier) — ligne "Plus de X,X" / "Moins de X,X".
//   3. Total 1 (équipe à domicile seule).
//   4. Total 2 (équipe à l'extérieur seule) — jamais mélangé avec le domicile.
//   5. Corners.
//   6. Cartons.
//   7. Scores exacts (au moins 3).
// Les lignes ("X,5") et les probabilités viennent de lib/pronostic.js, calculées à
// partir des vraies statistiques des deux équipes pour CE match précis — jamais une
// valeur fixe recopiée d'un match à l'autre.
function formatPercent(pct) {
  if (pct == null) return "–";
  return `${pct} %`;
}

function formatLine(line) {
  // La ligne est toujours un nombre à virgule (ex : 2.5, jamais un entier) — une seule
  // décimale suffit, avec une virgule française plutôt qu'un point.
  return String(line).replace(".", ",");
}

function marketLabel(market) {
  if (!market) return "–";
  return `${market.side} de ${formatLine(market.line)}`;
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

  const homeName = pronostic.home?.name || "Domicile";
  const awayName = pronostic.away?.name || "Extérieur";
  const markets = pronostic.markets;

  return (
    <>
      <p style={st.sectionLabel}>Probabilité de victoire (1X2)</p>
      <div style={st.marketList} data-testid="win-probabilities">
        <div style={st.marketRow} data-testid="prob-home">
          Victoire {homeName} : {formatPercent(pronostic.probabilities.home)}
        </div>
        <div style={st.marketRow} data-testid="prob-draw">
          Match nul : {formatPercent(pronostic.probabilities.draw)}
        </div>
        <div style={st.marketRow} data-testid="prob-away">
          Victoire {awayName} : {formatPercent(pronostic.probabilities.away)}
        </div>
      </div>

      <div style={st.marketList} data-testid="match-markets">
        <div style={st.marketRow} data-testid="market-total">Total : {marketLabel(markets?.totalGoals)}</div>
        <div style={st.marketRow} data-testid="market-total-1">Total 1 : {marketLabel(markets?.totalHome)}</div>
        <div style={st.marketRow} data-testid="market-total-2">Total 2 : {marketLabel(markets?.totalAway)}</div>
        <div style={st.marketRow} data-testid="market-corners">Corners : {marketLabel(markets?.corners)}</div>
        <div style={st.marketRow} data-testid="market-cards">Cartons : {marketLabel(markets?.cards)}</div>
      </div>

      {pronostic.correctScores && pronostic.correctScores.length > 0 && (
        <>
          <p style={st.sectionLabel}>Scores exacts</p>
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
          {homeName} :{" "}
          {pronostic.home.position != null
            ? `${pronostic.home.position}ᵉ (${pronostic.home.points} pts)`
            : pronostic.home.source || "estimation"}
          {" · "}
          {awayName} :{" "}
          {pronostic.away.position != null
            ? `${pronostic.away.position}ᵉ (${pronostic.away.points} pts)`
            : pronostic.away.source || "estimation"}
        </p>
      )}
      {pronostic.note && <p style={st.noteText}>{pronostic.note}</p>}
    </>
  );
}

const st = {
  hint: { fontSize: 12.5, color: "#7EA694", marginTop: 14 },
  sectionLabel: { fontSize: 10, color: "#5C8A73", textTransform: "uppercase", margin: "14px 0 6px", letterSpacing: 0.4 },
  marketList: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 },
  marketRow: {
    background: "#0B1F16", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700,
  },
  scoresRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  scoreCell: { flex: "1 1 calc(33.333% - 6px)", minWidth: 72, textAlign: "center", background: "#0B1F16", borderRadius: 8, padding: "10px 4px" },
  probLabel: { display: "block", fontSize: 9.5, color: "#7EA694", textTransform: "uppercase" },
  probValue: { fontSize: 15, fontWeight: 700 },
  noteText: { fontSize: 10.5, color: "#5C8A73", fontStyle: "italic", margin: "8px 0 0" },
};
