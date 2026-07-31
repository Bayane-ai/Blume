// Blocs 6-9 du PROMPT — Rebonds / Passes décisives / Tirs à 3 points réussis /
// Fautes : chacun sa propre carte, Total match + Total 1 (domicile) + Total 2
// (extérieur), calculés une seule fois avant le match et figés pour toute sa durée
// (voir lib/sports/basketball/pronosticModel.js, jamais recalculés à partir du score
// en direct). Même composant générique pour les 4 (même structure, même logique) —
// équivalent basket de components/LiveStatBlock.js, sans la ligne mi-temps (déjà
// couverte par components/BasketballPeriodsBlock.js).
import { marketLabel } from "../lib/marketFormat";

function StatCard({ testId, title, block, homeName, awayName }) {
  if (!block) return null;
  return (
    <section style={st.card} data-testid={testId}>
      <h3 style={st.cardTitle}>{title}</h3>
      <div style={st.marketList}>
        <div style={st.marketRow} data-testid={`${testId}-total`}>Total match : {marketLabel(block.total)}</div>
        <div style={st.marketRow} data-testid={`${testId}-home`}>Total 1 ({homeName}) : {marketLabel(block.home)}</div>
        <div style={st.marketRow} data-testid={`${testId}-away`}>Total 2 ({awayName}) : {marketLabel(block.away)}</div>
      </div>
    </section>
  );
}

export default function BasketballSecondaryStats({ pronostic }) {
  if (!pronostic?.available) return null;
  const homeName = pronostic.home?.name || "Domicile";
  const awayName = pronostic.away?.name || "Extérieur";

  return (
    <>
      <StatCard testId="basket-stat-rebounds" title="Rebonds" block={pronostic.rebounds} homeName={homeName} awayName={awayName} />
      <StatCard testId="basket-stat-assists" title="Passes décisives" block={pronostic.assists} homeName={homeName} awayName={awayName} />
      <StatCard testId="basket-stat-threes" title="Tirs à 3 points réussis" block={pronostic.threePointers} homeName={homeName} awayName={awayName} />
      <StatCard testId="basket-stat-fouls" title="Fautes" block={pronostic.fouls} homeName={homeName} awayName={awayName} />
      {pronostic.statsNote && <p style={st.noteText}>{pronostic.statsNote}</p>}
    </>
  );
}

const st = {
  card: { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 },
  cardTitle: { fontSize: 15, fontWeight: 800, margin: "0 0 12px", color: "var(--text-primary)" },
  marketList: { display: "flex", flexDirection: "column", gap: 6 },
  marketRow: { background: "var(--surface)", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700 },
  noteText: { fontSize: 10.5, color: "var(--text-secondary)", fontStyle: "italic", margin: "0" },
};
