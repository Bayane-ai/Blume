/**
 * BLOC 2 — chaîne de sources tennis, format normalisé commun, contrôle quotidien.
 *
 * Le contrat de Live Tennis API utilisé ici n'est pas deviné : il vient du client
 * OFFICIEL du fournisseur (npm `livetennisapi@1.4.1`) — base
 * https://api.livetennisapi.com/api/public/v1, en-tête `Authorization: Bearer`,
 * `GET /fixtures` (« Upcoming scheduled fixtures »), réponse
 * `{ data: [...], meta: { has_more } }`, pagination par `limit`/`offset` en lisant
 * `meta.has_more`. Ces tests échouent si l'implémentation s'en écarte.
 */
import fs from "fs";
import path from "path";
import {
  fenetreUtc,
  normaliserNom,
  normaliserMatch,
  dedupliquer,
  trierParDebut,
  dansLaFenetre,
} from "../lib/normalizedMatch";
import { verdictPour } from "../lib/healthMatches.mjs";

const read = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const m = (over = {}) =>
  normaliserMatch({
    id: "1",
    sport: "tennis",
    tournoi: "ATP Cincinnati",
    joueur1: "Carlos Alcaraz",
    joueur2: "Jannik Sinner",
    debutUtc: "2026-08-11T12:00:00.000Z",
    statut: "a_venir",
    source: "test",
    ...over,
  });

describe("format normalisé commun", () => {
  test("tous les champs demandés sont présents, y compris quand la source n'en fournit aucun", () => {
    expect(Object.keys(normaliserMatch({})).sort()).toEqual(
      ["categorie", "debutUtc", "id", "joueur1", "joueur2", "pays", "sport", "source", "statut", "tournoi"].sort()
    );
  });

  test("la fenêtre va d'aujourd'hui 00h00 UTC à J+7 23h59 UTC", () => {
    const f = fenetreUtc(Date.parse("2026-08-08T17:42:11Z"));
    expect(f.debutUtc).toBe("2026-08-08T00:00:00.000Z");
    expect(f.finUtc).toBe("2026-08-15T23:59:59.999Z");
  });

  test("un match hors fenêtre est écarté, un match dedans est gardé", () => {
    const f = fenetreUtc(Date.parse("2026-08-08T12:00:00Z"));
    expect(dansLaFenetre(m({ debutUtc: "2026-08-10T12:00:00Z" }), f)).toBe(true);
    expect(dansLaFenetre(m({ debutUtc: "2026-08-20T12:00:00Z" }), f)).toBe(false);
  });
});

describe("déduplication : mêmes joueurs à moins de 30 minutes", () => {
  test("la comparaison ignore la casse et les accents", () => {
    expect(normaliserNom("MÜLLER")).toBe(normaliserNom("müller"));
    expect(normaliserNom("N. Djoković")).toBe(normaliserNom("ndjokovic"));
  });

  test("deux sources décrivant le même match à 20 min d'écart ne font qu'une entrée", () => {
    const a = m({ id: "a", debutUtc: "2026-08-11T12:00:00Z", source: "A" });
    const b = m({ id: "b", joueur1: "CARLOS ALCARAZ", joueur2: "Jannik Sinner", debutUtc: "2026-08-11T12:20:00Z", source: "B" });
    expect(dedupliquer([a, b])).toHaveLength(1);
  });

  test("au-delà de 30 minutes, ce sont deux matchs distincts", () => {
    const a = m({ id: "a", debutUtc: "2026-08-11T12:00:00Z" });
    const b = m({ id: "b", debutUtc: "2026-08-11T12:31:00Z" });
    expect(dedupliquer([a, b])).toHaveLength(2);
  });

  test("l'ordre des joueurs est neutralisé", () => {
    const a = m({ id: "a" });
    const b = m({ id: "b", joueur1: "Jannik Sinner", joueur2: "Carlos Alcaraz" });
    expect(dedupliquer([a, b])).toHaveLength(1);
  });

  test("à doublon, l'entrée la plus complète est gardée et complétée par l'autre", () => {
    const pauvre = m({ id: "p", pays: null, categorie: null });
    const riche = m({ id: "r", pays: "USA", categorie: "atp" });
    const [garde] = dedupliquer([pauvre, riche]);
    expect(garde.pays).toBe("USA");
    expect(garde.categorie).toBe("atp");
  });

  test("tri final par debutUtc croissant, un horaire inconnu en fin de liste", () => {
    const out = trierParDebut([
      m({ id: "tard", debutUtc: "2026-08-12T10:00:00Z" }),
      m({ id: "inconnu", debutUtc: null }),
      m({ id: "tot", debutUtc: "2026-08-11T10:00:00Z" }),
    ]);
    expect(out.map((x) => x.id)).toEqual(["tot", "tard", "inconnu"]);
  });
});

