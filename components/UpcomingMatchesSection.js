import { useCallback, useEffect, useRef, useState } from "react";
import { loadUpcoming } from "../lib/upcomingMatches";
import UpcomingMatchCard from "./UpcomingMatchCard";

// Rafraîchissement automatique demandé : 5 minutes, sans rechargement de page. Un
// échec ne vide jamais une liste déjà affichée.
const REFRESH_MS = 5 * 60 * 1000;
const SKELETON_DAYS = 2;
const SKELETON_CARDS = 3;

// Squelettes de cartes pendant la récupération (BLOC 7) : structure seule, jamais des
// matchs inventés — un site de suivi sportif ne doit pas afficher d'équipes ou
// d'horaires fictifs (voir CLAUDE.md).
function Skeleton() {
  return (
    <div data-testid="upcoming-skeleton" aria-hidden="true">
      {Array.from({ length: SKELETON_DAYS }, (_, d) => (
        <div key={d} style={st.day}>
          <span style={{ ...st.skelLine, width: 140, height: 14 }} />
          <ul style={st.cards}>
            {Array.from({ length: SKELETON_CARDS }, (_, i) => (
              <li key={i} style={st.skelCard}>
                <span style={{ ...st.skelLine, width: 54 }} />
                <span style={{ ...st.skelLine, width: "80%" }} />
                <span style={{ ...st.skelLine, width: "40%" }} />
                <span style={{ ...st.skelLine, height: 38, borderRadius: 10 }} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Liste "Matchs à venir" d'UN sport : jour -> compétition -> matchs (voir
// lib/upcomingMatches.js). Un seul sport est affiché à la fois, jamais mélangé avec
// un autre.
export default function UpcomingMatchesSection({ sport }) {
  const [days, setDays] = useState([]);
  const [phase, setPhase] = useState("loading"); // loading | loaded | empty | error
  const [detail, setDetail] = useState(null);
  const hasDataRef = useRef(false);

  const load = useCallback(async () => {
    const { days: nextDays, coverage, errors, allSourcesFailed, unsupported } = await loadUpcoming(sport);

    // Une source en échec est TOUJOURS journalisée, même quand l'autre a réussi :
    // aucune erreur ne disparaît en silence (BLOC 7).
    if (errors.sportScore) console.warn(`[À venir] ${sport} — SportScore : ${errors.sportScore}`);
    if (errors.blume) console.warn(`[À venir] ${sport} — source Blume : ${errors.blume}`);

    // Comptage de couverture (BLOC 9) : ce qui est REÇU. Le rendu réel expose le sien
    // via data-* ci-dessous — les deux doivent coïncider.
    console.info(
      `[À venir] ${sport} : ${coverage.upcoming} match(s) à venir, ${coverage.competitions} compétition(s) distincte(s) ` +
        `— SportScore ${coverage.fromSportScore}, Blume ${coverage.fromBlume}, ${coverage.afterDedupe} après déduplication` +
        (coverage.pagesRead ? `, ${coverage.pagesRead} page(s) lue(s)` : "")
    );

    if (nextDays.length > 0) {
      setDays(nextDays);
      setPhase("loaded");
      hasDataRef.current = true;
      return;
    }
    // Ne jamais vider une liste déjà affichée sur un incident passager.
    if (hasDataRef.current) return;

    if (allSourcesFailed) {
      // Message DISTINCT du "aucun match" : une panne technique ne doit pas être
      // maquillée en absence de matchs (BLOC 7).
      setDetail(`SportScore : ${errors.sportScore} | Source Blume : ${errors.blume}`);
      setPhase("error");
    } else {
      setDetail(typeof unsupported === "string" ? unsupported : null);
      setPhase("empty");
    }
  }, [sport]);

  useEffect(() => {
    setPhase("loading");
    hasDataRef.current = false;
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [sport, load]);

  const matchCount = days.reduce((n, d) => n + d.competitions.reduce((k, c) => k + c.matches.length, 0), 0);
  const competitionCount = new Set(
    days.flatMap((d) => d.competitions.map((c) => c.competition))
  ).size;

  if (phase === "loading") return <Skeleton />;

  if (phase === "error") {
    return (
      <div data-testid="upcoming-error">
        <p style={st.errorTitle}>Impossible de récupérer les matchs : toutes les sources ont échoué.</p>
        {detail && <p style={st.errorDetail} data-testid="upcoming-error-detail">Détail technique : {detail}</p>}
      </div>
    );
  }

  if (phase === "empty") {
    return (
      <p style={st.hint} data-testid="upcoming-empty">
        {detail || "Aucun match à venir pour ce sport dans les 7 prochains jours."}
      </p>
    );
  }

  return (
    <div
      data-testid="match-list"
      data-sport={sport}
      data-match-count={matchCount}
      data-competition-count={competitionCount}
    >
      {days.map((day) => (
        <section key={day.key} style={st.day} data-testid="day-section">
          <h2 style={st.dayLabel}>{day.label}</h2>

          {day.competitions.map((group) => (
            <div key={group.competition} style={st.compGroup} data-testid="upcoming-competition">
              <h3 style={st.compTitle}>
                {group.competition}
                {group.area && <span style={st.area}> · {group.area}</span>}
              </h3>
              <ul style={st.cards}>
                {group.matches.map((m) => (
                  <UpcomingMatchCard key={m.id || `${m.home.name}-${m.startTime}`} m={m} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

const st = {
  day: { display: "flex", flexDirection: "column", gap: 12, marginBottom: 26 },
  // En-tête de jour bien visible, avec la brillance verte des éléments actifs du site.
  dayLabel: {
    fontSize: 16, fontWeight: 800, margin: 0, color: "var(--accent)",
    textShadow: "0 0 12px rgba(var(--accent-rgb),0.35)", textTransform: "capitalize",
  },
  compGroup: { display: "flex", flexDirection: "column", gap: 8 },
  compTitle: {
    fontSize: 12, fontWeight: 800, margin: 0, color: "var(--text-secondary)",
    textTransform: "uppercase", letterSpacing: 0.4,
  },
  area: { fontWeight: 600, opacity: 0.8, textTransform: "none", letterSpacing: 0 },
  cards: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 },

  hint: { fontSize: 12.5, color: "var(--text-secondary)" },
  errorTitle: { fontSize: 13, color: "var(--negative)", fontWeight: 700, margin: 0 },
  errorDetail: { fontSize: 10.5, color: "var(--text-secondary)", opacity: 0.85, margin: "6px 0 0", wordBreak: "break-word" },

  skelCard: {
    background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14,
    padding: 14, display: "flex", flexDirection: "column", gap: 10,
  },
  skelLine: { display: "block", height: 11, borderRadius: 6, width: "100%", background: "var(--border)", opacity: 0.55 },
};
