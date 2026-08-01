// Bloc 10 du PROMPT (pronostics tennis) — "Contexte service/retour" : % de 1er
// service, % de points gagnés derrière le 1er et le 2e service, % de balles de break
// converties, pour chaque joueur — présentés comme éléments d'analyse DESCRIPTIFS
// (voir PROMPT), jamais un marché Plus/Moins ni une cote (voir lib/sports/tennis/
// statProfiles.js pour la source réelle de ces chiffres, avec repli documenté quand
// les statistiques détaillées ne sont pas disponibles pour ce joueur).
function formatPct(v) {
  return v == null ? "Indisponible" : `${v} %`;
}

function PlayerContext({ testId, name, ctx }) {
  return (
    <div style={st.col} data-testid={testId}>
      <span style={st.playerName}>{name}</span>
      <div style={st.row}><span style={st.label}>1er service</span><span style={st.value}>{formatPct(ctx?.firstServeInPct)}</span></div>
      <div style={st.row}><span style={st.label}>Points gagnés au 1er service</span><span style={st.value}>{formatPct(ctx?.firstServeWonPct)}</span></div>
      <div style={st.row}><span style={st.label}>Points gagnés au 2e service</span><span style={st.value}>{formatPct(ctx?.secondServeWonPct)}</span></div>
      <div style={st.row}><span style={st.label}>Balles de break converties</span><span style={st.value}>{formatPct(ctx?.breakPointsConvertedPct)}</span></div>
    </div>
  );
}

export default function TennisServiceReturnContext({ pronostic }) {
  if (!pronostic?.available || !pronostic?.serviceReturnContext) return null;
  const homeName = pronostic.home?.name || "Joueur 1";
  const awayName = pronostic.away?.name || "Joueur 2";

  return (
    <section style={st.card} data-testid="tennis-service-return-context">
      <h3 style={st.cardTitle}>Contexte service/retour</h3>
      <div style={st.grid}>
        <PlayerContext testId="tennis-context-home" name={homeName} ctx={pronostic.serviceReturnContext.home} />
        <PlayerContext testId="tennis-context-away" name={awayName} ctx={pronostic.serviceReturnContext.away} />
      </div>
    </section>
  );
}

const st = {
  card: { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 },
  cardTitle: { fontSize: 15, fontWeight: 800, margin: "0 0 12px", color: "var(--text-primary)" },
  grid: { display: "flex", gap: 12, flexWrap: "wrap" },
  col: { flex: "1 1 140px", minWidth: 140, background: "var(--surface)", borderRadius: 8, padding: "10px 12px" },
  playerName: { display: "block", fontSize: 12.5, fontWeight: 800, marginBottom: 8 },
  row: { display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6, fontSize: 11.5 },
  label: { color: "var(--text-secondary)" },
  value: { fontWeight: 700, textAlign: "right" },
};