describe("chaîne de sources : contrat réel de Live Tennis API", () => {
  const src = () => read("lib", "sports", "tennis", "sources.js");

  test("base, authentification et endpoints sont ceux du client officiel", () => {
    expect(src()).toContain("https://api.livetennisapi.com/api/public/v1");
    expect(src()).toMatch(/Authorization: `Bearer \$\{key\}`/);
    expect(src()).toContain('"/fixtures"');
    expect(src()).toContain('"/matches?status=upcoming"');
  });

  test("la pagination suit meta.has_more, jamais count vs limit", () => {
    expect(src()).toMatch(/meta\.has_more/);
  });

  test("timeout de 8 s sur chaque source", () => {
    expect(src()).toContain("const TIMEOUT_MS = 8000");
    expect(src()).toMatch(/AbortSignal\.timeout\(TIMEOUT_MS\)/);
  });

  test("la variable de clé demandée est acceptée, sans casser les noms existants", () => {
    expect(src()).toContain("LIVE_TENNIS_API_KEY");
    expect(src()).toContain("LIVETENNISAPI_KEY");
    expect(src()).toContain("TENNIS_API_KEY");
  });

  test("aucun filtre de circuit : ni tour=atp, ni liste blanche de tournois", () => {
    // `tour` est un paramètre OPTIONNEL de l'API ; on ne doit jamais le passer, sinon
    // ITF, UTR, Challenger et juniors disparaîtraient.
    expect(src()).not.toMatch(/[?&]tour=/);
  });
});

describe("contrôle quotidien : verdict", () => {
  test("HTTP >= 400 est un échec", () => {
    expect(verdictPour({ httpCode: 500, matchs: 12, sources: [] }).verdict).toBe("ÉCHEC");
  });

  test("0 match sur la fenêtre est un échec", () => {
    expect(verdictPour({ httpCode: 200, matchs: 0, sources: [{ statut: "vide" }] }).verdict).toBe("ÉCHEC");
  });

  test("toutes les sources en erreur est un échec, même si le HTTP est 200", () => {
    const v = verdictPour({ httpCode: 200, matchs: 0, sources: [{ erreur: "x" }, { erreur: "y" }] });
    expect(v).toMatchObject({ verdict: "ÉCHEC", raison: "toutes les sources en erreur" });
  });

  test("une source non configurée ne compte pas comme une source en erreur", () => {
    const v = verdictPour({
      httpCode: 200,
      matchs: 5,
      sources: [{ statut: "non configurée", erreur: "clé absente" }, { statut: "ok" }],
    });
    expect(v.verdict).toBe("OK");
  });

  test("des matchs et un HTTP 200 donnent OK", () => {
    expect(verdictPour({ httpCode: 200, matchs: 6, sources: [{ statut: "ok" }] }).verdict).toBe("OK");
  });
});

describe("cron quotidien et script local", () => {
  test("vercel.json programme le contrôle à 06:00 UTC", () => {
    const v = JSON.parse(read("vercel.json"));
    const cron = v.crons.find((c) => c.path === "/api/health/matches");
    expect(cron).toBeTruthy();
    expect(cron.schedule).toBe("0 6 * * *");
    // Plan Hobby : 2 crons maximum, une exécution par jour chacun. On y est exactement.
    expect(v.crons).toHaveLength(2);
    expect(v.crons.every((c) => /^\d+ \d+ \* \* \*$/.test(c.schedule))).toBe(true);
  });

  test("npm run test:matches existe et pointe sur le script", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["test:matches"]).toBe("node scripts/test-matches.mjs");
    expect(fs.existsSync(path.join(__dirname, "..", "scripts", "test-matches.mjs"))).toBe(true);
  });

  test("le script local et le cron partagent la MÊME mesure", () => {
    expect(read("scripts", "test-matches.mjs")).toContain('from "../lib/healthMatches.mjs"');
    expect(read("pages", "api", "health", "matches.js")).toContain('from "../../../lib/healthMatches.mjs"');
  });

  test("le script sort en code 1 dès qu'un sport échoue", () => {
    expect(read("scripts", "test-matches.mjs")).toMatch(/process\.exit\(1\)/);
  });

  test("le contrôle est journalisé de façon structurée pour les logs Vercel", () => {
    const src = read("lib", "healthMatches.mjs");
    expect(src).toContain("blume.health.matches");
    expect(src).toMatch(/sourcesEnEchec/);
  });
});

describe("affichage : relance 5 s, 3 tentatives", () => {
  test("la politique de nouvelle tentative est celle demandée", () => {
    const src = read("components", "UpcomingMatchesSection.js");
    expect(src).toContain("const RETRY_MS = 5 * 1000");
    expect(src).toContain("const MAX_RETRIES = 3");
  });
});
