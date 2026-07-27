// Message d'erreur TECHNIQUE mais clair (voir PROMPT : "clé invalide, quota dépassé,
// service indisponible" — jamais une liste vide et silencieuse) pour un échec de
// football-data.org, affiché tel quel côté client (pages/index.js, pages/a-venir.js)
// et loggé intégralement côté serveur (voir appelants).
export function describeFootballDataError({ status, bodyMessage, networkError } = {}) {
  if (networkError) {
    return `football-data.org est injoignable (erreur réseau : ${networkError}).`;
  }
  const detail = bodyMessage ? ` — ${bodyMessage}` : "";
  if (status === 401 || status === 403) {
    return `Clé API football-data.org invalide ou refusée par le serveur (code ${status})${detail}.`;
  }
  if (status === 429) {
    return `Quota de requêtes football-data.org dépassé (code 429)${detail} — réessaie dans une minute.`;
  }
  if (status >= 500) {
    return `Service football-data.org indisponible pour l'instant (code ${status})${detail}.`;
  }
  return `Erreur football-data.org (code ${status})${detail}.`;
}
