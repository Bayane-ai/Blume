import { COMPETITIONS } from "./competitions";

// Compétitions réellement présentes dans une liste de matchs (triées selon la
// priorité de lib/competitions.js, compétitions majeures d'abord) — jamais une
// compétition sans aucun match derrière, pour ne jamais afficher de bouton vide
// (voir PROMPT 6 : "aucun bouton vide ou sans effet").
export function presentCompetitions(matches) {
  const codes = new Set((matches || []).map((m) => m.competition?.code).filter(Boolean));
  return COMPETITIONS.filter((c) => codes.has(c.code)).map((c) => ({ value: c.code, label: c.name }));
}

// Journées (matchdays) réellement présentes pour une compétition donnée, triées par
// ordre croissant — champ `matchday` fourni par football-data.org ; absent/non
// exploitable pour les phases à élimination directe, auquel cas la liste reste
// vide et aucun carrousel de journées n'est affiché pour cette compétition.
export function presentMatchdays(matches, competitionCode) {
  const days = new Set(
    (matches || [])
      .filter((m) => m.competition?.code === competitionCode && Number.isInteger(m.matchday))
      .map((m) => m.matchday)
  );
  return [...days].sort((a, b) => a - b).map((d) => ({ value: String(d), label: `Journée ${d}` }));
}
