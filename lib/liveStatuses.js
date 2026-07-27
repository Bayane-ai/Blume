// Statuts football-data.org correspondant à un match RÉELLEMENT en cours (1ère
// mi-temps, mi-temps, 2ème mi-temps, prolongations, tirs au but — le temps additionnel
// n'a pas de statut à part, il reste "IN_PLAY" avec une minute > 45/90) — voir la
// documentation de l'API v4 (enum status). Centralisé ICI, PARTOUT où le site doit
// reconnaître un match "en direct", pour ne plus jamais reproduire le bug déjà
// rencontré : IN_PLAY/PAUSED dupliqués séparément dans une dizaine de fichiers, sans
// EXTRA_TIME ni PENALTY_SHOOTOUT — un match en prolongations ou aux tirs au but
// disparaissait alors de la liste "en direct" alors qu'il l'était bien réellement.
export const LIVE_STATUSES = ["IN_PLAY", "PAUSED", "EXTRA_TIME", "PENALTY_SHOOTOUT"];

// Valeur du paramètre `status` envoyé à l'API football-data.org (voir
// lib/liveListCache.js, pages/api/matches.js, pages/api/competition-matches.js) —
// inclut en plus le pseudo-statut "LIVE" que l'API accepte comme raccourci pour "tout
// statut en direct", gardé par sécurité en plus de la liste explicite ci-dessus.
export const LIVE_STATUS_QUERY = "LIVE," + LIVE_STATUSES.join(",");
