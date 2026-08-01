/**
 * lib/newsScoring.js — les flux RSS ne fournissent aucun score de popularité : le tri
 * repose sur l'importance réelle du sujet (mots-clés, PAR SPORT depuis le bloc 9)
 * combinée à la fraîcheur.
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
  expect(computeImportance(big, "football", NOW)).toBeGreaterThan(computeImportance(minor, "football", NOW));
});

test("à sujet égal, l'article le plus récent obtient un score plus élevé", () => {
  const fresh = article({ publishedAt: new Date(NOW).toISOString() });
  const old = article({ publishedAt: new Date(NOW - 40 * 3600000).toISOString() });
  expect(computeImportance(fresh, "football", NOW)).toBeGreaterThan(computeImportance(old, "football", NOW));
});

test("sortByImportance place les grosses actualités récentes avant les mineures/anciennes", () => {
  const minor = article({ title: "Amical de pré-saison sans enjeu", publishedAt: new Date(NOW - 2 * 3600000).toISOString() });
  const major = article({
    title: "Manchester City officialise le transfert de Haaland",
    link: "https://example.com/major",
    publishedAt: new Date(NOW - 1 * 3600000).toISOString(),
  });
  const sorted = sortByImportance([minor, major], "football", NOW);
  expect(sorted[0]).toBe(major);
  expect(sorted[1]).toBe(minor);
});

test("un article sans date connue n'est pas exclu du tri (traité comme moyennement frais)", () => {
  const noDate = article({ publishedAt: null, link: "https://example.com/nodate" });
  expect(() => computeImportance(noDate, "football", NOW)).not.toThrow();
  const sorted = sortByImportance([noDate], "football", NOW);
  expect(sorted).toHaveLength(1);
});

test("à score égal, l'ordre d'arrivée d'origine est conservé (tri stable)", () => {
  const a = article({ title: "Match A", link: "https://example.com/a" });
  const b = article({ title: "Match B", link: "https://example.com/b" });
  const sorted = sortByImportance([a, b], "football", NOW);
  expect(sorted).toEqual([a, b]);
});

test("sport/`now` omis : repli sur football et l'heure actuelle, jamais un plantage", () => {
  expect(() => computeImportance(article())).not.toThrow();
  expect(() => sortByImportance([article()])).not.toThrow();
});

describe("bloc 9 — mots-clés PAR SPORT, jamais mélangés entre eux", () => {
  test("basket : un article évoquant la NBA/une grande équipe obtient un score plus élevé, avec le jeu de mots-clés basket", () => {
    const big = article({ title: "LeBron James mène les Lakers en playoffs NBA" });
    const minor = article({ title: "Petit club amateur annonce un nouveau sponsor" });
    expect(computeImportance(big, "basketball", NOW)).toBeGreaterThan(computeImportance(minor, "basketball", NOW));
  });

  test("tennis : un article évoquant un Grand Chelem/un joueur connu obtient un score plus élevé, avec le jeu de mots-clés tennis", () => {
    const big = article({ title: "Djokovic remporte Wimbledon face à Alcaraz" });
    const minor = article({ title: "Petit club amateur annonce un nouveau sponsor" });
    expect(computeImportance(big, "tennis", NOW)).toBeGreaterThan(computeImportance(minor, "tennis", NOW));
  });

  test("les mots-clés football n'augmentent jamais le score d'un article basket, et réciproquement", () => {
    const footballArticle = article({ title: "Mbappé signe au Real Madrid en Ligue des champions" });
    // Même article, jugé avec le jeu de mots-clés basket : aucun mot-clé football ne
    // s'y trouve dans la liste basket, le score ne doit donc reposer que sur la fraîcheur.
    const asBasketball = computeImportance(footballArticle, "basketball", NOW);
    const asFootball = computeImportance(footballArticle, "football", NOW);
    expect(asFootball).toBeGreaterThan(asBasketball);
  });

  test("sport inconnu : repli silencieux sur les mots-clés football, jamais un plantage", () => {
    expect(() => computeImportance(article(), "hockey", NOW)).not.toThrow();
  });
});
