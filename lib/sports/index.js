// Point d'entrée unique de l'abstraction multi-sport : un module par sport (football/
// basketball/tennis), tous avec la même interface (id/label/icon/implemented +
// provider/mapper/pronostic pour basketball/tennis — voir lib/sports/registry.js pour
// la métadonnée utilisée par l'interface, et le commentaire de lib/sports/football/
// index.js pour pourquoi football n'a pas besoin d'un provider/mapper/pronostic
// dupliqué ici).
import football from "./football";
import basketball from "./basketball";
import tennis from "./tennis";

export const SPORT_MODULES = { football, basketball, tennis };

export function getSportModule(id) {
  return SPORT_MODULES[id] || SPORT_MODULES.football;
}

export { SPORTS, DEFAULT_SPORT, isValidSport, getSportMeta } from "./registry";
