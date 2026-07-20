/**
 * lib/newsScoring.js — les flux RSS ne fournissent aucun score de popularité : le tri
 * repose sur l'importance réelle du sujet (mots-clés) combinée à la fraîcheur.
 */
import { sortByImportance, computeImportance } from "../lib/newsScoring";

const NOW = new Date("2026-07-20T12:00:00Z").getTime();

function article(overrides) {
  return {
    title: "Actualité générique",
    summary: "Résumé générique.",
    link: "https://example.com/x",
    publishedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

test("un article évoquant un grand club/transfert obtient un score plus élevé qu'un article générique publié au même moment", () => {
  const big = article({ title: "Mbappé signe un transfert record au Real Madrid" });
  const minor = article({ title: "Petit club amateur annonce un nouveau sponsor" });
  expect(computeImportance(big, NOW)).toBeGreaterThan(computeImportance(minor, NOW));
});

test("à sujet égal, l'article le plus récent obtient un score plus élevé", () => {
  const fresh = article({ publishedAt: new Date(NOW).toISOString() });
  const old = article({ publishedAt: new Date(NOW - 40 * 3600000).toISOString() });
  expect(computeImportance(fresh, NOW)).toBeGreaterThan(computeImportance(old, NOW));
});

test("sortByImportance place les grosses actualités récentes avant les mineures/anciennes", () => {
  const minor = article({ title: "Amical de pré-saison sans enjeu", publishedAt: new Date(NOW - 2 * 3600000).toISOString() });
  const major = article({
    title: "Manchester City officialise le transfert de Haaland",
    link: "https://example.com/major",
    publishedAt: new Date(NOW - 1 * 3600000).toISOString(),
  });
  const sorted = sortByImportance([minor, major], NOW);
  expect(sorted[0]).toBe(major);
  expect(sorted[1]).toBe(minor);
});

test("un article sans date connue n'est pas exclu du tri (traité comme moyennement frais)", () => {
  const noDate = article({ publishedAt: null, link: "https://example.com/nodate" });
  expect(() => computeImportance(noDate, NOW)).not.toThrow();
  const sorted = sortByImportance([noDate], NOW);
  expect(sorted).toHaveLength(1);
});

test("à score égal, l'ordre d'arrivée d'origine est conservé (tri stable)", () => {
  const a = article({ title: "Match A", link: "https://example.com/a" });
  const b = article({ title: "Match B", link: "https://example.com/b" });
  const sorted = sortByImportance([a, b], NOW);
  expect(sorted).toEqual([a, b]);
});
