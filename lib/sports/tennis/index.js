import * as provider from "./provider";
import * as mapper from "./mapper";
import * as pronostic from "./pronostic";

// Même interface que lib/sports/football (id/label/icon/implemented + provider/
// mapper/pronostic) — voir lib/sports/registry.js. `implemented: true` depuis les
// blocs 5 (API), 7 (pronostics) et 8 (live + validation) : ce champ n'est plus lu par
// aucun code de rendu (pages/index.js et pages/a-venir.js vérifient directement
// `sport === "tennis"`), mais le garder synchronisé avec la réalité évite de laisser
// une métadonnée trompeuse dans le repo.
const tennis = {
  id: "tennis",
  label: "Tennis",
  icon: "🎾",
  implemented: true,
  provider,
  mapper,
  pronostic,
};

export default tennis;
