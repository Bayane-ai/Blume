// Blocs 6-9 du PROMPT (pronostics tennis) — Aces / Doubles fautes / Breaks : chacun
// sa propre carte, Total match + Total 1 (joueur 1) + Total 2 (joueur 2), calculés
// une seule fois avant le match et figés pour toute sa durée (voir lib/sports/tennis/
// pronosticModel.js, jamais recalculés à partir du score en direct — voir PROMPT,
// "Règle figé/live"). Même composant générique pour les 3 — équivalent tennis de
// components/BasketballSecondaryStats.js. Jeu décisif (tie-break) : sa propre carte,
// Oui/Non uniquement (jamais un pourcentage, réservé à la probabilité de victoire).
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

export default function TennisSecondaryStats({ pronostic }) {
  if (!pronostic?.available) return null;
  const homeName = pronostic.home?.name || "Joueur 1";
  const awayName = pronostic.away?.name || "Joueur 2";

  return (
    <>
      <StatCard testId="tennis-stat-aces" title="Aces" block={pronostic.aces} homeName={homeName} awayName={awayName} />
      <StatCard testId="tennis-stat-double-faults" title="Doubles fautes" block={pronostic.doubleFaults} homeName={homeName} awayName={awayName} />
      <StatCard testId="tennis-stat-breaks" title="Breaks" block={pronostic.breaks} homeName={homeName} awayName={awayName} />
      {pronostic.tiebreak && (
        <section style={st.card} data-testid="tennis-stat-tiebreak">
          <h3 style={st.cardTitle}>Jeu décisif (tie-break)</h3>
          <div style={st.marketRow} data-testid="tennis-stat-tiebreak-value">
            Un jeu décisif dans le match : {pronostic.tiebreak.likely}
          </div>
        </section>
      )}
    </>
  );
}

const st = {
  card: { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 },
  cardTitle: { fontSize: 15, fontWeight: 800, margin: "0 0 12px", color: "var(--text-primary)" },
  marketList: { display: "flex", flexDirection: "column", gap: 6 },
  marketRow: { background: "var(--surface)", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700 },
};
