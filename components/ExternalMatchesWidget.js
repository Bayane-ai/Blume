import { useCallback, useEffect, useState } from "react";
import MatchCard from "./MatchCard";
import { getLeagueMatches } from "../lib/espnSoccer";

// Demandé explicitement (deux prompts) : rechargement automatique toutes les 5 minutes,
// pour retirer les matchs terminés et faire apparaître les nouveaux.
const REFRESH_MS = 5 * 60 * 1000;

function rankStatus(status) {
  if (status === "IN_PLAY" || status === "PAUSED" || status === "EXTRA_TIME" || status === "PENALTY_SHOOTOUT") return 0;
  if (status === "SCHEDULED") return 1;
  return 2; // FINISHED
}

// Squelette visible IMMÉDIATEMENT au premier rendu (avant même la première réponse
// réseau) : "affichage de secours" demandé par le prompt, jamais un match inventé pour
// autant — juste des blocs vides, remplacés dès que les vraies données arrivent.
function SkeletonCard({ i }) {
  return (
    <div style={st.skeletonCard} aria-hidden="true" key={i}>
      <div style={st.skeletonLine} />
      <div style={{ ...st.skeletonLine, width: "60%" }} />
    </div>
  );
}

// Widget générique, sans backend (aucune route /api de Blume impliquée) : appelle
// directement l'API ESPN depuis le navigateur de chaque visiteur (voir lib/
// espnSoccer.js). Utilisé pour les deux sections demandées : compétitions spécifiques
// (LDC/Europa/Conference + championnats russe/suédois/slovaque/letton) et "tous les
// clubs" (grandes compétitions en premier).
export default function ExternalMatchesWidget({ title, subtitle, leagues, minMatches = 0, testId }) {
  const [phase, setPhase] = useState("loading"); // loading | loaded | error
  const [matches, setMatches] = useState([]);

  const load = useCallback(
    (silent = false) => {
      if (!silent) setPhase("loading");
      return Promise.allSettled(leagues.map((l) => getLeagueMatches(l.slug, l.label)))
        .then((results) => {
          const ok = results.filter((r) => r.status === "fulfilled");
          if (ok.length === 0) {
            // Aucune des ligues n'a répondu : jamais de match inventé pour compléter —
            // message honnête, comme partout ailleurs sur Blume quand une source réelle
            // échoue (voir pages/index.js pour le même principe côté football/basket/tennis).
            if (!silent) setPhase("error");
            return;
          }
          const merged = ok.flatMap((r) => r.value).filter((m) => m?.homeTeam && m?.awayTeam && m?.utcDate);
          merged.sort((a, b) => rankStatus(a.status) - rankStatus(b.status) || new Date(a.utcDate) - new Date(b.utcDate));
          setMatches(merged);
          setPhase("loaded");
        })
        .catch(() => {
          if (!silent) setPhase("error");
        });
    },
    [leagues]
  );

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <section style={st.section} data-testid={testId}>
      <div style={st.header}>
        <h2 style={st.title}>{title}</h2>
        {subtitle && <p style={st.subtitle}>{subtitle}</p>}
      </div>

      {phase === "loading" && (
        <div data-testid={`${testId}-skeleton`}>
          {[0, 1, 2].map((i) => (
            <SkeletonCard i={i} key={i} />
          ))}
        </div>
      )}

      {phase === "error" && (
        <p style={st.hint}>Impossible de charger les matchs pour le moment. Nouvelle tentative automatique dans quelques minutes.</p>
      )}

      {phase === "loaded" && matches.length === 0 && (
        <p style={st.hint}>Aucun match trouvé actuellement pour ces compétitions.</p>
      )}

      {phase === "loaded" && matches.length > 0 && (
        <>
          {minMatches > 0 && matches.length < minMatches && (
            <p style={st.staleNote}>
              Seulement {matches.length} match{matches.length > 1 ? "s" : ""} disponible{matches.length > 1 ? "s" : ""} pour le moment sur ces
              compétitions.
            </p>
          )}
          <div data-testid={`${testId}-list`}>
            {matches.map((m) => (
              <MatchCard key={m.id} m={m} comp={m.competition} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

const st = {
  section: { display: "flex", flexDirection: "column", gap: 12 },
  header: { display: "flex", flexDirection: "column", gap: 4 },
  title: { fontSize: 16, fontWeight: 800, margin: 0 },
  subtitle: { fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 },
  hint: { fontSize: 12.5, color: "var(--text-secondary)" },
  staleNote: { fontSize: 11.5, color: "var(--text-secondary)", fontStyle: "italic", margin: 0 },
  skeletonCard: {
    background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14,
    padding: 14, marginBottom: 10, display: "flex", flexDirection: "column", gap: 10,
  },
  skeletonLine: {
    height: 12, borderRadius: 6, width: "100%",
    background: "linear-gradient(90deg, var(--border) 0%, var(--card-bg) 50%, var(--border) 100%)",
  },
};
