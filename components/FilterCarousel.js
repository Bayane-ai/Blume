// Carrousel horizontal de filtres (compétitions, journées) qui défile vers la
// droite façon sportsiqo.com — voir PROMPT 6. Ne rend que les options qui
// correspondent à au moins un match réellement chargé : aucun bouton vide ou sans
// effet, chaque clic filtre réellement la liste sur de vraies données.
export default function FilterCarousel({ testId, allLabel, items, selected, onSelect }) {
  if (!items.length) return null;

  return (
    <div style={st.carousel} data-testid={testId}>
      <button
        type="button"
        style={{ ...st.chip, ...(selected === "all" ? st.chipActive : {}) }}
        onClick={() => onSelect("all")}
      >
        {allLabel}
      </button>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          style={{ ...st.chip, ...(selected === item.value ? st.chipActive : {}) }}
          onClick={() => onSelect(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

const st = {
  carousel: {
    display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2,
    WebkitOverflowScrolling: "touch", scrollbarWidth: "thin",
  },
  chip: {
    flex: "0 0 auto", background: "var(--card-bg)", border: "1px solid var(--border)", color: "var(--text-secondary)",
    borderRadius: 999, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
    whiteSpace: "nowrap",
  },
  chipActive: { background: "var(--accent)", border: "1px solid var(--accent)", color: "var(--on-accent)" },
};
