import { COMPETITIONS } from "./competitions";

const PRIORITY_CODES = COMPETITIONS.map((c) => c.code);

// Compétitions réellement présentes dans une liste de matchs — jamais une compétition
// sans aucun match derrière (voir PROMPT 6 : "aucun bouton vide ou sans effet"), mais
// jamais une compétition écartée non plus simplement parce qu'elle n'est pas dans
// lib/competitions.js : les compétitions majeures connues gardent leur ordre de
// priorité habituel, et TOUTE autre compétition réellement présente dans les matchs
// (n'importe quelle fédération, n'importe quel pays, catégorie jeune comprise)
// apparaît aussi, triée alphabétiquement après elles.
export function presentCompetitions(matches) {
  const namesByCode = new Map();
  (matches || []).forEach((m) => {
    const code = m.competition?.code;
    if (!code || namesByCode.has(code)) return;
    const known = COMPETITIONS.find((c) => c.code === code);
    namesByCode.set(code, known?.name || m.competition?.name || code);
  });

  const codes = [...namesByCode.keys()];
  const ordered = [
    ...PRIORITY_CODES.filter((code) => namesByCode.has(code)),
    ...codes
      .filter((code) => !PRIORITY_CODES.includes(code))
      .sort((a, b) => namesByCode.get(a).localeCompare(namesByCode.get(b))),
  ];

  return ordered.map((code) => ({ value: code, label: namesByCode.get(code) }));
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
