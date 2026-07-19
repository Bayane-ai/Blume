// Affiche un résultat de pronostic (probabilités, buts/corners/tirs/cartons,
// classement des deux équipes), utilisé par la page d'un match réel
// (pages/match/[id].js).
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

  return (
    <>
      <p style={st.sectionLabel}>% de victoire</p>
      <div style={st.probRow}>
        <div style={st.probCell}>
          <span style={st.probLabel}>Domicile</span>
          <span style={st.probValue}>{pronostic.probabilities.home ?? "–"}%</span>
        </div>
        <div style={st.probCell}>
          <span style={st.probLabel}>Nul</span>
          <span style={st.probValue}>{pronostic.probabilities.draw ?? "–"}%</span>
        </div>
        <div style={st.probCell}>
          <span style={st.probLabel}>Extérieur</span>
          <span style={st.probValue}>{pronostic.probabilities.away ?? "–"}%</span>
        </div>
      </div>

      <p style={st.sectionLabel}>Statistiques probables{pronostic.live ? " (estimation fin de match)" : ""} — total du match</p>
      <div style={st.scoresRow}>
        <div style={st.scoreCell}>
          <span style={st.probLabel}>Buts</span>
          <span style={st.probValue}>{pronostic.goals.expectedTotal ?? "–"}</span>
        </div>
        {pronostic.extraStats && (
          <>
            <div style={st.scoreCell}>
              <span style={st.probLabel}>Corners</span>
              <span style={st.probValue}>{pronostic.extraStats.corners.total}</span>
            </div>
            <div style={st.scoreCell}>
              <span style={st.probLabel}>Tirs/occasions</span>
              <span style={st.probValue}>{pronostic.extraStats.shots.total}</span>
            </div>
            <div style={st.scoreCell}>
              <span style={st.probLabel}>Cartons</span>
              <span style={st.probValue}>{pronostic.extraStats.cards.total}</span>
            </div>
          </>
        )}
      </div>

      <p style={st.sectionLabel}>Autres probabilités</p>
      <div style={st.probRow}>
        <div style={st.probCell}>
          <span style={st.probLabel}>+2.5 buts</span>
          <span style={st.probValue}>{pronostic.goals.over25 ?? "–"}%</span>
        </div>
        <div style={st.probCell}>
          <span style={st.probLabel}>Les 2 marquent</span>
          <span style={st.probValue}>{pronostic.goals.bttsYes ?? "–"}%</span>
        </div>
      </div>

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
