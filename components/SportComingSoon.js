import { getSportMeta } from "../lib/sports/registry";

// Multi-sport (bloc 0) : état affiché à la place du contenu réel pour un sport listé
// dans lib/sports/registry.js mais pas encore branché sur une page donnée — basket et
// tennis sont désormais entièrement branchés partout (voir git log, blocs 1 à 9), ce
// composant ne sert donc plus qu'à un éventuel futur sport ajouté au registre avant
// d'être branché à toutes les pages — jamais une erreur, jamais une page blanche,
// jamais une donnée inventée (voir PROMPT, règle "aucune donnée fictive"). Même style
// de carte que le reste de l'app. `pageLabel` décrit la section affichée (ex: "Matchs
// à venir") pour que le message reste concret plutôt que générique.
export default function SportComingSoon({ sport, pageLabel }) {
  const meta = getSportMeta(sport);

  return (
    <section style={st.card} data-testid="sport-coming-soon">
      <div style={st.skeletonRow}>
        <span style={st.skeletonBar} />
        <span style={{ ...st.skeletonBar, width: "60%" }} />
        <span style={{ ...st.skeletonBar, width: "80%" }} />
      </div>
      <p style={st.text}>
        <span aria-hidden="true">{meta.icon}</span> {meta.label}
        {pageLabel ? ` — ${pageLabel}` : ""} arrive bientôt sur Blume. Cette section sera activée
        avec de vraies données dès que le bloc dédié au {meta.label.toLowerCase()} sera branché.
      </p>
    </section>
  );
}

const st = {
  card: { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 },
  skeletonRow: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 },
  skeletonBar: { display: "block", height: 12, borderRadius: 6, background: "var(--surface)", width: "100%" },
  text: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, margin: 0, textAlign: "center" },
};
