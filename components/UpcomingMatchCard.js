import { useRouter } from "next/router";
import { matchHref } from "./MatchCard";

// Carte d'un match À VENIR (onglet "Matchs à venir"). Ordre imposé, de haut en bas :
// heure de coup d'envoi, les deux équipes/joueurs, le nom de la compétition en plus
// petit, puis le bouton ANALYSER À L'INTÉRIEUR de la carte, avec la même marge que le
// reste du contenu — jamais collé au bord, jamais un bouton séparé sous la carte.
//
// Aucun score : ces matchs n'ont pas encore commencé (voir lib/upcomingMatches.js,
// keepUpcoming — un match qui démarre quitte cette liste).
function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Horaire non communiqué";
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function hideBrokenImage(e) {
  e.target.style.visibility = "hidden";
}

function Side({ side, align }) {
  return (
    <div style={{ ...st.side, ...(align === "right" ? st.sideRight : null) }}>
      <span style={st.logoWrap}>
        {side?.logo && <img src={side.logo} alt="" style={st.logo} onError={hideBrokenImage} loading="lazy" />}
      </span>
      <span style={{ ...st.name, ...(align === "right" ? st.nameRight : null) }}>{side?.name}</span>
    </div>
  );
}

export default function UpcomingMatchCard({ m }) {
  const router = useRouter();

  // Un match issu du pipeline maison porte sa forme d'origine : le lien "Analyser"
  // est alors construit exactement comme partout ailleurs sur le site (mêmes
  // paramètres, donc même page de pronostics). Un match venu uniquement de SportScore
  // n'a pas d'identifiant exploitable par le moteur de pronostics : on transmet ce
  // qu'on a réellement, jamais un identifiant inventé.
  const goToMatch = () => {
    if (m.raw) return router.push(matchHref(m.raw, m.raw.competition));
    router.push({
      pathname: `/match/${m.id}`,
      query: {
        competitionName: m.competition || "",
        homeTeamName: m.home?.name || "",
        awayTeamName: m.away?.name || "",
        utcDate: m.startTime || "",
        status: "SCHEDULED",
      },
    });
  };

  return (
    <li style={st.card} data-testid="upcoming-match-card">
      <div style={st.kickoff} data-testid="upcoming-kickoff">{formatTime(m.startTime)}</div>

      <div style={st.teams}>
        <Side side={m.home} />
        <span style={st.versus}>—</span>
        <Side side={m.away} align="right" />
      </div>

      <div style={st.competition}>{m.competition || "Compétition non communiquée"}</div>

      <button type="button" style={st.analyzeBtn} onClick={goToMatch}>
        ANALYSER
      </button>
    </li>
  );
}

const st = {
  // Le bouton est un ENFANT de la carte, qui porte la marge intérieure : il ne peut
  // donc jamais toucher le bord (même principe que components/MatchCard.js).
  card: {
    background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14,
    padding: 14, display: "flex", flexDirection: "column", gap: 10,
  },
  kickoff: { fontSize: 15, fontWeight: 800, color: "var(--accent)", letterSpacing: 0.3 },
  teams: { display: "flex", alignItems: "center", gap: 8, fontSize: 14 },
  side: { flex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  sideRight: { justifyContent: "flex-end" },
  logoWrap: { width: 26, height: 26, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" },
  logo: { maxWidth: 26, maxHeight: 26, objectFit: "contain" },
  name: {
    fontWeight: 600, minWidth: 0, overflowWrap: "break-word",
    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
  },
  nameRight: { textAlign: "right" },
  versus: { flexShrink: 0, color: "var(--text-secondary)", fontSize: 12 },
  competition: { fontSize: 11, color: "var(--text-secondary)", letterSpacing: 0.2 },
  analyzeBtn: {
    display: "block", width: "100%",
    background: "linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 82%, black))",
    border: "none", color: "var(--on-accent)", fontWeight: 800, fontSize: 13.5, borderRadius: 10,
    padding: "13px 0", cursor: "pointer", letterSpacing: 0.4,
    boxShadow: "0 0 14px rgba(var(--accent-rgb),0.4)",
  },
};
