import { useCallback, useEffect, useRef, useState } from "react";
import { fetchMatchesWithFallback, readCachedMatches, writeCachedMatches } from "../lib/sportScore";

// Rechargement automatique toutes les 5 minutes (demandé) : retire les matchs terminés
// de la tête de liste et fait apparaître les nouveaux sans que le visiteur recharge la
// page. Aligné sur le cache edge de 60s de SportScore et très loin de la limite
// (~1000 req/24h/IP) : 3 sports × 12 requêtes/heure = 864/jour au pire.
const REFRESH_MS = 5 * 60 * 1000;

// Nombre de cartes du squelette affiché avant la première réponse — aligné sur le
// minimum de 6 matchs par section demandé.
const SKELETON_COUNT = 6;

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

// Un logo cassé (URL morte côté API) est masqué sans laisser de trou ni décaler la
// ligne : le conteneur, lui, garde sa place.
function hideBrokenImage(e) {
  e.target.style.visibility = "hidden";
}

function Side({ side, align }) {
  return (
    <div style={{ ...st.side, ...(align === "right" ? st.sideRight : null) }}>
      <span style={st.logoWrap}>
        {side.logo && <img src={side.logo} alt="" style={st.logo} onError={hideBrokenImage} loading="lazy" />}
      </span>
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

// Contenu par défaut visible IMMÉDIATEMENT, dès le premier rendu, avant même que
// l'API ait répondu : la section n'est donc jamais vide ni cassée. Ce sont des blocs
// de structure, jamais des matchs inventés — un site de suivi sportif ne doit pas
// afficher d'équipes ou d'horaires fictifs (voir CLAUDE.md).
function Skeleton() {
  return (
    <ul style={st.list} data-testid="sportscore-skeleton" aria-hidden="true">
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <li key={i} style={st.card}>
          <div style={st.cardTop}>
            <span style={{ ...st.skelLine, width: "38%" }} />
            <span style={{ ...st.skelLine, width: 54, height: 14 }} />
          </div>
          <div style={st.teams}>
            <span style={{ ...st.skelDot }} />
            <span style={{ ...st.skelLine, flex: 1 }} />
            <span style={{ ...st.skelLine, flex: 1 }} />
            <span style={{ ...st.skelDot }} />
          </div>
          <span style={{ ...st.skelLine, width: "30%" }} />
        </li>
      ))}
    </ul>
  );
}

