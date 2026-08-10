import { useCallback, useEffect, useRef, useState } from "react";
import { loadUpcoming } from "../lib/upcomingMatches";
import UpcomingMatchCard from "./UpcomingMatchCard";

// Rafraîchissement automatique demandé : 5 minutes, sans rechargement de page. Un
// échec ne vide jamais une liste déjà affichée.
const REFRESH_MS = 5 * 60 * 1000;
const SKELETON_DAYS = 2;
const SKELETON_CARDS = 3;

// Nouvelle tentative automatique quand au moins une source a échoué : relance après
// 5 s, 3 tentatives maximum (bloc 2, point 3). Bornée volontairement — au-delà, on
// arrête de marteler la source et on affiche la cause plutôt que de laisser tourner un
// message d'attente indéfiniment.
const RETRY_MS = 5 * 1000;
const MAX_RETRIES = 3;

// La ligne de diagnostic technique n'est affichée que sur demande explicite
// (?debug=1) : elle reste disponible pour comprendre un écran vide, sans polluer
// l'affichage de tous les visiteurs.
function isDebug() {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("debug") === "1";
}

// Dernière liste RÉELLEMENT affichée, par sport, conservée dans le navigateur.
// Raison d'être : une panne de source ne doit jamais faire disparaître des matchs déjà
// obtenus. Tant qu'on a une liste connue, on la montre — datée et signalée — plutôt
// qu'un bandeau rouge. Une donnée un peu ancienne est toujours plus utile qu'un écran
// d'erreur. Rien n'est jamais inventé : ce sont de vrais matchs, déjà servis.
const CACHE_PREFIX = "blume:a-venir:";
const CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // au-delà, la liste n'est plus crédible

function lireCache(sport) {
  if (typeof window === "undefined") return null;
  try {
    const brut = window.localStorage.getItem(CACHE_PREFIX + sport);
    if (!brut) return null;
    const { days, at } = JSON.parse(brut);
    if (!Array.isArray(days) || !days.length) return null;
    if (Date.now() - at > CACHE_MAX_AGE_MS) return null;
    return { days, at };
  } catch {
    return null;
  }
}

