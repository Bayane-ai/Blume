// Source de données 100% côté navigateur (aucune route /api, aucune clé) pour les deux
// widgets "compétitions spécifiques" et "tous les clubs" (voir components/
// ExternalMatchesWidget.js) : l'API publique "cachée" d'ESPN (site.api.espn.com),
// couramment utilisée hors ligne officielle pour ce cas exact (gratuite, sans clé,
// CORS ouvert en pratique). Elle est INDÉPENDANTE du pipeline principal de Blume
// (football-data.org / API-Football, server-side, voir lib/apiFootball.js) : ces deux
// pipelines ne partagent ni identifiants d'équipe ni de match.
//
// Important : cet environnement de développement n'a pas d'accès réseau sortant vers
// api.espn.com pour vérifier la forme exacte des réponses (même contrainte que pour
// football-data.org/API-Sports/Live Tennis API tout au long de ce projet — voir les
// commentaires équivalents dans lib/sports/tennis/*). Le mapper ci-dessous suit donc la
// forme publiquement documentée de cette API (utilisée par de nombreux projets open
// source), avec des chemins de repli multiples et sans jamais inventer de valeur —
// à vérifier réellement une fois déployé (ouvrir la console du navigateur sur la page
// d'accueil).
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

// Identifiants de championnat ESPN (slugs publiquement documentés).
export const LEAGUE_SLUGS = {
  UEFA_CHAMPIONS_LEAGUE: { slug: "uefa.champions", label: "Ligue des Champions" },
  UEFA_EUROPA_LEAGUE: { slug: "uefa.europa", label: "Ligue Europa" },
  UEFA_CONFERENCE_LEAGUE: { slug: "uefa.europa.conf", label: "Ligue Conférence" },
  RUSSIA_PREMIER_LEAGUE: { slug: "rus.1", label: "Premier League russe" },
  SWEDEN_ALLSVENSKAN: { slug: "swe.1", label: "Allsvenskan (Suède)" },
  SLOVAKIA_SUPER_LIGA: { slug: "svk.1", label: "Super Liga slovaque" },
  LATVIA_VIRSLIGA: { slug: "lat.1", label: "Virslīga lettone" },
  PREMIER_LEAGUE: { slug: "eng.1", label: "Premier League" },
  LA_LIGA: { slug: "esp.1", label: "LaLiga" },
  SERIE_A: { slug: "ita.1", label: "Serie A" },
  BUNDESLIGA: { slug: "ger.1", label: "Bundesliga" },
  LIGUE_1: { slug: "fra.1", label: "Ligue 1" },
};

function pad2(n) {
  return String(n).padStart(2, "0");
}

function yyyymmdd(d) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

// Fenêtre de date volontairement large (hier -> +6 jours) pour couvrir en un seul
// appel les matchs récemment terminés (score encore utile à afficher un court moment),
// ceux en direct, et les prochains de la semaine — sans jamais avoir besoin d'un
// deuxième endpoint (indisponible sur cette API publique de toute façon).
function scoreboardUrl(slug) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 1);
  const end = new Date(today);
  end.setDate(end.getDate() + 6);
  return `${ESPN_BASE}/${slug}/scoreboard?dates=${yyyymmdd(start)}-${yyyymmdd(end)}`;
}

// Statut ESPN -> vocabulaire Blume (voir components/MatchInfoBlock.js) : recherche par
// mot-clé, jamais une correspondance exacte fragile face à un libellé légèrement
// différent d'une ligue à l'autre.
function mapEspnStatus(type) {
  const name = String(type?.name || type?.description || type?.detail || "").toUpperCase();
  if (/HALFTIME|HALF[\s_-]?TIME/.test(name)) return "PAUSED";
  if (/PENALT/.test(name)) return "PENALTY_SHOOTOUT";
  if (/EXTRA/.test(name)) return "EXTRA_TIME";
  if (type?.state === "in") return "IN_PLAY";
  if (type?.state === "post" || type?.completed === true) return "FINISHED";
  return "SCHEDULED";
}

function cleanClock(displayClock) {
  if (!displayClock) return null;
  const trimmed = String(displayClock).replace(/['’]/g, "").trim();
  return trimmed || null;
}

// Transforme un événement brut ESPN en la forme standard utilisée partout ailleurs sur
// Blume pour un match football (voir components/MatchCard.js, MatchInfoBlock.js) —
// mêmes clés exactement, pour réutiliser ces composants sans aucune modification.
// Jamais de plantage : chaque champ absent ou de forme inattendue retombe sur une
// valeur honnête (null/chaîne vide), jamais une donnée inventée.
export function mapEspnEventToMatch(event, slug, label) {
  const comp = event?.competitions?.[0] || {};
  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  const home = competitors.find((c) => c?.homeAway === "home") || competitors[0] || {};
  const away = competitors.find((c) => c?.homeAway === "away") || competitors[1] || {};
  const type = comp.status?.type || event?.status?.type || {};
  const status = mapEspnStatus(type);

  const rawHomeScore = home.score;
  const rawAwayScore = away.score;
  const scoreHome = rawHomeScore !== undefined && rawHomeScore !== null && rawHomeScore !== "" ? Number(rawHomeScore) : null;
  const scoreAway = rawAwayScore !== undefined && rawAwayScore !== null && rawAwayScore !== "" ? Number(rawAwayScore) : null;
  const hasScore = status !== "SCHEDULED" && Number.isFinite(scoreHome) && Number.isFinite(scoreAway);

  const competitionName = label || event?.season?.slug || comp?.leagueName || "Compétition";

  return {
    id: `espn-${slug}-${event?.id ?? Math.random().toString(36).slice(2)}`,
    competition: { code: `espn-${slug}`, name: competitionName, emblem: "" },
    homeTeam: {
      id: home.team?.id ? `espn-team-${home.team.id}` : "",
      name: home.team?.displayName || home.team?.name || home.team?.shortDisplayName || "Équipe à domicile",
      crest: home.team?.logo || home.team?.logos?.[0]?.href || "",
    },
    awayTeam: {
      id: away.team?.id ? `espn-team-${away.team.id}` : "",
      name: away.team?.displayName || away.team?.name || away.team?.shortDisplayName || "Équipe à l'extérieur",
      crest: away.team?.logo || away.team?.logos?.[0]?.href || "",
    },
    status,
    minute: cleanClock(comp.status?.displayClock || event?.status?.displayClock),
    utcDate: event?.date || comp?.date || null,
    score: { fullTime: { home: hasScore ? scoreHome : null, away: hasScore ? scoreAway : null } },
  };
}

// Un seul championnat : ne lance jamais — une erreur réseau/HTTP remonte à l'appelant
// (voir getLeagueMatches), qui décide comment la traiter (une ligue en échec ne doit
// jamais faire disparaître les autres, voir ExternalMatchesWidget).
export async function fetchLeagueScoreboard(slug) {
  const res = await fetch(scoreboardUrl(slug));
  if (!res.ok) throw new Error(`ESPN ${slug} : HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.events) ? data.events : [];
}

export async function getLeagueMatches(slug, label) {
  const events = await fetchLeagueScoreboard(slug);
  return events
    .filter((e) => e && e.competitions?.[0]?.competitors?.length >= 2)
    .map((e) => mapEspnEventToMatch(e, slug, label));
}
