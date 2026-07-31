// Bloc 12 du PROMPT — "Joueurs à suivre" : meilleur marqueur probable, lignes +X,5
// (points/rebonds/passes/3 points), fautes probables et double-double probable,
// calculés à partir des vraies statistiques de saison de chaque joueur (voir
// lib/sports/basketball/playerProps.js) — jamais un joueur inventé, deux colonnes
// (domicile/extérieur) jamais mélangées.
import { formatLine } from "../lib/marketFormat";

function PlayerLineList({ testId, label, entries }) {
  if (!entries || entries.length === 0) return null;
  return (
    <div data-testid={testId}>
      <span style={st.subLabel}>{label}</span>
      {entries.map((p) => (
        <div key={p.name} style={st.line} data-testid={`${testId}-row`}>
          <span style={st.lineName}>{p.name} — {p.side} de {formatLine(p.line)}</span>
          {p.justification && <span style={st.lineStat}>{p.justification}</span>}
        </div>
      ))}
    </div>
  );
}

function TeamPlayers({ testId, teamName, data }) {
  const hasAnything = data?.topScorer || (data?.points?.length) || (data?.rebounds?.length)
    || (data?.assists?.length) || (data?.threePointers?.length) || (data?.fouls?.length) || (data?.doubleDoubles?.length);

  return (
    <div style={st.col} data-testid={testId}>
      <span style={st.colHeader}>{teamName}</span>
      {!hasAnything && <p style={st.emptyHint}>Indisponible</p>}

      {data?.topScorer && (
        <div style={st.line} data-testid={`${testId}-top-scorer`}>
          <span style={st.lineName}>Meilleur marqueur probable : {data.topScorer.name}</span>
          <span style={st.lineStat}>{data.topScorer.justification}</span>
        </div>
      )}
      <PlayerLineList testId={`${testId}-points`} label="Points" entries={data?.points} />
      <PlayerLineList testId={`${testId}-rebounds`} label="Rebonds" entries={data?.rebounds} />
      <PlayerLineList testId={`${testId}-assists`} label="Passes décisives" entries={data?.assists} />
      <PlayerLineList testId={`${testId}-threes`} label="Tirs à 3 points" entries={data?.threePointers} />
      <PlayerLineList testId={`${testId}-fouls`} label="Fautes probables" entries={data?.fouls} />

      {data?.doubleDoubles && data.doubleDoubles.length > 0 && (
        <div data-testid={`${testId}-double-doubles`}>
          <span style={st.subLabel}>Double-double probable</span>
          {data.doubleDoubles.map((p) => (
            <div key={p.name} style={st.line} data-testid={`${testId}-double-double-row`}>
              <span style={st.lineName}>{p.name}</span>
              <span style={st.lineStat}>{p.justification}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BasketballPlayersToWatch({ pronostic }) {
  if (!pronostic?.available || !pronostic?.players) return null;

  const homeName = pronostic.home?.name || "Domicile";
  const awayName = pronostic.away?.name || "Extérieur";

  return (
    <section style={st.card} data-testid="basket-players-to-watch-card">
      <h3 style={st.cardTitle}>Joueurs à suivre</h3>
      <div style={st.columns}>
        <TeamPlayers testId="basket-players-home" teamName={homeName} data={pronostic.players.home} />
        <TeamPlayers testId="basket-players-away" teamName={awayName} data={pronostic.players.away} />
      </div>
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
  subLabel: { display: "block", fontSize: 9.5, color: "var(--text-secondary)", textTransform: "uppercase", margin: "8px 0 4px" },
  line: { background: "var(--surface)", borderRadius: 8, padding: "8px 10px", marginBottom: 6 },
  lineName: { display: "block", fontSize: 12, fontWeight: 700, overflowWrap: "break-word" },
  lineStat: { display: "block", fontSize: 10, color: "var(--text-secondary)", marginTop: 2 },
  emptyHint: { fontSize: 11, color: "var(--text-secondary)", margin: 0 },
};
