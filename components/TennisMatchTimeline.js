// Bloc 8 (tennis) — "Moments forts" épinglé en haut de la page de match en direct
// (voir pages/match/[id].js) : dérivé du VRAI score par set/par jeu (lib/sports/
// tennis/timeline.js), JAMAIS "Événement non disponible" une fois le match commencé —
// au pire "En attente du début du match." avant que la première donnée n'arrive.
// `events` vient déjà dans l'ordre chronologique (le plus ancien en premier) : inversé
// ici pour afficher le plus récent en tête, comme components/BasketballMatchTimeline.js.
const EVENT_META = {
  START: { icon: "🎾", label: "Début du match" },
  BREAK: { icon: "🔨", label: "Break" },
  BREAK_POINT_SAVED: { icon: "🛡️", label: "Balle de break sauvée" },
  SET_WON: { icon: "🏆", label: "Set remporté" },
  TIEBREAK: { icon: "⏱️", label: "Jeu décisif" },
  RUN: { icon: "🔥", label: "Série" },
  FULL_TIME: { icon: "🏁", label: "Fin du match" },
};

export default function TennisMatchTimeline({ events, timelineNote }) {
  if (!events || events.length === 0) {
    return (
      <p style={st.hint} data-testid="tennis-timeline-empty">
        En attente du début du match.
      </p>
    );
  }

  const rows = [...events].reverse();

  return (
    <div data-testid="tennis-match-timeline">
      {rows.map((e) => {
        const meta = EVENT_META[e.kind] || { icon: "•", label: e.kind || "Événement" };
        return (
          <div key={e.id} style={st.eventRow} data-testid="tennis-timeline-event">
            <div style={st.eventLine}>
              <span style={st.eventIcon} role="img" aria-label={meta.label}>{meta.icon}</span>
              <span style={st.eventLabel}>{e.label}</span>
              {e.scoreAfter && (
                <span style={st.eventScore}>{e.scoreAfter.home}-{e.scoreAfter.away}</span>
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
  eventScore: { fontSize: 10.5, fontWeight: 700, color: "var(--text-secondary)", flexShrink: 0 },
  noteText: { fontSize: 10, color: "var(--text-secondary)", fontStyle: "italic", margin: "10px 0 0", lineHeight: 1.4 },
};
