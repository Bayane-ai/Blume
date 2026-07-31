// Blocs 10-11 du PROMPT — Ballons perdus et Lancers francs réussis : Total match
// SEULEMENT (jamais de Total 1/Total 2, contrairement aux blocs 6-9), chacun sa
// propre carte. Figés comme le reste (voir lib/sports/basketball/pronosticModel.js).
import { marketLabel } from "../lib/marketFormat";

export default function BasketballSingleTotals({ pronostic }) {
  if (!pronostic?.available) return null;

  return (
    <>
      <section style={st.card} data-testid="basket-stat-turnovers">
        <h3 style={st.cardTitle}>Ballons perdus</h3>
        <div style={st.marketRow} data-testid="basket-stat-turnovers-total">
          Total match : {marketLabel(pronostic.turnovers?.total)}
        </div>
      </section>
      <section style={st.card} data-testid="basket-stat-free-throws">
        <h3 style={st.cardTitle}>Lancers francs réussis</h3>
        <div style={st.marketRow} data-testid="basket-stat-free-throws-total">
          Total match : {marketLabel(pronostic.freeThrows?.total)}
        </div>
      </section>
    </>
  );
}

const st = {
  card: { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 },
  cardTitle: { fontSize: 15, fontWeight: 800, margin: "0 0 12px", color: "var(--text-primary)" },
  marketRow: { background: "var(--surface)", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700 },
};
