// Approximation numérique standard de la fonction d'erreur (Abramowitz & Stegun,
// formule 7.1.26 — précision ~1,5e-7), utilisée pour la loi normale. Le basket se
// joue sur des totaux élevés (~100-120 points par match) : contrairement au football
// (buts, voir lib/pronostic.js, modèle de Poisson sur un petit nombre d'évènements),
// une approximation normale — centrée sur la vraie moyenne et le vrai écart-type de
// CHAQUE équipe (voir lib/sports/basketball/statProfiles.js), jamais une valeur
// inventée — est le choix statistique standard et honnête pour ce genre de totaux.
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

// P(X <= x) pour X ~ Normale(mean, sd).
export function normalCdf(x, mean, sd) {
  if (!sd || sd <= 0) return x >= mean ? 1 : 0;
  return 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
}

// P(X > x) — utilisé pour la confiance réelle d'une ligne "Plus de X,5".
export function normalProbabilityOver(x, mean, sd) {
  return 1 - normalCdf(x, mean, sd);
}
