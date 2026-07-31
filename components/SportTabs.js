import { SPORTS } from "../lib/sports/registry";

// Multi-sport (bloc 0) : sélecteur à 3 onglets (Football | Basket | Tennis) en haut
// de l'app, rendu par components/SiteHeader.js juste au-dessus de la navigation
// existante (voir st.nav ci-dessous dans SiteHeader — celle-ci reste identique pour
// les 3 sports). Même style que le reste de l'app (cartes/pilules, accent vert) —
// pas un nouveau composant visuel, juste une rangée de pilules segmentées comme la
// navigation en dessous.
export default function SportTabs({ sport, onChange }) {
  return (
    <div style={st.row} data-testid="sport-tabs" role="tablist" aria-label="Choisir un sport">
      {SPORTS.map((s) => {
        const active = s.id === sport;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={active}
            data-testid={`sport-tab-${s.id}`}
            onClick={() => onChange(s.id)}
            style={{ ...st.tab, ...(active ? st.tabActive : {}) }}
          >
            <span aria-hidden="true">{s.icon}</span> {s.label}
          </button>
        );
      })}
    </div>
  );
}

const st = {
  row: { display: "flex", gap: 8 },
  tab: {
    flex: 1, textAlign: "center", background: "var(--card-bg)", border: "1px solid var(--border)",
    color: "var(--text-secondary)", borderRadius: 999, padding: "10px 8px", fontSize: 13, fontWeight: 700,
    cursor: "pointer",
  },
  tabActive: { background: "var(--accent)", border: "1px solid var(--accent)", color: "var(--on-accent)" },
};
