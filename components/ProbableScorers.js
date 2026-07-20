// "Buteurs probables" : deux colonnes (domicile / extérieur), chacune avec SES propres
// joueurs — jamais mélangés entre équipes ni entre matchs. Basé sur les vrais buteurs
// et passeurs décisifs de la saison en cours pour la compétition de ce match (voir
// lib/probableScorers.js et lib/scorersCache.js — endpoint football-data.org dédié) :
// jamais un joueur inventé. Présenté façon lignes de paris sportifs ("X marque (ou son
// remplaçant)"), mais sans jamais afficher de cote.
function TeamScorers({ testId, teamName, data }) {
  const scorers = data?.scorers || [];
  const assists = data?.assists || [];

  return (
    <div style={st.col} data-testid={testId}>
      <span style={st.colHeader}>{teamName}</span>

      <p style={st.subLabel}>Buteur probable</p>
      {scorers.length === 0 && <p style={st.emptyHint}>Indisponible</p>}
      {scorers.map((p) => (
        <div key={p.name} style={st.line} data-testid="scorer-row">
          <span style={st.lineName}>{p.name} marque (ou son remplaçant)</span>
          <span style={st.lineStat}>{p.goals} but{p.goals > 1 ? "s" : ""} cette saison</span>
        </div>
      ))}

      <p style={st.subLabel}>Passe décisive probable</p>
      {assists.length === 0 && <p style={st.emptyHint}>Indisponible</p>}
      {assists.map((p) => (
        <div key={p.name} style={st.line} data-testid="assist-row">
          <span style={st.lineName}>{p.name} passe décisive (ou son remplaçant)</span>
          <span style={st.lineStat}>
            {p.assists} passe{p.assists > 1 ? "s" : ""} décisive{p.assists > 1 ? "s" : ""} cette saison
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ProbableScorers({ pronostic }) {
  if (!pronostic?.available || !pronostic?.probableScorers) return null;

  const { home, away } = pronostic.probableScorers;
  const homeName = pronostic.home?.name || "Domicile";
  const awayName = pronostic.away?.name || "Extérieur";

  const totalEntries =
    (home?.scorers?.length || 0) + (home?.assists?.length || 0) +
    (away?.scorers?.length || 0) + (away?.assists?.length || 0);

  return (
    <section style={st.card} data-testid="probable-scorers-card">
      <h3 style={st.cardTitle}>Buteurs probables</h3>

      <div style={st.columns}>
        <TeamScorers testId="scorers-home" teamName={homeName} data={home} />
        <TeamScorers testId="scorers-away" teamName={awayName} data={away} />
      </div>

      {totalEntries === 0 && (
        <p style={st.hint}>Aucune donnée de buteur disponible pour ce match.</p>
      )}

      <p style={st.noteText}>
        Basé sur les buteurs et passeurs décisifs réels de la saison en cours (source :
        l'API connectée au site) — pas un relevé match par match, non fourni par l'API.
      </p>
    </section>
  );
}

const st = {
  card: { background: "#12291E", border: "1px solid #1E3D2C", borderRadius: 14, padding: 18 },
  cardTitle: { fontSize: 15, fontWeight: 800, margin: "0 0 12px", color: "#E9F1EC" },
  columns: { display: "flex", gap: 12 },
  col: { flex: 1, minWidth: 0 },
  colHeader: {
    display: "block", fontSize: 12, fontWeight: 800, color: "#E9F1EC", marginBottom: 4,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  subLabel: { fontSize: 9.5, color: "#7EA694", textTransform: "uppercase", margin: "10px 0 6px" },
  line: { background: "#0B1F16", borderRadius: 8, padding: "8px 10px", marginBottom: 6 },
  lineName: { display: "block", fontSize: 12, fontWeight: 700, overflowWrap: "break-word" },
  lineStat: { display: "block", fontSize: 10, color: "#7EA694", marginTop: 2 },
  emptyHint: { fontSize: 11, color: "#7EA694", margin: 0 },
  hint: { fontSize: 12.5, color: "#7EA694", marginTop: 10 },
  noteText: { fontSize: 10.5, color: "#5C8A73", fontStyle: "italic", margin: "12px 0 0" },
};
