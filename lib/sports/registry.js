// Multi-sport (bloc 0) — un seul point de vérité pour la liste des sports supportés
// par Blume et leur état d'implémentation. Utilisé par le sélecteur de sport
// (components/SportTabs.js), le cookie de préférence (lib/prefsCookie.js) et les
// pages de contenu pour savoir s'il faut afficher les vraies données ou l'état
// "bientôt disponible" (voir components/SportComingSoon.js).
//
// Les trois sports sont désormais entièrement branchés (live, à venir, pronostics,
// historique, Combiné Vision, News — voir git log, blocs 1 à 9) : `implemented: true`
// pour les trois. Ce champ n'est plus lu par aucun code de rendu (pages/index.js et
// pages/a-venir.js vérifient directement `sport === "basketball"`/`"tennis"`,
// components/SportTabs.js affiche toujours les 3 pastilles sans condition) — il ne
// sert plus que de documentation, mais le garder synchronisé avec la réalité évite de
// laisser une métadonnée trompeuse dans le repo.
export const SPORTS = [
  { id: "football", label: "Football", icon: "⚽", implemented: true },
  { id: "basketball", label: "Basket", icon: "🏀", implemented: true },
  { id: "tennis", label: "Tennis", icon: "🎾", implemented: true },
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
