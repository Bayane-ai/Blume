// Modèle de pronostics basket (bloc 3) — même rôle que lib/pronostic.js/
// lib/pronosticFromProfiles.js pour le football. Pas encore branché : renvoie
// honnêtement `available: false` avec une raison claire, jamais une ligne inventée.
export function computePronostic(/* params */) {
  return { available: false, reason: "Basket pas encore branché à un modèle de pronostics (voir bloc 3)." };
}
