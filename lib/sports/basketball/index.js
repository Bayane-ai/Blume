import * as provider from "./provider";
import * as mapper from "./mapper";
import * as pronostic from "./pronostic";

// Même interface que lib/sports/football (id/label/icon/implemented + provider/
// mapper/pronostic) — voir lib/sports/registry.js. `implemented: false` jusqu'aux
// blocs 1 (API), 3 (pronostics) et 4 (live + validation).
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
