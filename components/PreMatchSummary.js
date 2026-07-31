// PROMPT 2 — résumé d'avant-match, en haut du bloc pronostics : quelques phrases qui
// comparent le niveau des deux équipes, leur forme et le scénario le plus probable,
// générées à partir des vrais chiffres de CE match (voir lib/matchNarrative.js) —
// jamais le même texte recopié d'un match à l'autre.
export default function PreMatchSummary({ pronostic }) {
  const text = pronostic?.narrative?.preMatchSummary;
  if (!pronostic?.available || !text) return null;

  return (
    <section style={st.card} data-testid="pre-match-summary">
      <h3 style={st.cardTitle}>Avant-match</h3>
      <p style={st.text}>{text}</p>
    </section>
  );
}

const st = {
  card: { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 },
  cardTitle: { fontSize: 15, fontWeight: 800, margin: "0 0 10px", color: "var(--text-primary)" },
  text: { fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5, margin: 0 },
};
