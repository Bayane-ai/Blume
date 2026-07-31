// Provider tennis (bloc 5) — même rôle que lib/sports/basketball/provider.js, pour le
// tennis. Pas encore branché : renvoie honnêtement `implemented: false`.
export async function getLiveMatches(/* token */) {
  return { implemented: false, matches: [] };
}

export async function getUpcomingMatches(/* token */) {
  return { implemented: false, competitions: [] };
}

export async function getMatchDetails(/* matchId, token */) {
  return { implemented: false, match: null };
}
