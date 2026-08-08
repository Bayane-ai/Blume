// Couche unifiée de l'onglet "Matchs à venir" (page /a-venir) — fusion de l'ancien
// onglet "Matchs du jour" et de l'ancienne page "Matchs à venir".
//
// Principe : pour CHAQUE sport, on agrège TOUTES les sources disponibles, on
// déduplique, on ne garde que les matchs PAS ENCORE COMMENCÉS de maintenant à J+7,
// puis on groupe par jour (fuseau du visiteur) et par compétition.
//
// UNE SEULE route same-origin par sport ; la cascade de sources vit CÔTÉ SERVEUR,
// dans la route (voir lib/sourceCascade.js) :
//   football   : /api/football/matches   -> football-data.org + API-Football
//   basketball : /api/basketball/matches -> API-Basketball puis SportScore (secours)
//   tennis     : /api/tennis/matches     -> SportScore puis Live Tennis API (secours)
//
// AUCUN filtre de compétition, de pays, de division, de catégorie d'âge ni
// d'importance : toutes fédérations, toutes divisions, coupes, jeunes (U17/U19/U20),
// réserves, féminines, amicaux et petites compétitions sont conservés. Les grandes
// compétitions sont seulement REMONTÉES dans l'ordre d'affichage, jamais les autres
// écartées (voir competitionRank).
import { competitionRank } from "./sportScore";

// Fenêtre demandée : de l'instant présent à J+7.
export const HORIZON_DAYS = 7;

// UNE SEULE route par sport, toujours same-origin. Aucun fetch navigateur vers un
// domaine externe : c'était la cause du "Failed to fetch" (CORS) côté tennis, et ça
// exposait les paramètres d'appel dans le navigateur. Chaque route interroge ses
// propres sources côté serveur, où CORS ne s'applique pas.
const BLUME_ROUTES = {
  football: "/api/football/matches",
  basketball: "/api/basketball/matches",
  tennis: "/api/tennis/matches",
};

// Statuts Blume considérés comme "pas encore commencé". Tout le reste (IN_PLAY,
// PAUSED, FINISHED...) appartient à l'onglet Live ou à l'historique, jamais ici.
const NOT_STARTED = new Set(["SCHEDULED", "TIMED"]);

function text(v) {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

// Forme interne commune à toutes les sources, pour que l'affichage soit identique
// quelle que soit la provenance du match.
function normalizeBlume(m, sport) {
  return {
    id: String(m?.id ?? ""),
    sport,
    home: { name: text(m?.homeTeam?.name), logo: text(m?.homeTeam?.crest) },
    away: { name: text(m?.awayTeam?.name), logo: text(m?.awayTeam?.crest) },
    competition: text(m?.competition?.name),
    // Pays/fédération, affiché à côté du nom de la compétition quand la source le
    // fournit (football-data.org et API-Football le donnent ; SportScore, non).
    area: text(m?.competition?.area),
    startTime: text(m?.utcDate),
    status: m?.status || null,
    // Conserve la forme d'origine : la carte doit pouvoir construire le lien
    // "Analyser" exactement comme ailleurs sur le site (voir components/MatchCard.js).
    raw: m,
  };
}

// Clé de déduplication : deux équipes + horaire de coup d'envoi, demandé explicitement.
// Les noms sont normalisés (accents, casse, suffixes de club) et l'horaire arrondi à
// 15 minutes — deux sources donnent rarement la seconde exacte pour le même match.
export function dedupeKey(m) {
  const norm = (s) =>
    (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\b(fc|cf|ac|sc|afc|cfc|sad|club)\b/g, "")
      .replace(/[^a-z0-9]/g, "");
  const t = m.startTime ? Math.round(new Date(m.startTime).getTime() / 900000) : "?";
  // Ordre des équipes neutralisé : une source peut inverser domicile/extérieur.
  const teams = [norm(m.home?.name), norm(m.away?.name)].sort().join("|");
  return `${m.sport}|${teams}|${t}`;
}

export function dedupe(matches) {
  const seen = new Map();
  for (const m of matches) {
    const key = dedupeKey(m);
    const existing = seen.get(key);
    // À doublon égal, on garde la version la plus riche (celle qui porte un pays et/ou
    // une forme brute exploitable pour le lien "Analyser").
    if (!existing) seen.set(key, m);
    else if (!existing.raw && m.raw) seen.set(key, m);
    else if (!existing.area && m.area) seen.set(key, m);
  }
  return [...seen.values()];
}

// Ne garde que les matchs réellement À VENIR, dans la fenêtre demandée. Un match qui
// démarre quitte donc automatiquement cette liste au rafraîchissement suivant.
export function keepUpcoming(matches, { now = Date.now(), horizonDays = HORIZON_DAYS } = {}) {
  const limit = now + horizonDays * 24 * 3600 * 1000;
  return matches.filter((m) => {
    if (!m.home?.name || !m.away?.name || !m.startTime) return false;
    if (m.status && !NOT_STARTED.has(m.status)) return false;
    const t = new Date(m.startTime).getTime();
    return Number.isFinite(t) && t > now && t <= limit;
  });
}

// Clé de jour dans le fuseau LOCAL du visiteur (jamais la date UTC brute, qui ferait
// basculer un match de 23h dans le mauvais jour pour une bonne partie du monde).
export function localDayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dayLabel(key, now = new Date()) {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((date - today) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Demain";
  const label = date.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Hiérarchie d'affichage demandée : jour -> compétition -> matchs.
// Les jours sont chronologiques ; à l'intérieur d'un jour, les grandes compétitions
// remontent (competitionRank) sans que jamais aucune autre ne soit écartée ; à
// l'intérieur d'une compétition, les matchs sont triés par heure croissante.
export function groupByDayThenCompetition(matches, sport, now = new Date()) {
  const days = new Map();
  for (const m of matches) {
    const key = localDayKey(m.startTime);
    if (!days.has(key)) days.set(key, new Map());
    const comps = days.get(key);
    const compKey = m.competition || "Compétition non communiquée";
    if (!comps.has(compKey)) comps.set(compKey, { competition: compKey, area: m.area || null, matches: [] });
    const group = comps.get(compKey);
    if (!group.area && m.area) group.area = m.area;
    group.matches.push(m);
  }

  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, comps]) => ({
      key,
      label: dayLabel(key, now),
      competitions: [...comps.values()]
        .sort(
          (a, b) =>
            competitionRank(a.competition, sport) - competitionRank(b.competition, sport) ||
            a.competition.localeCompare(b.competition)
        )
        .map((g) => ({ ...g, matches: [...g.matches].sort((x, y) => new Date(x.startTime) - new Date(y.startTime)) })),
    }));
}

