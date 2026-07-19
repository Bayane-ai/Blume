// Affiche la forme récente d'une équipe (ex : "WWDLW", fournie par football-data.org)
// sous forme de badges colorés : vert = victoire, rouge = défaite, gris = nul.
const COLORS = { W: "#39B577", D: "#7EA694", L: "#D8685E" };

export default function FormBadges({ form }) {
  if (!form) return null;
  const letters = form.split("").filter((c) => COLORS[c]);
  if (letters.length === 0) return null;

  return (
    <div style={st.row}>
      {letters.map((letter, i) => (
        <span key={i} style={{ ...st.badge, background: COLORS[letter] }}>
          {letter}
        </span>
      ))}
    </div>
  );
}

const st = {
  row: { display: "flex", gap: 4 },
  badge: {
    width: 18, height: 18, borderRadius: 4, display: "flex", alignItems: "center",
    justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#06121F",
  },
};
