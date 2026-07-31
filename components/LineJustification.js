// PROMPT 2 — justification courte (1-2 phrases) et niveau de confiance affichés sous
// une ligne chiffrée de pronostic, discrètement (texte plus petit, même famille visuelle
// que les notes existantes — voir st.noteText dans les autres composants de ce dossier).
// Un seul composant partagé par toutes les cartes (components/PronosticResults.js,
// LiveStatBlock.js, CardsAndCorners.js) plutôt que le même style dupliqué partout.
export default function LineJustification({ narrative }) {
  if (!narrative?.text) return null;
  return (
    <p style={st.text}>
      {narrative.text}
      {narrative.confidence && <span style={st.confidence}> · Confiance : {narrative.confidence}</span>}
    </p>
  );
}

const st = {
  text: { fontSize: 10.5, color: "var(--text-secondary)", margin: "4px 0 10px", lineHeight: 1.35 },
  confidence: { fontWeight: 700 },
};
