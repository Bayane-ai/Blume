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

// Clé de jour calendaire en heure LOCALE (voir PROMPT, page "Matchs à venir" :
// "utilise le fuseau horaire de l'utilisateur pour le calcul des dates, pas UTC en
// dur") — getFullYear()/getMonth()/getDate() sont les accesseurs LOCAUX de `Date`
// (contrairement à getUTCFullYear()/etc.), donc un match à 23h30 UTC ce soir peut très
// bien tomber "demain" pour un visiteur dans un fuseau très en avance, et "aujourd'hui"
// encore pour un autre très en retard — exactement le comportement voulu, calculé
// dans le NAVIGATEUR de chaque visiteur (seul endroit qui connaît son vrai fuseau).
function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDayLabel(d) {
  const label = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Regroupe une liste d'éléments (matchs bruts, ou paires { m, comp } comme dans
// pages/a-venir.js) par JOUR CALENDAIRE LOCAL — voir PROMPT : "groupés jour par jour
// par date, toutes compétitions confondues". Chaque groupe : { dateKey, label, items
// }, dateKey stable ("YYYY-MM-DD" en heure locale, sert de clé React), label lisible
// ("Aujourd'hui", "Demain", ou la date complète pour les jours suivants), items
// TOUJOURS triés chronologiquement au sein du jour (peu importe l'ordre d'entrée —
// aucune précondition imposée à l'appelant). `getDate` extrait la date UTC de chaque
// élément (par défaut `item.utcDate`, pour une liste de matchs bruts). `now` est
// paramétrable uniquement pour les tests (déterministe), sinon toujours `new Date()`
// (l'instant et le fuseau réels du visiteur).
export function groupByLocalDay(items, getDate = (item) => item?.utcDate, now = new Date()) {
  const todayKey = localDateKey(now);
  const tomorrowKey = localDateKey(new Date(now.getTime() + 24 * 3600 * 1000));

  const groups = new Map();
  for (const item of items || []) {
    const raw = getDate(item);
    if (!raw) continue;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) continue;
    const key = localDateKey(d);
    if (!groups.has(key)) {
      groups.set(key, { dateKey: key, sortDate: new Date(d.getFullYear(), d.getMonth(), d.getDate()), items: [] });
    }
    groups.get(key).items.push({ item, time: d.getTime() });
  }

  return [...groups.values()]
    .sort((a, b) => a.sortDate - b.sortDate)
    .map((g) => ({
      dateKey: g.dateKey,
      label: g.dateKey === todayKey ? "Aujourd'hui" : g.dateKey === tomorrowKey ? "Demain" : formatDayLabel(g.sortDate),
      items: [...g.items].sort((a, b) => a.time - b.time).map((entry) => entry.item),
    }));
}

// Repli pratique pour une liste de matchs bruts (chacun avec .utcDate directement) —
// même comportement que groupByLocalDay avec l'accesseur par défaut.
export function groupMatchesByLocalDay(matches, now = new Date()) {
  return groupByLocalDay(matches, (m) => m?.utcDate, now);
}
