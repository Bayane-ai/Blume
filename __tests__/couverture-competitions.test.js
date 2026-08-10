/**
 * COUVERTURE TOTALE DES COMPÉTITIONS — règle absolue.
 *
 * Aucune restriction de compétition ne doit exister nulle part : ni liste blanche, ni
 * filtre par pays/fédération/niveau/genre/âge, ni plafond sur le nombre de matchs ou de
 * compétitions renvoyés. Ces tests échouent si l'une d'elles réapparaît.
 *
 * Ils ne remplacent pas la mesure réelle : c'est le contrôle quotidien
 * (lib/healthMatches.mjs) qui compte les compétitions distinctes en production et
 * signale une couverture anormalement basse.
 */
import fs from "fs";
import path from "path";
import { verdictPour, SEUIL_COUVERTURE } from "../lib/healthMatches.mjs";
import { presentCompetitions } from "../lib/matchFilters";
import { competitionRank, sortMatches } from "../lib/sportScore";

const racine = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(racine, p), "utf8");

// Tous les fichiers du chemin de données, pas seulement ceux qu'on soupçonne.
function fichiersSources(dir = racine, acc = []) {
  for (const nom of fs.readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "__tests__", "e2e", "coverage", "test-results"].includes(nom)) continue;
    const p = path.join(dir, nom);
    const st = fs.statSync(p);
    if (st.isDirectory()) fichiersSources(p, acc);
    else if (/\.(js|jsx|mjs)$/.test(nom)) acc.push(path.relative(racine, p));
  }
  return acc;
}

describe("aucune liste blanche ni filtre de compétition dans tout le projet", () => {
  const fichiers = fichiersSources();

  test("les mots-clés de restriction n'existent nulle part", () => {
    const interdits = /\b(whitelist|allowedLeagues|TOP_LEAGUES|popularLeagues|leagueIds|includeLeagues|allowedCompetitions|ALLOWED_LEAGUES|ALLOWED_COMPETITIONS)\b/;
    const coupables = fichiers.filter((f) => interdits.test(read(f)));
    expect(coupables).toEqual([]);
  });

  test("aucun filtre par pays, continent, fédération ou niveau", () => {
    // Ce qui est interdit, c'est d'ÉCARTER DES MATCHS selon ces critères. Lire un pays
    // pour l'afficher, ou lister les pays absents dans un log de diagnostic, est
    // légitime — le test doit viser le filtre appliqué à une liste de matchs, pas le
    // mot « country ». Une regex trop large crierait au loup et finirait ignorée.
    const surListeDeMatchs =
      /\b(matches|matchs|fixtures|games|collected)\b\s*(=[^;]{0,80})?\.filter\([^)]{0,160}\b(country|tier|continent|confederation|level)\b/i;
    const comparaisonDirecte = /\.(country|continent|confederation|tier)\s*===\s*["'`]/;
    const coupables = fichiers.filter((f) => {
      const src = read(f);
      return surListeDeMatchs.test(src) || comparaisonDirecte.test(src);
    });
    expect(coupables).toEqual([]);
  });

  test("aucun filtre par genre ni par catégorie d'âge", () => {
    // Exclure des U19/féminines reviendrait à tester le nom de la compétition pour
    // l'écarter. Seul le classement (competitionRank) a le droit de lire un nom.
    const interdits = /\.filter\([^)]*\b(u1[7-9]|u2[0-3]|women|f[ée]minin|youth|junior)\b/i;
    const coupables = fichiers.filter((f) => interdits.test(read(f)));
    expect(coupables).toEqual([]);
  });

  // Une expression `.slice(0, N)` n'est fautive que si elle tronque une LISTE DE
  // MATCHS. Tronquer un corps d'erreur pour un log, ou couper une date ISO à 10
  // caractères, est parfaitement légitime — d'où l'examen du contexte plutôt qu'un
  // simple mot-clé.
  function troncaturesDeListe(src) {
    const trouvees = [];
    const re = /\.slice\(0,\s*(\d+)\)/g;
    let m;
    while ((m = re.exec(src))) {
      const avant = src.slice(Math.max(0, m.index - 90), m.index);
      const listeDeMatchs = /\b(matches|matchs|fixtures|games|collected|competitions)\b/i.test(avant);
      const legitime = /\b(body|text|toISOString|message|erreur|error|missingCountries|rootKeys|samples?|failures)\b/i.test(avant);
      if (listeDeMatchs && !legitime) trouvees.push(src.slice(Math.max(0, m.index - 60), m.index + m[0].length));
    }
    return trouvees;
  }

  test("aucune troncature du nombre de matchs renvoyés par les routes", () => {
    for (const f of [
      "pages/api/matches.js",
      "pages/api/competition-matches.js",
      "pages/api/basketball/matches.js",
      "pages/api/tennis/matches.js",
    ]) {
      expect({ f, troncatures: troncaturesDeListe(read(f)) }).toEqual({ f, troncatures: [] });
    }
  });

  test("le garde-fou détecte VRAIMENT une troncature (vérifié sur un cas fabriqué)", () => {
    // Un test de non-régression qui ne peut pas échouer ne protège de rien : on vérifie
    // que la règle attrape la faute exacte qui vient d'être corrigée dans
    // pages/api/competition-matches.js, et qu'elle laisse passer le légitime.
    expect(troncaturesDeListe("let matches = (data.matches || []).slice(0, 100);")).toHaveLength(1);
    expect(troncaturesDeListe("const games = raw.games.slice(0, 50);")).toHaveLength(1);
    expect(troncaturesDeListe("`erreur sur /matches : ${body.slice(0, 300)}`")).toEqual([]);
    expect(troncaturesDeListe("return d.toISOString().slice(0, 10);")).toEqual([]);
  });

  test("les routes paginent jusqu'à épuisement", () => {
    expect(read("pages/api/matches.js")).toMatch(/offset \+= PAGE_SIZE/);
    expect(read("pages/api/competition-matches.js")).toMatch(/offset \+= PAGE_SIZE/);
    expect(read("lib/sports/basketball/provider.js")).toMatch(/paging\?\.total/);
    expect(read("lib/sports/tennis/sources.js")).toMatch(/meta\.has_more/);
  });
});

describe("les compétitions sont découvertes dynamiquement, jamais codées en dur", () => {
  test("les trois sports interrogent leur source PAR DATE, donc toutes compétitions confondues", () => {
    // Interroger par date rapporte d'un coup toutes les compétitions du jour. Une
    // compétition nouvelle chez le fournisseur apparaît donc sans toucher au code —
    // et sans le coût d'une énumération ligue par ligue.
    expect(read("pages/api/matches.js")).toMatch(/\/matches\?dateFrom=/);
    expect(read("lib/sports/basketball/provider.js")).toMatch(/\/games\?date=\$\{dateStr\}/);
    expect(read("lib/sports/tennis/sources.js")).toMatch(/"\/fixtures"/);
  });

  test("lib/competitions.js ne sert QU'À l'ordre et aux libellés, jamais à exclure", () => {
    const src = read("lib/matchFilters.js");
    // Les codes prioritaires ne servent qu'au tri : toute compétition présente dans les
    // matchs ressort, qu'elle y figure ou non.
    expect(src).toMatch(/!PRIORITY_CODES\.includes\(code\)/);
    expect(src).not.toMatch(/PRIORITY_CODES\.includes\(code\)\s*\)\s*;?\s*$/m);
  });

  test("une compétition inconnue ressort bien dans la liste des filtres", () => {
    const matchs = [
      { competition: { code: "PL", name: "Premier League" } },
      { competition: { code: "af-999", name: "Championnat azerbaïdjanais" } },
      { competition: { code: "af-777", name: "Coupe du Monde U20" } },
      { competition: { code: "af-555", name: "Eliteserien" } },
      { competition: { code: "af-444", name: "Supercoupe des Pays-Bas" } },
      { competition: { code: "af-333", name: "Première Ligue russe" } },
      { competition: { code: "af-222", name: "Scottish Premiership" } },
    ];
    const noms = presentCompetitions(matchs).map((c) => c.label);
    for (const attendu of [
      "Championnat azerbaïdjanais", "Coupe du Monde U20", "Eliteserien",
      "Supercoupe des Pays-Bas", "Première Ligue russe", "Scottish Premiership",
    ]) {
      expect(noms).toContain(attendu);
    }
    expect(noms).toHaveLength(matchs.length);
  });
});

