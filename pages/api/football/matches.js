// Alias serveur de /api/matches, pour que les TROIS sports exposent la même forme
// d'URL (/api/football|basketball|tennis/matches). Le client n'a ainsi plus aucune
// raison d'appeler un domaine externe directement (voir lib/upcomingMatches.js).
export { default } from "../matches";
