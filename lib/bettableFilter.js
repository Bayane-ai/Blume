// Filtre "matchs sur lesquels on peut parier" : Blume n'affiche jamais de vraie cote
// (aucune source de cotes connectée), donc il n'existe pas de signal direct "ce match a
// un marché de paris". En pratique, ce qu'un bookmaker propose réellement couvre les
// compétitions SENIORS professionnelles (ligues nationales, coupes, compétitions
// internationales, de n'importe quel pays) — et couvre très rarement les catégories
// jeunes, les équipes réserves ou les compétitions amateurs. On se base donc sur le nom
// de la compétition (seule donnée disponible ici) pour écarter ces dernières : un
// filtre heuristique, jamais parfait (une compétition jeune/amateur au nom atypique peut
// passer au travers), mais qui retire l'essentiel du bruit plutôt que de tout garder.
function normalizeForMatch(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// U14 à U23, sous toutes ses écritures courantes : "U20", "U-20", "Sub-20" (pays
// hispano/lusophones), "Under-20"/"Under 20" (anglais complet).
const AGE_CATEGORY_PATTERN = /\b(u|sub|under)[\s-]?(1[4-9]|2[0-3])\b/;

const EXCLUDE_KEYWORDS = [
  "youth", "junior", "juniors", "jeunes", "jeune",
  "reserve", "reserves", "réserve", "réserves",
  "amateur", "amateurs", "academy", "academie", "académie",
  "primavera", // catégorie jeune italienne (Serie A/B Primavera)
  "juvenil", // catégorie jeune espagnole
];

export function isBettableCompetitionName(name) {
  if (!name) return true; // pas de nom exploitable : on ne filtre pas sur une absence de donnée
  const n = normalizeForMatch(name);
  if (AGE_CATEGORY_PATTERN.test(n)) return false;
  return !EXCLUDE_KEYWORDS.some((kw) => n.includes(kw));
}
