// Mise en forme partagée des lignes de marché façon paris sportifs ("Plus de 2,5"),
// utilisée par components/PronosticResults.js et components/CardsAndCorners.js —
// jamais une cote, seulement la ligne et le sens (voir lib/pronostic.js).
export function formatLine(line) {
  // La ligne est toujours un nombre à virgule (ex : 2.5, jamais un entier) — une seule
  // décimale suffit, avec une virgule française plutôt qu'un point.
  return String(line).replace(".", ",");
}

function singleLineLabel(entry) {
  return `${entry.side} de ${formatLine(entry.line)}`;
}

// Une seule ligne quand le modèle est confiant ("Plus de 2,5") ; deux lignes voisines
// quand l'issue est trop incertaine pour un seul chiffre ("Plus de 2,5 (ou 3,5)") —
// voir lib/pronostic.js (overUnderLine, `withMargin`).
export function marketLabel(market) {
  const lines = market?.lines;
  if (!lines || lines.length === 0) return "–";
  const [first, second] = lines;
  const base = singleLineLabel(first);
  if (!second) return base;
  return `${base} (ou ${formatLine(second.line)})`;
}

// Couple de lignes "sûre"/"risquée" (voir lib/pronostic.js, riskLines) — même mise en
// forme ("Plus de X,5") que marketLabel, mais pour les deux niveaux de risque affichés
// côte à côte (bloc "Corners et cartons"), jamais une cote.
export function riskLabels(market) {
  if (!market?.safe || !market?.risky) return { safe: "–", risky: "–" };
  return { safe: singleLineLabel(market.safe), risky: singleLineLabel(market.risky) };
}
