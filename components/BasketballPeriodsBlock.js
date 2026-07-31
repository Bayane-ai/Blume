// Bloc 5 du PROMPT — "Par période" : Total 1er quart-temps + Total 1ère mi-temps,
// qui devient "Total 2ème mi-temps" dès que la 1ère est terminée (voir pages/api/
// basketball/analyze.js, qui calcule activeHalfLabel/activeHalf : la ligne FIGÉE ne
// change jamais, seul le libellé affiché bascule selon l'avancement réel du match).
// Figé comme le reste de ce bloc (pas de rafraîchissement live sur ces lignes).
import { marketLabel } from "../lib/marketFormat";

export default function BasketballPeriodsBlock({ pronostic }) {
  const periods = pronostic?.periods;
  if (!periods) return null;

  return (
    <section style={st.card} data-testid="basket-periods-card">
      <h3 style={st.cardTitle}>Par période</h3>
      <div style={st.marketList}>
        <div style={st.marketRow} data-testid="basket-period-quarter1">
          Total 1er quart-temps : {marketLabel(periods.quarter1)}
        </div>
        <div style={st.marketRow} data-testid="basket-period-active-half">
          {periods.activeHalfLabel || "Total 1ère mi-temps"} : {marketLabel(periods.activeHalf)}
        </div>
      </div>
    </section>
  );
}

const st = {
  card: { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 },
  cardTitle: { fontSize: 15, fontWeight: 800, margin: "0 0 12px", color: "var(--text-primary)" },
  marketList: { display: "flex", flexDirection: "column", gap: 6 },
  marketRow: { background: "var(--surface)", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700 },
};
