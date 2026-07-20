import { marketLabel } from "../lib/marketFormat";

// Bloc "Corners et cartons", en bas de la page de pronostics : corners et cartons
// jaunes en ligne "Plus/Moins de X,5" comme les autres marchés (voir lib/pronostic.js
// — estimations statistiques, pas une mesure réelle du match) ; le carton rouge, rare
// et binaire, en probabilité plutôt qu'en ligne (voir statsNote). Complété par les
// vrais joueurs les plus sujets aux cartons cette saison (API-Football, best-effort —
// jamais un joueur inventé, "Indisponible" si la source ne répond pas).
function CardProneTeam({ testId, teamName, players }) {
  return (
    <div style={st.col} data-testid={testId}>
      <span style={st.colHeader}>{teamName}</span>
      {(!players || players.length === 0) && <p style={st.emptyHint}>Indisponible</p>}
      {(players || []).map((p) => (
        <div key={p.name} style={st.line} data-testid="card-prone-row">
          <span style={st.lineName}>{p.name}</span>
          <span style={st.lineStat}>
            {p.yellow > 0 ? `${p.yellow} jaune${p.yellow > 1 ? "s" : ""}` : ""}
            {p.yellow > 0 && p.red > 0 ? " · " : ""}
            {p.red > 0 ? `${p.red} rouge${p.red > 1 ? "s" : ""}` : ""}
            {" cette saison"}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function CardsAndCorners({ pronostic }) {
  if (!pronostic?.available || !pronostic?.markets || !pronostic?.extraStats) return null;

  const markets = pronostic.markets;
  const cards = pronostic.extraStats.cards;
  const homeName = pronostic.home?.name || "Domicile";
  const awayName = pronostic.away?.name || "Extérieur";
  const homeProne = pronostic.cardProneness?.home || [];
  const awayProne = pronostic.cardProneness?.away || [];
  const noProneData = homeProne.length === 0 && awayProne.length === 0;

  return (
    <section style={st.card} data-testid="cards-corners-card">
      <h3 style={st.cardTitle}>Corners et cartons</h3>
      <div style={st.marketList} data-testid="cards-corners-markets">
        <div style={st.marketRow} data-testid="market-corners">Corners : {marketLabel(markets.corners)}</div>
        <div style={st.marketRow} data-testid="market-yellow-cards">Cartons jaunes : {marketLabel(markets.yellowCards)}</div>
        <div style={st.marketRow} data-testid="market-red-card">
          Cartons rouges : {cards?.redProbability != null ? `${cards.redProbability} % de risque` : "–"}
        </div>
      </div>

      <p style={st.sectionLabel}>Joueurs susceptibles de prendre un carton</p>
      <div style={st.columns}>
        <CardProneTeam testId="card-prone-home" teamName={homeName} players={homeProne} />
        <CardProneTeam testId="card-prone-away" teamName={awayName} players={awayProne} />
      </div>
      {noProneData && (
        <p style={st.hint}>Aucune donnée de cartons par joueur disponible pour ce match.</p>
      )}

      <p style={st.noteText}>{pronostic.statsNote}</p>
    </section>
  );
}

const st = {
  card: { background: "#FFFFFF", border: "1px solid #D8E6DE", borderRadius: 14, padding: 18 },
  cardTitle: { fontSize: 15, fontWeight: 800, margin: "0 0 12px", color: "#13291D" },
  marketList: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 },
  marketRow: {
    background: "#EEF5F0", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700,
  },
  sectionLabel: { fontSize: 10, color: "#3F6151", textTransform: "uppercase", margin: "14px 0 6px", letterSpacing: 0.4 },
  columns: { display: "flex", gap: 12 },
  col: { flex: 1, minWidth: 0 },
  colHeader: {
    display: "block", fontSize: 12, fontWeight: 800, color: "#13291D", marginBottom: 4,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  line: { background: "#EEF5F0", borderRadius: 8, padding: "8px 10px", marginBottom: 6 },
  lineName: { display: "block", fontSize: 12, fontWeight: 700, overflowWrap: "break-word" },
  lineStat: { display: "block", fontSize: 10, color: "#5C7A6A", marginTop: 2 },
  emptyHint: { fontSize: 11, color: "#5C7A6A", margin: 0 },
  hint: { fontSize: 12.5, color: "#5C7A6A", marginTop: 10 },
  noteText: { fontSize: 10.5, color: "#3F6151", fontStyle: "italic", margin: "12px 0 0" },
};
