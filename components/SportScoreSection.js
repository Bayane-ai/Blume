import { useCallback, useEffect, useState } from "react";
import { fetchSportScoreMatches } from "../lib/sportScore";

// Rechargement automatique toutes les 5 minutes (demandé) : retire les matchs terminés
// et fait apparaître les nouveaux sans que le visiteur recharge la page. Aligné sur le
// cache edge de 60s de SportScore et très loin de la limite (~1000 req/24h/IP) : 2
// sports × 12 requêtes/heure = 288/jour par visiteur au pire.
const REFRESH_MS = 5 * 60 * 1000;

const STATUS_LABELS = {
  upcoming: { text: "À venir", key: "upcoming" },
  live: { text: "En direct", key: "live" },
  finished: { text: "Terminé", key: "finished" },
};

function formatKickoff(iso) {
  if (!iso) return "Horaire non communiqué";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Horaire non communiqué";
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function hideBrokenImage(e) {
  e.target.style.display = "none";
}

function Side({ side, align }) {
  return (
    <div style={{ ...st.side, ...(align === "right" ? st.sideRight : null) }}>
      {side.logo && (
        <span style={st.logoWrap}>
          <img src={side.logo} alt="" style={st.logo} onError={hideBrokenImage} loading="lazy" />
        </span>
      )}
      <span style={{ ...st.sideName, ...(align === "right" ? st.sideNameRight : null) }}>{side.name}</span>
    </div>
  );
}

function MatchRow({ m }) {
  const status = STATUS_LABELS[m.status] || STATUS_LABELS.upcoming;
  return (
    <li style={st.card} data-testid="sportscore-match">
      <div style={st.cardTop}>
        <span style={st.competition}>{m.competition || "Compétition non communiquée"}</span>
        <span
          style={{
            ...st.badge,
            ...(status.key === "live" ? st.badgeLive : null),
            ...(status.key === "finished" ? st.badgeFinished : null),
          }}
          data-testid={`sportscore-status-${status.key}`}
        >
          {status.text}
        </span>
      </div>

      <div style={st.teams}>
        <Side side={m.home} />
        <span style={st.versus}>—</span>
        <Side side={m.away} align="right" />
      </div>

      <div style={st.kickoff}>{formatKickoff(m.startTime)}</div>
    </li>
  );
}

// Section "matchs du jour" pour UN sport, alimentée directement depuis le navigateur
// par l'API publique SportScore (voir lib/sportScore.js) — aucun backend, aucune clé.
// Affiche TOUS les matchs renvoyés (amicaux et petites compétitions compris), les
// grandes compétitions remontant en tête (tri dans lib/sportScore.js). Aucun bouton,
// aucun lien de paiement : purement informatif.
export default function SportScoreSection({ sport, title, subtitle, testId }) {
  const [matches, setMatches] = useState([]);
  const [phase, setPhase] = useState("loading"); // loading | loaded | error

  const load = useCallback(
    (silent = false) => {
      if (!silent) setPhase("loading");
      return fetchSportScoreMatches(sport)
        .then((list) => {
          setMatches(list);
          setPhase("loaded");
        })
        .catch((e) => {
          console.error(`Erreur SportScore (${sport}) :`, e);
          // Un incident passager ne doit jamais effacer des matchs déjà affichés :
          // on garde l'écran en l'état et on réessaie au prochain cycle.
          if (!silent) setPhase("error");
        });
    },
    [sport]
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

      {phase === "loading" && <p style={st.hint}>Chargement des matchs…</p>}

      {/* Affichage de secours : un message clair, jamais des matchs d'exemple inventés
          (le site n'affiche que des données réelles — voir CLAUDE.md et le reste des
          pages). La section reste donc toujours lisible, jamais vide ni cassée. */}
      {phase === "error" && (
        <p style={st.hint} data-testid={`${testId}-fallback`}>
          Les matchs ne sont pas disponibles pour le moment. La liste se recharge automatiquement dans quelques minutes.
        </p>
      )}

      {phase === "loaded" && matches.length === 0 && (
        <p style={st.hint} data-testid={`${testId}-empty`}>Aucun match à afficher pour le moment.</p>
      )}

      {phase === "loaded" && matches.length > 0 && (
        <ul style={st.list} data-testid={`${testId}-list`}>
          {matches.map((m) => (
            <MatchRow key={m.id} m={m} />
          ))}
        </ul>
      )}

      {/* Attribution obligatoire de l'offre gratuite SportScore — lien dofollow
          (aucun rel="nofollow"), visible sous chaque section. */}
      <p style={st.attribution}>
        Powered by{" "}
        <a href="https://sportscore.com/" style={st.attributionLink} target="_blank" rel="noopener">
          SportScore
        </a>
      </p>
    </section>
  );
}

const st = {
  section: { display: "flex", flexDirection: "column", gap: 12 },
  header: { display: "flex", flexDirection: "column", gap: 4 },
  title: { fontSize: 16, fontWeight: 800, margin: 0 },
  subtitle: { fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 },
  hint: { fontSize: 12.5, color: "var(--text-secondary)", margin: 0 },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 },

  // Même famille visuelle que components/MatchCard.js (fond, bordure, rayon, marge
  // intérieure) pour que ces sections s'intègrent naturellement au reste du site.
  card: {
    background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14,
    padding: 14, display: "flex", flexDirection: "column", gap: 10,
  },
  cardTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  competition: {
    fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.3,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
  },
  badge: {
    fontSize: 10.5, fontWeight: 800, letterSpacing: 0.3, flexShrink: 0, borderRadius: 999,
    padding: "3px 9px", color: "var(--text-secondary)", border: "1px solid var(--border)",
  },
  badgeLive: { color: "var(--negative)", borderColor: "var(--negative)" },
  badgeFinished: { opacity: 0.75 },

  // Responsive sans media query (impossible en style inline) : les trois colonnes
  // partagent l'espace via flex + minWidth:0, donc les noms longs se coupent proprement
  // au lieu de déborder — même approche que components/MatchInfoBlock.js, déjà validée
  // sur mobile.
  teams: { display: "flex", alignItems: "center", gap: 8, fontSize: 14 },
  side: { flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  sideRight: { justifyContent: "flex-end" },
  logoWrap: {
    width: 28, height: 28, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
  },
  logo: { maxWidth: 28, maxHeight: 28, objectFit: "contain" },
  sideName: {
    fontWeight: 600, minWidth: 0, overflowWrap: "break-word",
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
  },
  sideNameRight: { textAlign: "right" },
  versus: { flexShrink: 0, color: "var(--text-secondary)", fontSize: 12 },

  kickoff: { fontSize: 12, color: "var(--text-secondary)" },

  attribution: { fontSize: 11, color: "var(--text-secondary)", margin: "2px 0 0" },
  attributionLink: { color: "var(--accent)", textDecoration: "underline" },
};
