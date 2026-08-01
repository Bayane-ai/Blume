// Bloc 11 du PROMPT (pronostics tennis) — "Scénario du match" : 2 à 4 phrases
// expliquant comment le match devrait se dérouler (qui domine au service, où se
// jouent les breaks, influence de la surface) — généré à partir des vrais chiffres de
// CE match précis (voir lib/sports/tennis/pronosticModel.js#buildMatchScenario),
// jamais un texte générique recopié d'un match à l'autre.
export default function TennisMatchScenario({ pronostic }) {
  if (!pronostic?.available || !pronostic?.narrative?.matchScenario) return null;

  return (
    <section style={st.card} data-testid="tennis-match-scenario">
      <h3 style={st.cardTitle}>Scénario du match</h3>
      <p style={st.text} data-testid="tennis-match-scenario-text">{pronostic.narrative.matchScenario}</p>
    </section>
  );
}

const st = {
  card: { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 },
  cardTitle: { fontSize: 15, fontWeight: 800, margin: "0 0 12px", color: "var(--text-primary)" },
  text: { fontSize: 13, lineHeight: 1.5, color: "var(--text-primary)", margin: 0 },
};
