// Bloc 4 (basket) — "Moments forts" épinglé en haut de la page de match en direct
// (voir pages/match/[id].js) : dérivé du VRAI score officiel (lib/sports/basketball/
// timeline.js), JAMAIS "Événement non disponible" une fois le match commencé — au pire
// "En attente du coup d'envoi." avant que la première donnée n'arrive. `events` vient
// déjà dans l'ordre chronologique (le plus ancien en premier, voir timeline.js) :
// inversé ici pour afficher le plus récent en tête, comme components/MatchTimeline.js
// côté football.
const EVENT_META = {
  KICKOFF: { icon: "🏀", label: "Coup d'envoi" },
  QUARTER_END: { icon: "⏱️", label: "Fin de quart-temps" },
  LEAD_CHANGE: { icon: "🔄", label: "Changement de leader" },
  RUN: { icon: "🔥", label: "Série" },
  FULL_TIME: { icon: "🏁", label: "Fin du match" },
};

export default function BasketballMatchTimeline({ events, timelineNote }) {
  if (!events || events.length === 0) {
    return (
      <p style={st.hint} data-testid="basket-timeline-empty">
        En attente du coup d'envoi.
      </p>
    );
  }

  const rows = [...events].reverse();

  return (
    <div data-testid="basket-match-timeline">
      {rows.map((e) => {
        const meta = EVENT_META[e.kind] || { icon: "•", label: e.kind || "Événement" };
        return (
          <div key={e.id} style={st.eventRow} data-testid="basket-timeline-event">
            <div style={st.eventLine}>
              <span style={st.eventIcon} role="img" aria-label={meta.label}>{meta.icon}</span>
              <span style={st.eventLabel}>{e.label}</span>
              {e.quarter && (
                <span style={st.eventClock}>{e.quarter}{e.clock ? ` · ${e.clock}` : ""}</span>
              )}
            </div>
          </div>
        );
      })}
      {timelineNote && <p style={st.noteText}>{timelineNote}</p>}
    </div>
  );
}

const st = {
  hint: { fontSize: 12.5, color: "var(--text-secondary)" },
  eventRow: { marginBottom: 8 },
  eventLine: {
    display: "flex", alignItems: "center", gap: 8, background: "var(--surface)",
    borderRadius: 8, padding: "8px 12px",
  },
  eventIcon: { fontSize: 14, flexShrink: 0 },
  eventLabel: { fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)", flex: 1 },
  eventClock: { fontSize: 10.5, fontWeight: 700, color: "var(--text-secondary)", flexShrink: 0 },
  noteText: { fontSize: 10, color: "var(--text-secondary)", fontStyle: "italic", margin: "10px 0 0", lineHeight: 1.4 },
};