describe("le tri met en avant sans jamais masquer", () => {
  test("aucun match n'est perdu par le tri, quelle que soit la compétition", () => {
    const matchs = [
      { competition: "Coupe du Monde U20", status: "upcoming", startTime: "2026-08-11T10:00:00Z" },
      { competition: "UEFA Champions League", status: "upcoming", startTime: "2026-08-11T20:00:00Z" },
      { competition: "Championnat azerbaïdjanais", status: "upcoming", startTime: "2026-08-11T15:00:00Z" },
      { competition: "Eliteserien", status: "upcoming", startTime: "2026-08-11T17:00:00Z" },
    ];
    expect(sortMatches(matchs, "football")).toHaveLength(4);
  });

  test("basket et tennis n'ont plus AUCUNE compétition privilégiée", () => {
    const basket = ["NBA", "WNBA", "NCAA", "EuroLeague", "EuroCup", "Basketball Champions League",
      "Liga ACB", "NBA Summer League", "Coupe de France", "FIBA World Cup Qualifiers", "LFB (féminin)", "U18 Euro"];
    expect(new Set(basket.map((c) => competitionRank(c, "basketball"))).size).toBe(1);

    const tennis = ["Wimbledon", "ATP Masters 1000", "ATP 250", "WTA 500", "Challenger Como",
      "ITF M15", "ITF W25", "United Cup", "Coupe Davis", "Billie Jean King Cup", "Exhibition", "Juniors"];
    expect(new Set(tennis.map((c) => competitionRank(c, "tennis"))).size).toBe(1);
  });
});

describe("mesure de couverture : un chiffre bas est traité comme une anomalie", () => {
  test("moins de 15 compétitions distinctes déclenche une alerte", () => {
    const v = verdictPour({ httpCode: 200, matchs: 40, sources: [{ statut: "ok" }], competitions: 6 });
    expect(v.verdict).toBe("COUVERTURE FAIBLE");
    expect(v.raison).toMatch(/filtre résiduel/);
  });

  test("au-delà du seuil, le verdict est OK", () => {
    expect(SEUIL_COUVERTURE).toBe(15);
    const v = verdictPour({ httpCode: 200, matchs: 40, sources: [{ statut: "ok" }], competitions: 19 });
    expect(v.verdict).toBe("OK");
  });
});
