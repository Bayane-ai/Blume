import { marketLabel } from "../lib/marketFormat";

// Bloc de statistiques générique — même structure et même logique pour les 4 blocs
// demandés (Corners / Hors-jeu / Fautes / Touches, voir lib/pronostic.js,
// buildMatchStats) : "Total match", "Total 1"/"Total 2" (domicile/extérieur) et une
// ligne "1ère mi-temps" — toutes calculées UNE SEULE FOIS avant le match et figées
// pour toute sa durée (référence stable pour parier, voir pages/api/analyze.js et
// lib/pronosticHistory.js), jamais recalculées à partir de ce qui se passe en direct.
// Format paris sportifs partout ("Plus de X,5" / "Moins de X,5"), jamais une cote ni
// un pourcentage.
export default function LiveStatBlock({ testId, title, block, note }) {
  if (!block) return null;

  return (
    <section style={st.card} data-testid={testId}>
      <h3 style={st.cardTitle}>{title}</h3>
      <div style={st.marketList}>
        <div style={st.marketRow} data-testid={`${testId}-total`}>Total match : {marketLabel(block.total)}</div>
        <div style={st.marketRow} data-testid={`${testId}-home`}>Total 1 : {marketLabel(block.home)}</div>
        <div style={st.marketRow} data-testid={`${testId}-away`}>Total 2 : {marketLabel(block.away)}</div>
        <div style={st.marketRow} data-testid={`${testId}-half`}>
          {block.half.label} : {marketLabel(block.half.market)}
        </div>
      </div>
      {note && <p style={st.noteText}>{note}</p>}
    </section>
  );
}

const st = {
  card: { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 },
  cardTitle: { fontSize: 15, fontWeight: 800, margin: "0 0 12px", color: "var(--text-primary)" },
  marketList: { display: "flex", flexDirection: "column", gap: 6 },
  marketRow: {
    background: "var(--surface)", borderRadius: 8, padding: "10px 12px", fontSize: 13, fontWeight: 700,
  },
  noteText: { fontSize: 10.5, color: "var(--text-secondary)", fontStyle: "italic", margin: "12px 0 0" },
};
