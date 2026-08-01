import { formatLiveClock } from "../lib/liveClockFormat";

const LIVE_STATUSES = ["IN_PLAY", "PAUSED"];

function formatKickoff(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function hideCrest(e) {
  e.target.parentElement.style.display = "none";
}

// Score set par set (PROMPT bloc 6, point 1 : "score par set en cours") — n'existe
// que pour le tennis (voir lib/sports/tennis/mapper.js#mapSets) ; ne s'affiche donc
// jamais pour le football/basket, dont `m.sets` est toujours absent.
function formatSetsLine(sets) {
  if (!Array.isArray(sets) || sets.length === 0) return "";
  return sets.map((s) => `${s.home ?? "–"}-${s.away ?? "–"}`).join("  ");
}

// Bloc d'affichage d'un match (bandeau compétition + équipes + score),
// partagé entre la liste des matchs et la page dédiée d'un match, pour
// que les deux pages montrent exactement le même bloc.
export default function MatchInfoBlock({ m, comp }) {
  if (!m || !m.homeTeam || !m.awayTeam) return null;

  const isLive = LIVE_STATUSES.includes(m.status);
  const isPaused = m.status === "PAUSED";
  const isFinished = m.status === "FINISHED";
  const competitionName = m.competition?.name || comp?.name || "Compétition";
  const competitionEmblem = m.competition?.emblem || "";
  // Tennis uniquement (voir lib/sports/tennis/mapper.js) : surface et tour n'existent
  // pour aucun autre sport de ce site — leur présence sert de détection, sans avoir
  // besoin de vérifier le préfixe "tn-" de l'id.
  const surface = m.competition?.surface || comp?.surface || "";
  const round = m.round || "";
  const setsLine = formatSetsLine(m.sets);

  const scoreHome = m.score?.fullTime?.home;
  const scoreAway = m.score?.fullTime?.away;
  const hasScore =
    scoreHome !== null && scoreHome !== undefined && scoreAway !== null && scoreAway !== undefined;
  // Football : "34’" (minute écoulée, comme avant). Basket : "Q3 · 5:23" (quart-temps
  // + chrono officiel, voir lib/liveClockFormat.js et PROMPT bloc 2) — même champ `m`,
  // seul le sport d'origine change la forme du texte.
  const liveClock = formatLiveClock(m);
  const homeServing = isLive && m.server === "home";
  const awayServing = isLive && m.server === "away";

  return (
    <div>
      <div style={st.compBanner}>
        <div style={st.compLeft}>
          {competitionEmblem && (
            <img src={competitionEmblem} alt={competitionName} style={st.compEmblem} onError={(e) => (e.target.style.display = "none")} />
          )}
          <span style={st.compName}>{competitionName}</span>
        </div>
        {isLive && <span style={st.liveTag}>LIVE{liveClock ? ` · ${liveClock}` : ""}</span>}
        {isFinished && <span style={st.finishedTag}>Terminé</span>}
      </div>

      {(surface || round) && (
        <div style={st.tennisMeta} data-testid="tennis-meta">
          {surface && <span style={st.tennisMetaTag}>{surface}</span>}
          {round && <span style={st.tennisMetaTag}>{round}</span>}
        </div>
      )}

      <div style={st.teamRow}>
        <div style={st.teamBlock}>
          {m.homeTeam.flag && <img src={m.homeTeam.flag} alt="" style={st.flag} onError={(e) => (e.target.style.display = "none")} />}
          {m.homeTeam.crest && (
            <span style={st.crestWrap}>
              <img src={m.homeTeam.crest} alt="" style={st.crest} onError={hideCrest} />
            </span>
          )}
          <span style={st.teamName}>{m.homeTeam.name}</span>
          {homeServing && <span style={st.serveDot} data-testid="serving-indicator" aria-label="Au service" title="Au service" />}
        </div>
        <div style={{ ...st.teamBlock, ...st.teamBlockAway }}>
          {awayServing && <span style={st.serveDot} data-testid="serving-indicator" aria-label="Au service" title="Au service" />}
          <span style={{ ...st.teamName, ...st.teamNameAway }}>{m.awayTeam.name}</span>
          {m.awayTeam.crest && (
            <span style={st.crestWrap}>
              <img src={m.awayTeam.crest} alt="" style={st.crest} onError={hideCrest} />
            </span>
          )}
          {m.awayTeam.flag && <img src={m.awayTeam.flag} alt="" style={st.flag} onError={(e) => (e.target.style.display = "none")} />}
        </div>
      </div>

      <div style={st.centerRow}>
        <span style={st.centerSlot} data-testid="card-score">
          {hasScore ? `${scoreHome ?? "–"} - ${scoreAway ?? "–"}` : formatKickoff(m.utcDate)}
        </span>
        {isLive && (
          <span style={st.cardMinute} data-testid="card-minute">
            {isPaused ? (m.period ? "Pause" : "MT") : liveClock}
          </span>
        )}
      </div>

      {isLive && setsLine && (
        <div style={st.setsLine} data-testid="sets-line">{setsLine}</div>
      )}
    </div>
  );
}

const st = {
  compBanner: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  compLeft: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  compEmblem: { width: 18, height: 18, objectFit: "contain", flexShrink: 0 },
  compName: {
    fontSize: 11, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.3,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  liveTag: { fontSize: 11, color: "var(--negative)", fontWeight: 800, flexShrink: 0, letterSpacing: 0.3 },
  finishedTag: { fontSize: 11, color: "var(--text-secondary)", fontWeight: 600, flexShrink: 0 },
  // Tennis uniquement (surface + tour) : petites étiquettes discrètes juste sous le
  // bandeau de compétition, même famille visuelle que compName (même taille/couleur)
  // pour rester cohérent avec le style existant plutôt que d'introduire un nouveau ton.
  tennisMeta: { display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" },
  tennisMetaTag: {
    fontSize: 10.5, color: "var(--text-secondary)", background: "var(--card-bg-alt, rgba(255,255,255,0.06))",
    border: "1px solid var(--border)", borderRadius: 6, padding: "2px 7px", fontWeight: 600,
  },
  teamRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, fontSize: 14 },
  teamBlock: { flex: 1, display: "flex", alignItems: "center", gap: 10, minWidth: 0 },
  teamBlockAway: { justifyContent: "flex-end" },
  flag: { width: 16, height: 12, objectFit: "cover", borderRadius: 2, flexShrink: 0 },
  // Point vert (même couleur que l'accent du site) à côté du nom du joueur au
  // service — discret, jamais un élément qui déborde ou déséquilibre la ligne.
  serveDot: {
    width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", flexShrink: 0,
    boxShadow: "0 0 6px rgba(var(--accent-rgb),0.7)",
  },
  crestWrap: {
    width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "radial-gradient(circle, rgba(var(--accent-rgb),0.25) 0%, rgba(57,181,119,0) 70%)",
    boxShadow: "0 0 12px rgba(var(--accent-rgb),0.35)",
  },
  crest: { width: 30, height: 30, objectFit: "contain", filter: "drop-shadow(0 1px 3px rgba(0,0,0,0.4))" },
  teamName: {
    fontWeight: 600, overflowWrap: "break-word", display: "-webkit-box",
    WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
  },
  teamNameAway: { textAlign: "right" },
  centerRow: { display: "flex", alignItems: "baseline", justifyContent: "center", gap: 8, marginTop: 10 },
  centerSlot: { fontWeight: 800, color: "var(--accent)", fontSize: 20, textAlign: "center" },
  cardMinute: { fontWeight: 800, color: "var(--negative)", fontSize: 12.5, letterSpacing: 0.3 },
  // Tennis uniquement : détail set par set, sous le score principal (sets gagnés) —
  // texte discret, même famille que compName, jamais plus voyant que le score lui-même.
  setsLine: {
    fontSize: 11.5, color: "var(--text-secondary)", textAlign: "center", marginTop: 6, letterSpacing: 0.3,
  },
};
