// Timeline des moments forts d'un match (buts, cartons, remplacements), alimentée par
// API-Football pour les matchs en direct (voir lib/apiFootball.js et pages/api/analyze.js
// — football-data.org, utilisé pour le reste du site, ne fournit pas ce fil). `events`
// reste un prop explicite (plutôt qu'un import direct de l'API) pour que ce composant
// affiche de vrais événements sans jamais rien inventer.
//
// Le message d'absence d'événement dépend du contexte (`isLive`) :
// - Match EN DIRECT (isLive=true) : jamais "indisponible", même si la source a échoué —
//   toujours "Coup d'envoi — en attente des premiers événements." (demande explicite :
//   un visiteur qui regarde un match en cours ne doit jamais lire un message qui sonne
//   comme une panne du site).
// - Match pas en direct (terminé, à venir, ou isLive omis) : distinction conservée entre
//   `null`/`undefined` (aucune source connectée pour ce match) et un tableau vide (source
//   connectée mais aucun événement) — deux messages différents, pour ne jamais faire
//   passer une vraie panne pour un simple "rien ne s'est encore passé".
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

export default function MatchTimeline({ events, homeTeamId, isLive }) {
  if (events == null || events.length === 0) {
    const message = isLive
      ? "Coup d'envoi — en attente des premiers événements."
      : events == null
      ? "Événements non disponibles pour ce match."
      : "Aucun événement pour l'instant.";
    return (
      <p style={st.hint} data-testid="timeline-empty">
        {message}
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
  hint: { fontSize: 12.5, color: "#5C7A6A" },
  separator: {
    textAlign: "center", fontSize: 10.5, fontWeight: 700, color: "#3F6151",
    textTransform: "uppercase", letterSpacing: 0.4, margin: "12px 0", position: "relative",
  },
  eventRow: { display: "flex", marginBottom: 8 },
  eventRowHome: { justifyContent: "flex-start" },
  eventRowAway: { justifyContent: "flex-end" },
  eventLine: {
    display: "flex", alignItems: "center", gap: 8, background: "#EEF5F0",
    borderRadius: 8, padding: "8px 12px", maxWidth: "85%",
  },
  eventMinute: { fontSize: 11.5, fontWeight: 700, color: "#5C7A6A", flexShrink: 0 },
  eventIcon: { fontSize: 14, flexShrink: 0 },
  eventPlayer: { fontSize: 12.5, fontWeight: 600, color: "#13291D" },
  eventScore: { fontSize: 12.5, fontWeight: 800, color: "#1A7F4F", flexShrink: 0 },
};
