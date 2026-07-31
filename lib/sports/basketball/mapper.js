// Mapper basket (bloc 1) — normalise la réponse brute de l'API basket vers la forme
// commune déjà utilisée par le football (voir lib/apiFootball.js#mapFixtureToLiveState/
// mapFixtureToUpcomingMatch pour la forme cible). Pas encore branché.
export function mapMatchToLiveState(/* raw */) {
  throw new Error("Basket : mapping des matchs en direct pas encore implémenté (voir bloc 1).");
}

export function mapMatchToUpcoming(/* raw */) {
  throw new Error("Basket : mapping des matchs à venir pas encore implémenté (voir bloc 1).");
}
