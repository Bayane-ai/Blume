import * as provider from "./provider";
import * as mapper from "./mapper";
import * as pronostic from "./pronostic";

// Même interface que lib/sports/football (id/label/icon/implemented + provider/
// mapper/pronostic) — voir lib/sports/registry.js. Bloc 1 : provider/mapper
// branchés sur de vraies données (API-SPORTS Basketball, voir provider.js) —
// `implemented` reste `false` tant que la page (bloc 2) et les pronostics (bloc 3)
// ne sont pas branchés à leur tour : ce sont eux qui rendent le sport réellement
// utilisable de bout en bout, pas seulement la donnée brute.
const basketball = {
  id: "basketball",
  label: "Basket",
  icon: "🏀",
  implemented: false,
  provider,
  mapper,
  pronostic,
};

export default basketball;
