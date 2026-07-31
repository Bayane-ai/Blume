// Modèle de pronostics tennis (bloc 7) — même rôle que lib/sports/basketball/
// pronostic.js, pour le tennis. Pas encore branché : renvoie honnêtement
// `available: false` avec une raison claire, jamais une ligne inventée.
export function computePronostic(/* params */) {
  return { available: false, reason: "Tennis pas encore branché à un modèle de pronostics (voir bloc 7)." };
}
