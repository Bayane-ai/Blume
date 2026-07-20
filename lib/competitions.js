// Compétitions majeures connues, utilisées uniquement pour donner un nom/pays soigné
// et une priorité d'affichage (compétitions majeures d'abord) à ces compétitions
// précises quand elles ont des matchs. Ce n'est PAS une liste exhaustive ni un filtre :
// pages/api/matches.js et pages/api/live-matches.js affichent TOUTE compétition
// réellement renvoyée par les API (football-data.org + API-Football), y compris
// celles absentes d'ici — voir lib/matchFilters.js pour le même principe côté
// filtres de l'interface.
export const COMPETITIONS = [
  { code: "WC", name: "Coupe du Monde", area: "Monde" },
  { code: "EC", name: "Euro (Championnat d'Europe)", area: "Europe" },
  { code: "CL", name: "Ligue des Champions", area: "Europe" },
  { code: "PL", name: "Premier League", area: "Angleterre" },
  { code: "PD", name: "LaLiga", area: "Espagne" },
  { code: "SA", name: "Serie A", area: "Italie" },
  { code: "BL1", name: "Bundesliga", area: "Allemagne" },
  { code: "FL1", name: "Ligue 1", area: "France" },
  { code: "PPL", name: "Primeira Liga", area: "Portugal" },
  { code: "DED", name: "Eredivisie", area: "Pays-Bas" },
  { code: "ELC", name: "Championship", area: "Angleterre" },
  { code: "BSA", name: "Campeonato Brasileiro Série A", area: "Brésil" },
];
