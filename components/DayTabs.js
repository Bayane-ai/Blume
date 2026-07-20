// Barre de sélection de jours (Aujourd'hui / Demain / Mercredi 22 juillet / ...),
// même look que components/FilterCarousel.js mais toujours exactement un jour
// sélectionné (pas de bouton "Tous" : contrairement aux compétitions, il n'y a pas de
// vue "tous les jours" sur cette page).
export default function DayTabs({ days, selectedKey, onSelect }) {
  if (!days.length) return null;

  return (
    <div style={st.carousel} data-testid="day-tabs">
      {days.map((d) => (
        <button
          key={d.key}
          type="button"
          style={{ ...st.chip, ...(selectedKey === d.key ? st.chipActive : {}) }}
          onClick={() => onSelect(d.key)}
        >
          {d.label}
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
    flex: "0 0 auto", background: "#12291E", border: "1px solid #1E3D2C", color: "#7EA694",
    borderRadius: 999, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
    whiteSpace: "nowrap",
  },
  chipActive: { background: "#39B577", border: "1px solid #39B577", color: "#06121F" },
};
