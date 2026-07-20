import { riskLabels } from "../lib/marketFormat";

// Bloc "Corners et cartons", en bas de la page de pronostics : pour chacune des trois
// métriques (corners, cartons jaunes, cartons rouges), deux options "Plus/Moins de
// X,5" calculées à partir de la même estimation réelle de CE match (voir
// lib/pronostic.js, riskLines) — une option sûre (forte probabilité réelle) et une
// option risquée (ligne plus poussée, moins certaine). Complété par les vrais joueurs
// les plus sujets aux cartons cette saison (API-Football, best-effort — jamais un
// joueur inventé, "Indisponible" si la source ne répond pas).
function RiskMarketRow({ testId, label, market }) {
  const { safe, risky } = riskLabels(market);
  return (
    <div style={st.marketGroup} data-testid={testId}>
      <span style={st.marketGroupLabel}>{label}</span>
      <div style={st.marketOptions}>
        <span style={st.marketOption}>
          <span style={st.marketOptionTag}>Sûr</span> {safe}
        </span>
        <span style={st.marketOption}>
          <span style={st.marketOptionTag}>Risqué</span> {risky}
        </span>
      </div>
    </div>
  );
}

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
  if (!pronostic?.available || !pronostic?.markets) return null;

  const markets = pronostic.markets;
  const homeName = pronostic.home?.name || "Domicile";
  const awayName = pronostic.away?.name || "Extérieur";
  const homeProne = pronostic.cardProneness?.home || [];
  const awayProne = pronostic.cardProneness?.away || [];
  const noProneData = homeProne.length === 0 && awayProne.length === 0;

  return (
    <section style={st.card} data-testid="cards-corners-card">
      <h3 style={st.cardTitle}>Corners et cartons</h3>
      <div style={st.marketList} data-testid="cards-corners-markets">
        <RiskMarketRow testId="market-corners" label="Corners" market={markets.corners} />
        <RiskMarketRow testId="market-yellow-cards" label="Cartons jaunes" market={markets.yellowCards} />
        <RiskMarketRow testId="market-red-card" label="Cartons rouges" market={markets.redCards} />
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
  marketList: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 4 },
  marketGroup: { background: "#EEF5F0", borderRadius: 8, padding: "10px 12px" },
  marketGroupLabel: { display: "block", fontSize: 13, fontWeight: 800, marginBottom: 6 },
  marketOptions: { display: "flex", gap: 16, flexWrap: "wrap" },
  marketOption: { fontSize: 13, fontWeight: 700 },
  marketOptionTag: {
    fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4,
    color: "#3F6151", marginRight: 5,
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
