// Timeline des moments forts d'un match (buts, cartons, remplacements). L'API
// football-data.org (plan utilisé par Blume) fournit le score et l'état du match,
// mais PAS un fil d'événements minute par minute — voir pages/api/analyze.js, qui
// transmet toujours `events: null` pour cette raison. `events` reste donc un prop
// explicite (plutôt qu'un import direct de l'API) pour que ce composant affiche de
// vrais événements sans rien inventer le jour où une source de données les fournira,
// et affiche en attendant un message honnête plutôt qu'une section vide ou une erreur.
const EVENT_META = {
  GOAL: { icon: "⚽", label: "But" },
  YELLOW_CARD: { icon: "🟨", label: "Carton jaune" },
  RED_CARD: { icon: "🟥", label: "Carton rouge" },
  SUBSTITUTION: { icon: "🔁", label: "Remplacement" },
};

// Le plus récent en premier, avec "Coup d'envoi" tout en bas (début du match) et
// "Mi-temps" entre les événements de la 2e et de la 1re mi-temps.
function buildTimelineRows(events) {
  const sorted = [...events].sort((a, b) => a.minute - b.minute);
  const rows = [{ kind: "separator", key: "sep-kickoff", label: "Coup d'envoi" }];
  let halfInserted = false;
  sorted.forEach((e, i) => {
    if (!halfInserted && e.minute > 45) {
      rows.push({ kind: "separator", key: "sep-half", label: "Mi-temps" });
      halfInserted = true;
    }
    rows.push({ kind: "event", key: e.id ?? `evt-${i}`, event: e });
  });
  return rows.slice().reverse();
}

export default function MatchTimeline({ events, homeTeamId }) {
  if (!events || events.length === 0) {
    return (
      <p style={st.hint} data-testid="timeline-empty">
        Événements non disponibles pour ce match.
      </p>
    );
  }

  const rows = buildTimelineRows(events);

  return (
    <div data-testid="match-timeline">
      {rows.map((row) => {
        if (row.kind === "separator") {
          return (
            <div key={row.key} style={st.separator} data-testid="timeline-separator">
              {row.label}
            </div>
          );
        }

        const e = row.event;
        const meta = EVENT_META[e.type] || { icon: "•", label: e.type || "Événement" };
        const isHome = String(e.teamId) === String(homeTeamId);

        return (
          <div
            key={row.key}
            style={{ ...st.eventRow, ...(isHome ? st.eventRowHome : st.eventRowAway) }}
            data-testid="timeline-event"
          >
            <div style={st.eventLine}>
              <span style={st.eventMinute}>{e.minute}’</span>
              <span style={st.eventIcon} role="img" aria-label={meta.label}>{meta.icon}</span>
              <span style={st.eventPlayer}>
                {e.type === "SUBSTITUTION"
                  ? `${e.playerIn?.name || "?"} ↔ ${e.playerOut?.name || "?"}`
                  : e.player?.name || "?"}
              </span>
              {e.type === "GOAL" && e.scoreAfter && (
                <span style={st.eventScore}>{e.scoreAfter.home} - {e.scoreAfter.away}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const st = {
  hint: { fontSize: 12.5, color: "#7EA694" },
  separator: {
    textAlign: "center", fontSize: 10.5, fontWeight: 700, color: "#5C8A73",
    textTransform: "uppercase", letterSpacing: 0.4, margin: "12px 0", position: "relative",
  },
  eventRow: { display: "flex", marginBottom: 8 },
  eventRowHome: { justifyContent: "flex-start" },
  eventRowAway: { justifyContent: "flex-end" },
  eventLine: {
    display: "flex", alignItems: "center", gap: 8, background: "#0B1F16",
    borderRadius: 8, padding: "8px 12px", maxWidth: "85%",
  },
  eventMinute: { fontSize: 11.5, fontWeight: 700, color: "#7EA694", flexShrink: 0 },
  eventIcon: { fontSize: 14, flexShrink: 0 },
  eventPlayer: { fontSize: 12.5, fontWeight: 600, color: "#E9F1EC" },
  eventScore: { fontSize: 12.5, fontWeight: 800, color: "#39B577", flexShrink: 0 },
};