// Récupère la source maison du sport. Ne lève pas : une source indisponible ne doit
// jamais empêcher l'autre de remplir la liste — l'erreur est renvoyée pour être
// journalisée et affichée, jamais avalée en silence.
async function loadBlumeSource(sport, fetchImpl) {
  const route = BLUME_ROUTES[sport];
  if (!route) return { matches: [], error: null };
  try {
    const res = await fetchImpl(route, { headers: { Accept: "application/json" } });
    // Seul un `ok` explicitement faux est une erreur : une implémentation de fetch qui
    // n'expose pas ce champ (client léger, test) ne doit pas être prise pour une panne.
    if (res.ok === false) throw new Error(`${route} : HTTP ${res.status}`);
    const payload = await res.json();
    const flat = Array.isArray(payload?.competitions)
      ? payload.competitions.flatMap((c) => c?.matches || [])
      : payload?.matches || [];
    return { matches: flat.map((m) => normalizeBlume(m, sport)), error: null, diagnostic: payload?.diagnostic || null };
  } catch (e) {
    return { matches: [], error: e.message, diagnostic: null };
  }
}


// Point d'entrée unique de la page. Renvoie les jours prêts à afficher, plus un
// rapport de couverture (comptage par source, total de compétitions et de matchs) —
// c'est ce rapport que l'interface journalise et compare à ce qu'elle rend réellement.
export async function loadUpcoming(sport, { fetchImpl = fetch, now = Date.now() } = {}) {
  const route = BLUME_ROUTES[sport];
  const blume = await loadBlumeSource(sport, fetchImpl);

  const upcoming = keepUpcoming(dedupe(blume.matches), { now });
  const days = groupByDayThenCompetition(upcoming, sport, new Date(now));
  const competitions = new Set(upcoming.map((m) => m.competition || "Compétition non communiquée"));

  // La route serveur décrit elle-même ce qu'elle a interrogé (source réelle, statut
  // upstream, fenêtre) : on le transmet tel quel plutôt que de le redeviner ici.
  const upstream = blume.diagnostic || null;

  // Détail source par source tel que la route l'a constaté (cascade complète), pour ne
  // rien redeviner ici. Repli sur une entrée unique quand la route ne le fournit pas.
  const sources = Array.isArray(upstream?.sources) && upstream.sources.length
    ? upstream.sources.map((s) => ({
        name: `${route} → ${s.name}`,
        httpStatus: s.httpStatus ?? null,
        received: s.received ?? 0,
        error: s.error || null,
      }))
    : [
        {
          name: upstream?.source ? `${route} → ${upstream.source}` : route,
          httpStatus: blume.error ? null : upstream?.upstreamStatus ?? upstream?.httpStatus ?? 200,
          received: upstream?.received ?? blume.matches.length,
          error: blume.error || upstream?.error || null,
        },
      ];

  return {
    days,
    coverage: {
      sport,
      fromBlume: blume.matches.length,
      afterDedupe: blume.matches.length,
      upcoming: upcoming.length,
      competitions: competitions.size,
    },
    errors: { blume: blume.error || upstream?.error || null },
    // "Toutes les sources ont échoué" = la route n'a pas répondu, OU elle a répondu en
    // signalant que TOUTES ses sources amont étaient en échec. Un vide n'est légitime
    // que si tout a répondu correctement.
    allSourcesFailed: Boolean(blume.error) || Boolean(upstream?.allSourcesFailed),
    // "Au moins une source en échec" : suffit à interdire le message "aucun match" et
    // à déclencher une nouvelle tentative (demande explicite) — un vide constaté par
    // une source pendant qu'une autre est en panne n'est pas un vide fiable.
    anySourceFailed:
      Boolean(blume.error) ||
      Boolean(upstream?.anySourceFailed) ||
      Boolean(upstream?.error) ||
      sources.some((s) => s.error),
    diagnostic: {
      window: upstream?.window || {
        from: new Date(now).toISOString().slice(0, 10),
        to: new Date(now + HORIZON_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10),
      },
      sources,
    },
  };
}
