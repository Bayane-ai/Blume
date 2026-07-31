// Multi-sport (bloc 0) — un seul point de vérité pour la liste des sports supportés
// par Blume et leur état d'implémentation. Utilisé par le sélecteur de sport
// (components/SportTabs.js), le cookie de préférence (lib/prefsCookie.js) et les
// pages de contenu pour savoir s'il faut afficher les vraies données ou l'état
// "bientôt disponible" (voir components/SportComingSoon.js).
//
// `implemented: false` ne veut jamais dire "affiche une erreur" : voir
// lib/sports/basketball et lib/sports/tennis, dont le provider/mapper/modèle de
// pronostics existent déjà (même interface que football, voir lib/sports/football)
// mais renvoient honnêtement `{ implemented: false }` tant que les blocs dédiés
// (1/3/4 pour le basket, 5/7/8 pour le tennis) ne les ont pas branchés à une vraie API.
export const SPORTS = [
  { id: "football", label: "Football", icon: "⚽", implemented: true },
  { id: "basketball", label: "Basket", icon: "🏀", implemented: false },
  { id: "tennis", label: "Tennis", icon: "🎾", implemented: false },
];

export const DEFAULT_SPORT = "football";

const SPORT_IDS = SPORTS.map((s) => s.id);

export function isValidSport(id) {
  return SPORT_IDS.includes(id);
}

// Toujours un sport valide en retour, jamais `undefined` — un id inconnu (cookie
// corrompu, ancienne valeur...) retombe silencieusement sur le sport par défaut.
export function getSportMeta(id) {
  return SPORTS.find((s) => s.id === id) || SPORTS.find((s) => s.id === DEFAULT_SPORT);
}