// Section "matchs à venir" pour UN sport, alimentée directement depuis le navigateur
// par l'API publique SportScore (voir lib/sportScore.js) — aucun backend, aucune clé.
// Affiche TOUS les matchs renvoyés (amicaux et petites compétitions compris), les
// grandes compétitions remontant en tête et les matchs terminés relégués en fin de
// liste (tri dans lib/sportScore.js). Aucun bouton, aucun lien de paiement.
export default function SportScoreSection({ sport, title, subtitle, testId }) {
  const [matches, setMatches] = useState([]);
  // "loading" tant qu'aucune donnée réelle n'est affichable : c'est le seul état où le
  // squelette est montré. Dès qu'une liste (fraîche OU issue du cache local) existe,
  // elle reste affichée quoi qu'il arrive ensuite.
  const [phase, setPhase] = useState("loading"); // loading | loaded | unavailable
  // Provenance réelle des matchs affichés ("sportscore" ou "blume") et cause technique
  // exacte en cas d'échec — ni l'une ni l'autre ne doit être masquée par un message
  // générique (demande explicite).
  const [source, setSource] = useState(null);
  const [detail, setDetail] = useState(null);
  const hasDataRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const { matches: list, source, error } = await fetchMatchesWithFallback(sport);
      // SportScore a échoué mais le repli a fonctionné : l'incident reste tracé en
      // console (jamais avalé silencieusement) même si le visiteur, lui, voit ses matchs.
      if (error) console.warn(`[SportScore] ${sport} : bascule sur les sources Blume — ${error}`);

      if (list.length > 0) {
        setMatches(list);
        setSource(source);
        setPhase("loaded");
        hasDataRef.current = true;
        writeCachedMatches(sport, list);
        return;
      }
      // Réponse valide mais vide : on ne vide JAMAIS une section qui affiche déjà des
      // matchs — on garde l'affichage précédent (demande explicite).
      if (!hasDataRef.current) {
        setDetail("Aucun match renvoyé par les sources pour le moment.");
        setPhase("unavailable");
      }
    } catch (e) {
      // console.warn (et non console.error) : une panne réseau d'une source externe est
      // un incident attendu et géré, pas un bug du site — la console reste propre.
      console.warn(`[SportScore] ${sport} : toutes les sources ont échoué —`, e?.message || e);
      if (!hasDataRef.current) {
        // Le message générique ne doit plus MASQUER la cause technique : on affiche la
        // vraie erreur, courte, sous le message lisible.
        setDetail(e?.message || String(e));
        setPhase("unavailable");
      }
    }
  }, [sport]);

  useEffect(() => {
    // Lecture du cache dans un effet (jamais pendant le rendu) : le serveur n'a pas
    // accès à localStorage, et un état initial différent entre serveur et navigateur
    // provoquerait une erreur d'hydratation dans la console.
    const cached = readCachedMatches(sport);
    if (cached) {
      setMatches(cached);
      setPhase("loaded");
      hasDataRef.current = true;
    }
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [sport, load]);

  return (
    <section style={st.section} data-testid={testId}>
      <div style={st.header}>
        <h2 style={st.title}>{title}</h2>
        {subtitle && <p style={st.subtitle}>{subtitle}</p>}
      </div>

      {phase === "loading" && <Skeleton />}

      {/* Aucune donnée réelle n'a JAMAIS pu être obtenue (première visite + API
          injoignable) : message court et lisible, jamais une erreur technique brute,
          jamais une section vide. */}
      {phase === "unavailable" && (
        <div data-testid={`${testId}-fallback`}>
          <p style={st.hint}>
            Aucune source de matchs n'a pu être jointe (SportScore et sources Blume). La liste se met à
            jour automatiquement.
          </p>
          {detail && <p style={st.errorDetail} data-testid={`${testId}-error-detail`}>Détail technique : {detail}</p>}
        </div>
      )}

      {phase === "loaded" && source === "blume" && (
        <p style={st.sourceNote} data-testid={`${testId}-source-blume`}>
          SportScore étant indisponible, ces matchs proviennent des sources habituelles de Blume.
        </p>
      )}

      {phase === "loaded" && (
        <ul style={st.list} data-testid={`${testId}-list`}>
          {matches.map((m) => (
            <MatchRow key={m.id} m={m} />
          ))}
        </ul>
      )}

      {/* Attribution obligatoire de l'offre gratuite SportScore — lien dofollow
          (aucun rel="nofollow"), visible sous chaque section en toutes circonstances. */}
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

  // Blocs neutres du squelette : même teinte que les bordures du site, jamais un texte
  // ou un chiffre qui pourrait passer pour une vraie donnée.
  skelLine: { display: "block", height: 11, borderRadius: 6, background: "var(--border)", opacity: 0.55 },
  skelDot: { display: "block", width: 28, height: 28, borderRadius: "50%", background: "var(--border)", opacity: 0.55, flexShrink: 0 },

  // Cause technique réelle, affichée sous le message lisible : discrète mais jamais
  // cachée, pour qu'une panne soit diagnosticable sans ouvrir la console.
  errorDetail: { fontSize: 10.5, color: "var(--text-secondary)", opacity: 0.8, margin: "4px 0 0", wordBreak: "break-word" },
  sourceNote: { fontSize: 11, color: "var(--text-secondary)", fontStyle: "italic", margin: 0 },
  attribution: { fontSize: 11, color: "var(--text-secondary)", margin: "2px 0 0" },
  attributionLink: { color: "var(--accent)", textDecoration: "underline" },
};
