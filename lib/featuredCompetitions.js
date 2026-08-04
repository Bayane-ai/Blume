// Détecte si un match appartient aux compétitions demandées explicitement : Ligue des
// Champions, Europa League, Conference League, ou 1ère division russe/suédoise/
// slovaque/lettone. Utilisé UNIQUEMENT pour faire remonter ces compétitions en tête du
// carrousel de filtres déjà existant (voir lib/matchFilters.js#presentCompetitions) —
// jamais pour dupliquer les matchs dans une section séparée : la liste "Football en
// direct"/"Matchs à venir" reste la SEULE liste de cartes affichée (garantie déjà
// testée : elle montre TOUJOURS tous les matchs, sans filtre de compétition), donc un
// même match n'apparaît jamais deux fois sur la page — seul l'ORDRE des boutons de
// filtre change.

// Pays tels que renvoyés par API-Football (`league.country`, voir
// lib/apiFootball.js#mapFixtureToUpcomingMatch/#mapFixtureToLiveMatch) — la Russie, la
// Suède, la Slovaquie et la Lettonie ne sont PAS couvertes par football-data.org (plan
// gratuit) : ces 4 championnats ne peuvent venir que d'API-Football, jamais inventés si
// la clé API_FOOTBALL_KEY est absente ou si le plan configuré ne les couvre pas (auquel
// cas ils manquent honnêtement, comme n'importe quel autre trou de couverture déjà
// documenté sur /admin).
const SPECIFIC_COUNTRIES = new Set(["russia", "sweden", "slovakia", "latvia"]);

// Exclusion best-effort des compétitions qui ne sont clairement PAS la première
// division (coupe, réserve, jeunes, féminines) quand un pays renvoie plusieurs
// compétitions — l'API ne marque pas explicitement "1ère division", donc ceci reste une
// heuristique par mot-clé, jamais une certitude absolue.
const NOT_TOP_FLIGHT = /\b(cup|coupe|reserve|réserve|youth|u1[7-9]|u2[0-1]|women|f[ée]minin|super\s?cup|supercoupe)\b/i;

function normalize(str) {
  return (str || "").toLowerCase().trim();
}

function isChampionsLeague(name) {
  return /champions league/i.test(name || "");
}
function isConferenceLeague(name) {
  return /conference league/i.test(name || "");
}
function isEuropaLeague(name) {
  return /europa league/i.test(name || "") && !isConferenceLeague(name);
}

export function isFeaturedSpecificCompetition(m) {
  const name = m?.competition?.name || "";
  if (isChampionsLeague(name) || isEuropaLeague(name) || isConferenceLeague(name)) return true;
  const country = normalize(m?.competition?.area);
  if (SPECIFIC_COUNTRIES.has(country) && !NOT_TOP_FLIGHT.test(name)) return true;
  return false;
}