function ecrireCache(sport, days) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_PREFIX + sport, JSON.stringify({ days, at: Date.now() }));
  } catch {
    // Stockage plein ou refusé : sans conséquence, le cache n'est qu'un confort.
  }
}

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
  // loading | loaded | empty | retrying | error
  const [phase, setPhase] = useState("loading");
  const [detail, setDetail] = useState(null);
  // Ce qui a réellement été interrogé (source, code HTTP, plage de dates) : affiché
  // sous un écran vide, pour qu'une section vide soit toujours explicable.
  const [diagnostic, setDiagnostic] = useState(null);
  const [debug, setDebug] = useState(false);
  // Horodatage de la liste quand elle vient du cache navigateur (source en panne).
  const [stale, setStale] = useState(null);
  const hasDataRef = useRef(false);
  const retriesRef = useRef(0);
  const retryTimerRef = useRef(null);

  const load = useCallback(async () => {
    const { days: nextDays, coverage, errors, allSourcesFailed, anySourceFailed, diagnostic } =
      await loadUpcoming(sport);

    // Une source en échec est TOUJOURS journalisée, même quand une autre a réussi :
    // aucune erreur ne disparaît en silence (BLOC 7).
    for (const s of diagnostic?.sources || []) {
      if (s.error) console.warn(`[À venir] ${sport} — ${s.name} : ${s.error}`);
    }
    if (errors.blume) console.warn(`[À venir] ${sport} — source Blume : ${errors.blume}`);

    // Comptage de couverture (BLOC 9) : ce qui est REÇU. Le rendu réel expose le sien
    // via data-* ci-dessous — les deux doivent coïncider.
    console.info(
      `[À venir] ${sport} : ${coverage.upcoming} match(s) à venir, ${coverage.competitions} compétition(s) distincte(s) ` +
        `— reçus ${coverage.fromBlume}, ${coverage.afterDedupe} après déduplication`
    );

    if (nextDays.length > 0) {
      setDays(nextDays);
      setPhase("loaded");
      setStale(null);
      hasDataRef.current = true;
      retriesRef.current = 0;
      ecrireCache(sport, nextDays);
      return;
    }
    // Ne jamais vider une liste déjà affichée sur un incident passager.
    if (hasDataRef.current) return;

    // Une source en panne, mais une liste connue en réserve : on montre les matchs.
    // Le bandeau d'erreur est réservé au cas où l'on n'a VRAIMENT rien à afficher.
    if (anySourceFailed) {
      const cache = lireCache(sport);
      if (cache) {
        setDays(cache.days);
        setStale(cache.at);
        setPhase("loaded");
        hasDataRef.current = true;
        return;
      }
    }

    setDiagnostic(diagnostic || null);
    const sourceDetail = (diagnostic?.sources || [])
      .map((s) => `${s.name} : ${s.error || `HTTP ${s.httpStatus ?? "?"}, ${s.received ?? 0} reçu(s)`}`)
      .join(" | ");

    // Une seule source en échec suffit à interdire le message "aucun match" : le vide
    // n'est constatable que si TOUTES les sources ont répondu correctement. Tant qu'on
    // a encore des tentatives, on le dit et on relance.
    if (anySourceFailed && retriesRef.current < MAX_RETRIES) {
      retriesRef.current += 1;
      setDetail(sourceDetail || errors.blume || null);
      setPhase("retrying");
      retryTimerRef.current = setTimeout(load, RETRY_MS);
      return;
    }

    if (anySourceFailed || allSourcesFailed) {
      // Message DISTINCT du "aucun match" : une panne technique ne doit pas être
      // maquillée en absence de matchs.
      setDetail(sourceDetail || errors.blume || null);
      setPhase("error");
      return;
    }

    // Vide constaté, jamais décidé : toutes les sources ont réellement répondu 0.
    setDetail(null);
    setPhase("empty");
  }, [sport]);

  useEffect(() => {
    setDebug(isDebug());
    setStale(null);
    setPhase("loading");
    hasDataRef.current = false;
    retriesRef.current = 0;
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      clearInterval(id);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [sport, load]);

  const matchCount = days.reduce((n, d) => n + d.competitions.reduce((k, c) => k + c.matches.length, 0), 0);
  const competitionCount = new Set(
    days.flatMap((d) => d.competitions.map((c) => c.competition))
  ).size;

  // Ligne technique : conservée intégralement, mais réservée à ?debug=1 (demandé).
  const diagnosticLine =
    debug && diagnostic ? (
      <p style={st.diagnostic} data-testid="upcoming-empty-diagnostic">
        {diagnostic.sources
          .map((s) => `${s.name} → ${s.error ? `échec (${s.error})` : `HTTP ${s.httpStatus ?? "?"}`}, ${s.received ?? 0} reçu(s)`)
          .join(" · ")}{" "}
        · plage {diagnostic.window.from} → {diagnostic.window.to}
      </p>
    ) : null;

  if (phase === "loading") return <Skeleton />;

  if (phase === "retrying") {
    // Situation à ne surtout PAS confondre avec "aucun match" : au moins une source
    // n'a pas répondu, donc le vide n'est pas constatable. On le dit, et on relance.
    return (
      <div data-testid="upcoming-retrying">
        <p style={st.retryTitle}>Problème de connexion à la source, nouvelle tentative en cours…</p>
        {debug && detail && (
          <p style={st.errorDetail} data-testid="upcoming-error-detail">Détail technique : {detail}</p>
        )}
        {diagnosticLine}
        <Skeleton />
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div data-testid="upcoming-error">
        <p style={st.errorTitle}>Problème de connexion à la source. Réessaie dans quelques minutes.</p>
        {debug && detail && (
          <p style={st.errorDetail} data-testid="upcoming-error-detail">Détail technique : {detail}</p>
        )}
        {diagnosticLine}
      </div>
    );
  }

  if (phase === "empty") {
    return (
      <div data-testid="upcoming-empty">
        <p style={st.hint}>Aucun match à venir pour ce sport dans les 7 prochains jours.</p>
        {diagnosticLine}
      </div>
    );
  }

  return (
    <div
      data-testid="match-list"
      data-sport={sport}
      data-match-count={matchCount}
      data-competition-count={competitionCount}
      data-stale={stale ? "1" : undefined}
    >
      {stale && (
        <p style={st.stale} data-testid="upcoming-stale">
          Source momentanément indisponible — matchs affichés tels que connus à{" "}
          {new Date(stale).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}.
        </p>
      )}
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
  stale: {
    fontSize: 11.5, color: "var(--text-secondary)", margin: "0 0 12px",
    padding: "8px 10px", borderRadius: 10, background: "var(--card-bg)", border: "1px solid var(--border)",
  },
  retryTitle: { fontSize: 13, color: "var(--text-secondary)", fontWeight: 700, margin: "0 0 12px" },
  // Ligne technique discrète sous un écran vide : source interrogée, code HTTP réel et
  // plage de dates testée — visible sans ouvrir la console.
  diagnostic: { fontSize: 10.5, color: "var(--text-secondary)", opacity: 0.75, margin: "6px 0 0", wordBreak: "break-word" },
  errorDetail: { fontSize: 10.5, color: "var(--text-secondary)", opacity: 0.85, margin: "6px 0 0", wordBreak: "break-word" },

  skelCard: {
    background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14,
    padding: 14, display: "flex", flexDirection: "column", gap: 10,
  },
  skelLine: { display: "block", height: 11, borderRadius: 6, width: "100%", background: "var(--border)", opacity: 0.55 },
};
