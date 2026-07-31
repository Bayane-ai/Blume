import * as provider from "./provider";
import * as mapper from "./mapper";
import * as pronostic from "./pronostic";

// Même interface que lib/sports/football (id/label/icon/implemented + provider/
// mapper/pronostic) — voir lib/sports/registry.js. `implemented: false` jusqu'aux
// blocs 5 (API), 7 (pronostics) et 8 (live + validation).
const tennis = {
  id: "tennis",
  label: "Tennis",
  icon: "🎾",
  implemented: false,
  provider,
  mapper,
  pronostic,
};

export default tennis;
