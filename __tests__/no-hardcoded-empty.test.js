/**
 * Garde-fous permanents demandés :
 *   1. aucun message écrit en dur du type "non disponible avec cette source" /
 *      "plan gratuit" ne peut atteindre l'utilisateur — un écran vide ne doit JAMAIS
 *      être une décision du code, seulement un fait constaté ;
 *   2. aucune liste blanche de ligues/pays ni paramètre `season` figé ne réapparaît ;
 *   3. la pagination est bien suivie jusqu'à la dernière page dans chaque client.
 *
 * Ces tests lisent le CODE SOURCE : ils échouent si une régression est réintroduite,
 * même si le comportement n'est pas exercé par ailleurs.
 */
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

// Fichiers dont le contenu peut atteindre l'écran (pages + composants + libs de
// données). Les commentaires y sont autorisés — seules les CHAÎNES affichables sont
// interdites.
const UI_FILES = [
  "components/UpcomingMatchesSection.js",
  "components/UpcomingMatchCard.js",
  "pages/a-venir.js",
  "pages/api/tennis/matches.js",
  "lib/upcomingMatches.js",
];

// Retire les commentaires pour ne juger que ce qui peut réellement s'afficher.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("1. aucun écran vide décidé par le code", () => {
  test.each(UI_FILES)("%s ne contient aucun message de refus écrit en dur", (rel) => {
    const code = stripComments(read(rel));
    expect(code).not.toMatch(/plan gratuit/i);
    expect(code).not.toMatch(/non disponibles? (pour|avec) cette source/i);
    expect(code).not.toMatch(/seul le direct est proposé/i);
    // Le drapeau qui portait ce refus ne doit pas revenir dans le chemin "à venir".
    expect(code).not.toMatch(/\bunsupported\b/);
  });

  test("/api/tennis/matches interroge réellement une CHAÎNE de sources, au lieu de refuser d'emblée", () => {
    const code = read("pages/api/tennis/matches.js");
    // La route ne fait plus l'appel elle-même : elle enchaîne les sources déclarées
    // dans lib/sports/tennis/sources.js (SportScore, puis Live Tennis API).
    expect(code).toMatch(/chaineTennis\(\)/);
    expect(code).toMatch(/runCascade\(/);
    // Aucune réponse constante : la liste dépend de ce que les sources renvoient.
    expect(stripComments(code)).not.toMatch(/unsupported:\s*true/);

    const sources = read("lib/sports/tennis/sources.js");
    expect(sources).toMatch(/fetch\(/);
    expect(sources).toMatch(/matchesUrl\(/);
    expect(sources).toMatch(/\/fixtures/);
  });

  test("l'écran vide affiche la source, le code HTTP et la plage de dates", () => {
    const code = read("components/UpcomingMatchesSection.js");
    expect(code).toMatch(/upcoming-empty-diagnostic/);
    expect(code).toMatch(/httpStatus/);
    expect(code).toMatch(/diagnostic\.window\.from/);
  });
});

describe("2. aucune liste blanche ni saison figée", () => {
  // Tout le code de données, hors tests.
  const DATA_FILES = [
    "lib/upcomingMatches.js",
    "lib/sportScore.js",
    "lib/apiFootball.js",
    "lib/sports/basketball/provider.js",
    "pages/api/matches.js",
    "pages/api/basketball/matches.js",
    "pages/api/tennis/matches.js",
    "lib/liveListCache.js",
  ];

  test.each(DATA_FILES)("%s ne déclare aucune liste blanche de ligues ou de pays", (rel) => {
    const code = stripComments(read(rel));
    expect(code).not.toMatch(/LEAGUE_IDS|ALLOWED_COMPETITIONS|ALLOWED_LEAGUES|TOP_LEAGUES|WHITELIST/);
    expect(code).not.toMatch(/bettableFilter|isBettableCompetitionName/);
  });

  test("aucun appel de matchs ne fige un paramètre league= ou country=", () => {
    for (const rel of DATA_FILES) {
      const code = stripComments(read(rel));
      // Un `league=` codé en dur dans une URL de MATCHS restreindrait la couverture.
      // (Les classements/statistiques, eux, ciblent légitimement une ligue précise —
      // ils vivent dans d'autres fonctions, jamais dans ces fichiers de listing.)
      const matchUrls = code.match(/["'`][^"'`]*\/(games|fixtures|matches)\?[^"'`]*["'`]/g) || [];
      for (const u of matchUrls) {
        expect(u).not.toMatch(/[?&]league=/);
        expect(u).not.toMatch(/[?&]country=/);
      }
    }
  });

  test("aucune saison figée n'est envoyée sur un appel de matchs à venir", () => {
    const code = stripComments(read("lib/sports/basketball/provider.js"));
    // getGamesByDate ne doit transporter QUE la date et le fuseau.
    const call = code.match(/\/games\?date=\$\{[^}]+\}[^"'`]*/);
    expect(call).not.toBeNull();
    expect(call[0]).not.toMatch(/season=/);
    expect(call[0]).toMatch(/timezone=UTC/);
  });
});

describe("3. la pagination est suivie jusqu'à la dernière page", () => {
  test("API-Basketball boucle sur paging.total", () => {
    const code = read("lib/sports/basketball/provider.js");
    expect(code).toMatch(/paging\?\.total|paging\.total/);
    expect(code).toMatch(/while \(page <= totalPages\)/);
  });

  test("API-Football boucle sur paging.total", () => {
    const code = read("lib/apiFootball.js");
    expect(code).toMatch(/paging\?\.total|paging\.total/);
    expect(code).toMatch(/while \(page <= totalPages\)/);
  });

  test("football-data.org avance par offset (matchs à venir ET direct)", () => {
    for (const rel of ["pages/api/matches.js", "lib/liveListCache.js"]) {
      const code = read(rel);
      expect(code).toMatch(/offset=\$\{offset\}/);
      expect(code).toMatch(/offset \+= PAGE_SIZE/);
    }
  });

  test("SportScore suit la page suivante quand la réponse en annonce une", () => {
    const code = read("lib/sportScore.js");
    expect(code).toMatch(/nextPageUrl/);
    expect(code).toMatch(/while \(current && pages < MAX_PAGES\)/);
  });
});
