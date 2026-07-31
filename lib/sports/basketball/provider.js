// Provider basket (bloc 1) — récupération des vraies données auprès d'une API basket
// (même famille d'esprit que lib/apiFootball.js/football-data.org pour le football :
// aucune donnée fictive, jamais un match inventé). Pas encore branché : chaque
// fonction renvoie honnêtement `implemented: false` plutôt qu'une liste vide qui
// pourrait laisser croire à "aucun match" — voir components/SportComingSoon.js, qui
// s'appuie sur ce même signal côté interface.
export async function getLiveMatches(/* token */) {
  return { implemented: false, matches: [] };
}

export async function getUpcomingMatches(/* token */) {
  return { implemented: false, competitions: [] };
}

export async function getMatchDetails(/* matchId, token */) {
  return { implemented: false, match: null };
}
