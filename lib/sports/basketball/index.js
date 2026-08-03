import * as provider from "./provider";
import * as mapper from "./mapper";
import * as pronostic from "./pronostic";

// Même interface que lib/sports/football (id/label/icon/implemented + provider/
// mapper/pronostic) — voir lib/sports/registry.js. `implemented: true` depuis les
// blocs 2/3 (pages/index.js, pages/a-venir.js, pages pronostics, historique, Combiné
// Vision, News — tous branchés sur ce sport, voir git log) : ce champ n'est plus lu
// par aucun code de rendu (pages/index.js et pages/a-venir.js vérifient directement
// `sport === "basketball"`), mais le garder synchronisé avec la réalité évite de
// laisser une métadonnée trompeuse dans le repo.
const basketball = {
  id: "basketball",
  label: "Basket",
  icon: "🏀",
  implemented: true,
  provider,
  mapper,
  pronostic,
};

export default basketball;
