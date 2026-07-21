// "Passes décisives probables", en bas de la page (sous le bloc Corners et cartons) :
// deux colonnes (domicile / extérieur), chacune avec SES propres joueurs — jamais
// mélangés entre équipes ni entre matchs. Même source réelle que "Buteurs probables"
// (lib/probableScorers.js — les passeurs décisifs réels de la saison en cours pour la
// compétition de ce match, endpoint football-data.org dédié), simplement présentée
// dans son propre bloc séparé plutôt que mélangée aux buteurs. Jamais un joueur
// inventé, jamais de cote affichée.
function TeamAssists({ testId, teamName, data }) {
  const assists = data?.assists || [];

  return (
    <div style={st.col} data-testid={testId}>
      <span style={st.colHeader}>{teamName}</span>
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

export default function AssistsProbables({ pronostic }) {
  if (!pronostic?.available || !pronostic?.probableScorers) return null;

  const { home, away } = pronostic.probableScorers;
  const homeName = pronostic.home?.name || "Domicile";
  const awayName = pronostic.away?.name || "Extérieur";

  const totalEntries = (home?.assists?.length || 0) + (away?.assists?.length || 0);

  return (
    <section style={st.card} data-testid="assists-probables-card">
      <h3 style={st.cardTitle}>Passes décisives probables</h3>

      <div style={st.columns}>
        <TeamAssists testId="assists-home" teamName={homeName} data={home} />
        <TeamAssists testId="assists-away" teamName={awayName} data={away} />
      </div>

      {totalEntries === 0 && (
        <p style={st.hint}>Aucune donnée de passe décisive disponible pour ce match.</p>
      )}

      <p style={st.noteText}>
        Basé sur les passeurs décisifs réels de la saison en cours (source : l'API
        connectée au site) — pas un relevé match par match, non fourni par l'API.
      </p>
    </section>
  );
}

const st = {
  card: { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 },
  cardTitle: { fontSize: 15, fontWeight: 800, margin: "0 0 12px", color: "var(--text-primary)" },
  columns: { display: "flex", gap: 12 },
  col: { flex: 1, minWidth: 0 },
  colHeader: {
    display: "block", fontSize: 12, fontWeight: 800, color: "var(--text-primary)", marginBottom: 4,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  line: { background: "var(--surface)", borderRadius: 8, padding: "8px 10px", marginBottom: 6 },
  lineName: { display: "block", fontSize: 12, fontWeight: 700, overflowWrap: "break-word" },
  lineStat: { display: "block", fontSize: 10, color: "var(--text-secondary)", marginTop: 2 },
  emptyHint: { fontSize: 11, color: "var(--text-secondary)", margin: 0 },
  hint: { fontSize: 12.5, color: "var(--text-secondary)", marginTop: 10 },
  noteText: { fontSize: 10.5, color: "var(--text-secondary)", fontStyle: "italic", margin: "12px 0 0" },
};
