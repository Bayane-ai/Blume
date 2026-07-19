// Parcours E2E complet du site Blume, contre un serveur local (next dev) avec
// /api/* simulé via l'interception réseau de Playwright (e2e/mockApi.js) — le vrai
// football-data.org est injoignable depuis cet environnement de développement.
// L'authentification Supabase est simulée en remplaçant temporairement
// lib/supabaseClient.js par un client factice déjà connecté (backup/restauration
// autour de l'exécution de cette suite) : le code applicatif réel n'est jamais modifié.
//
// PROMPT 2 du plan : la navigation ne comporte plus que deux boutons ("Matchs en
// ligne" / "Matchs à venir") — les écrans Compétitions et Analyse IA de l'ancienne
// maquette de référence ont été retirés en conséquence (voir CLAUDE.md/historique).
const { test, expect } = require("@playwright/test");
const { installApiMocks } = require("./mockApi");

function trackErrors(page) {
  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("requestfailed", (req) => {
    if (req.failure()?.errorText !== "net::ERR_ABORTED") failedRequests.push(req.url());
  });
  return { consoleErrors, failedRequests };
}

test.beforeEach(async ({ page }) => {
  await installApiMocks(page);
});

test.describe("Écran 1 — Matchs en ligne (accueil)", () => {
  test("en-tête, navigation à deux boutons, hero, match phare réel, barre de recherche", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");

    await expect(page.getByText("Blume", { exact: true })).toBeVisible();
    await expect(page.getByText("test@example.com")).toBeVisible();
    await expect(page.getByRole("button", { name: "Déconnexion", exact: true })).toBeVisible();

    // Navigation : exactement deux boutons.
    const nav = page.getByTestId("main-nav");
    await expect(nav.getByRole("link")).toHaveCount(2);
    await expect(nav.getByRole("link", { name: "Matchs en ligne" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Matchs à venir" })).toBeVisible();

    await expect(page.getByRole("heading", { name: /football en direct/i })).toBeVisible();

    // Match phare : un vrai match en direct (le premier de la liste simulée).
    const featured = page.getByTestId("featured-match");
    await expect(featured.getByText("EN DIRECT", { exact: true })).toBeVisible();
    await expect(featured.getByText("Arsenal FC")).toBeVisible();

    await expect(page.getByText("Les plus populaires", { exact: true })).toBeVisible();
    await expect(page.getByText("Live : 3", { exact: true })).toBeVisible();

    await expect(page.locator('input[type="text"], input:not([type])').first()).toBeVisible();

    expect(errors.consoleErrors, `Erreurs console : ${errors.consoleErrors.join(" | ")}`).toEqual([]);
    expect(errors.failedRequests, `Requêtes en échec : ${errors.failedRequests.join(" | ")}`).toEqual([]);
  });

  test("chaque carte de match : compétition, équipes, LIVE+minute, score en direct, ANALYSER dans le même bloc", async ({ page }) => {
    await page.goto("/");

    const list = page.getByTestId("match-list");
    await expect(list.getByText("ANALYSER")).toHaveCount(3);
    await expect(list.getByText("Premier League")).toBeVisible();
    await expect(list.getByText(/LIVE · 32/)).toBeVisible();
    await expect(list.getByText("1 : 0", { exact: true })).toBeVisible();
  });

  test("BLOC 4 : affiche des matchs de compétitions variées du monde entier, pas seulement les grandes ligues européennes", async ({ page }) => {
    await page.goto("/");
    const list = page.getByTestId("match-list");

    await expect(list.getByText("Premier League")).toBeVisible();
    await expect(list.getByText("LaLiga")).toBeVisible();
    // Compétition sud-américaine, hors des "grandes ligues" européennes habituelles.
    await expect(list.getByText("Campeonato Brasileiro Série A")).toBeVisible();
    await expect(list.getByText("Flamengo")).toBeVisible();

    // Elle apparaît aussi comme un vrai filtre de compétition (PROMPT 6), pas
    // seulement dans la liste.
    await expect(page.getByTestId("competition-filter").getByRole("button", { name: "Campeonato Brasileiro Série A" })).toBeVisible();
  });
});

test.describe("Écran 2 — Matchs à venir", () => {
  test('le bouton "Matchs à venir" mène à une vraie page listant les vrais matchs programmés, sans score', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");

    await page.getByTestId("main-nav").getByRole("link", { name: "Matchs à venir" }).click();
    await expect(page).toHaveURL("/a-venir");

    await expect(page.getByRole("heading", { name: /matchs à venir/i })).toBeVisible();

    const nav = page.getByTestId("main-nav");
    await expect(nav.getByRole("link", { name: "Matchs à venir" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Matchs en ligne" })).toBeVisible();

    const list = page.getByTestId("match-list");
    await expect(list.getByText("Liverpool FC")).toBeVisible();
    await expect(list.getByText("ANALYSER").first()).toBeVisible();
    // Aucun score affiché pour un match pas encore joué.
    await expect(list.getByText(/^\d{1,2}\s*:\s*\d{1,2}$/)).toHaveCount(0);

    expect(errors.consoleErrors, `Erreurs console : ${errors.consoleErrors.join(" | ")}`).toEqual([]);
  });

  test('revenir sur "Matchs en ligne" depuis "Matchs à venir" affiche de nouveau les matchs en direct', async ({ page }) => {
    await page.goto("/a-venir");
    await page.getByTestId("main-nav").getByRole("link", { name: "Matchs en ligne" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByTestId("match-list").getByText("Arsenal FC").first()).toBeVisible();
  });
});

test.describe("PROMPT 6 — Carrousels de compétitions et de journées", () => {
  test('"Matchs en ligne" : chaque bouton de compétition filtre réellement la liste, chaque bouton de journée aussi', async ({ page }) => {
    await page.goto("/");
    const compCarousel = page.getByTestId("competition-filter");
    const list = page.getByTestId("match-list");

    await expect(compCarousel.getByRole("button", { name: "Premier League" })).toBeVisible();
    await expect(compCarousel.getByRole("button", { name: "LaLiga" })).toBeVisible();
    // Aucune compétition sans match réel derrière (Bundesliga n'a aucun match en direct ici).
    await expect(compCarousel.getByRole("button", { name: "Bundesliga" })).toHaveCount(0);
    // Pas de carrousel de journées tant qu'aucune compétition n'est choisie.
    await expect(page.getByTestId("matchday-filter")).toHaveCount(0);

    await compCarousel.getByRole("button", { name: "LaLiga" }).click();
    await expect(list.getByText("Real Madrid")).toBeVisible();
    await expect(list.getByText("Arsenal FC")).toHaveCount(0);

    await compCarousel.getByRole("button", { name: "Premier League" }).click();
    const mdCarousel = page.getByTestId("matchday-filter");
    await expect(mdCarousel.getByRole("button", { name: "Journée 25" })).toBeVisible();
    await mdCarousel.getByRole("button", { name: "Journée 25" }).click();
    await expect(list.getByText("Arsenal FC")).toBeVisible();
  });

  test('"Matchs à venir" : filtre par compétition puis par journée, sur de vraies compétitions et journées', async ({ page }) => {
    await page.goto("/a-venir");
    const compCarousel = page.getByTestId("competition-filter");
    const list = page.getByTestId("match-list");

    await compCarousel.getByRole("button", { name: "Premier League" }).click();
    const mdCarousel = page.getByTestId("matchday-filter");
    await expect(mdCarousel.getByRole("button", { name: "Journée 27" })).toBeVisible();
    await mdCarousel.getByRole("button", { name: "Journée 27" }).click();
    // Les deux matchs réels de cette journée sont bien affichés.
    await expect(list.getByText("Liverpool FC")).toBeVisible();
    await expect(list.getByText("Newcastle United FC")).toBeVisible();

    // Coupe du Monde (phase à élimination directe, pas de champ "journée" exploitable) :
    // aucun carrousel de journées vide ne doit s'afficher — pas de bouton sans effet.
    await compCarousel.getByRole("button", { name: "Coupe du Monde" }).click();
    await expect(list.getByText("France")).toBeVisible();
    await expect(page.getByTestId("matchday-filter")).toHaveCount(0);
  });
});

test.describe("Écran 3 — Analyser un match", () => {
  test("clic ANALYSER depuis Matchs en ligne : une seule navigation vers les pronostics, tous les champs sont remplis", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");

    await page.getByTestId("match-list").getByText("ANALYSER").first().click();
    await expect(page).toHaveURL(/\/match\/101/);

    await expect(page.getByTestId("prob-home")).toBeVisible();
    await expect(page.getByTestId("prob-draw")).toBeVisible();
    await expect(page.getByTestId("prob-away")).toBeVisible();
    await expect(page.getByTestId("stat-goals")).toBeVisible();
    await expect(page.getByTestId("stat-corners")).toBeVisible();
    await expect(page.getByTestId("stat-shots")).toBeVisible();
    await expect(page.getByTestId("stat-cards")).toBeVisible();
    await expect(page.getByTestId("stat-possession")).toBeVisible();
    // Au moins 3 scores exacts, du plus probable au moins probable (PROMPT 5).
    const scoreCells = page.getByTestId("correct-scores").locator("div");
    expect(await scoreCells.count()).toBeGreaterThanOrEqual(3);

    // Chaque équipe a ses propres statistiques affichées séparément (pas seulement
    // un total combiné) : Arsenal (domicile) et Chelsea (extérieur) ont chacun leur
    // propre bloc, avec leurs propres valeurs.
    const teamStats = page.getByTestId("team-stats");
    await expect(teamStats.getByText("Arsenal FC")).toBeVisible();
    await expect(teamStats.getByText("Chelsea FC")).toBeVisible();
    await expect(page.getByTestId("team-goals-home")).toBeVisible();
    await expect(page.getByTestId("team-goals-away")).toBeVisible();

    // Seules les 3 probabilités de victoire sont en "%" — buts/corners/tirs/cartons/
    // possession/tendances/scores sont des intervalles ou estimations.
    await expect(page.getByTestId("stat-goals")).toContainText(/^entre \d+ et \d+$/);
    await expect(page.getByTestId("stat-corners")).toContainText(/^environ \d+-\d+$/);
    await expect(page.getByTestId("stat-possession")).not.toContainText("%");
    await expect(page.getByTestId("correct-scores")).not.toContainText("%");
    await expect(page.getByTestId("stat-over25")).toContainText(/^\d+\.\d\/10$/);

    expect(errors.consoleErrors, `Erreurs console : ${errors.consoleErrors.join(" | ")}`).toEqual([]);
  });

  test("clic ANALYSER depuis Matchs à venir : navigue vers les pronostics du bon match, sans aucun score affiché (pas encore joué)", async ({ page }) => {
    await page.goto("/a-venir");
    await page.getByTestId("match-list").getByText("ANALYSER").first().click();
    await expect(page).toHaveURL(/\/match\/201/);
    await expect(page.getByText("Liverpool FC").first()).toBeVisible();

    // Match pas encore commencé : aucun score réel dans l'en-tête, l'heure du coup
    // d'envoi s'affiche à la place.
    await expect(page.getByTestId("live-score")).toHaveCount(0);
    await expect(page.getByTestId("header-kickoff")).toBeVisible();
    await expect(page.getByTestId("prob-home")).toBeVisible();
  });

  test("PROMPT 5 : ouvrir les pronostics de 3 matchs différents affiche bien 3 jeux de chiffres différents", async ({ page }) => {
    async function readAnalysis() {
      return {
        home: await page.getByTestId("prob-home").textContent(),
        goals: await page.getByTestId("stat-goals").textContent(),
        shots: await page.getByTestId("stat-shots").textContent(),
      };
    }

    await page.goto("/");
    await page.getByTestId("match-list").getByText("ANALYSER").first().click(); // match 101, Arsenal-Chelsea
    await expect(page).toHaveURL(/\/match\/101/);
    const a1 = await readAnalysis();

    await page.goto("/");
    await page.getByTestId("match-list").getByText("ANALYSER").nth(1).click(); // match 102, Real Madrid-Barcelone
    await expect(page).toHaveURL(/\/match\/102/);
    const a2 = await readAnalysis();

    await page.goto("/a-venir");
    await page.getByTestId("match-list").getByText("ANALYSER").first().click(); // match 201, Liverpool-Man City
    await expect(page).toHaveURL(/\/match\/201/);
    const a3 = await readAnalysis();

    expect(a1.home).not.toBe(a2.home);
    expect(a1.home).not.toBe(a3.home);
    expect(a2.home).not.toBe(a3.home);

    // Régression : le total de tirs (et de buts attendus) ne doit plus être une
    // quasi-constante recopiée sur tous les matchs.
    const fingerprints = [a1, a2, a3].map((a) => `${a.home}|${a.goals}|${a.shots}`);
    expect(new Set(fingerprints).size).toBe(3);
  });
});

test.describe("Écran 3 — Page détail d'un match", () => {
  test("équipes, forme récente, coup d'envoi/stade/arbitre, flèche de retour fonctionnelle", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("match-list").getByText("ANALYSER").first().click();
    await expect(page).toHaveURL(/\/match\/101/);

    await expect(page.getByText("Arsenal FC").first()).toBeVisible();
    await expect(page.getByText("Chelsea FC").first()).toBeVisible();
    // Forme récente : au moins un badge W et un badge L visibles.
    await expect(page.getByText("W", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Emirates Stadium", { exact: true })).toBeVisible();
    await expect(page.getByText("Michael Oliver", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Retour" }).click();
    await expect(page).toHaveURL("/");
  });
});

test.describe("BLOC — En-tête et timeline d'un match en direct", () => {
  test("l'en-tête d'un match en direct affiche le vrai score et la vraie minute, et se met à jour tout seul", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");
    await page.getByTestId("match-list").getByText("ANALYSER").first().click(); // match 101, IN_PLAY, 1-0, 32'
    await expect(page).toHaveURL(/\/match\/101/);

    // Flèche de retour + compétition centrée en haut de l'en-tête.
    await expect(page.getByRole("button", { name: "Retour" })).toBeVisible();
    await expect(page.locator("header", { hasText: "Premier League" })).toBeVisible();

    // Score réel au centre, au format "X - X", minute en direct juste en dessous.
    await expect(page.getByTestId("live-score")).toHaveText("1 - 0");
    await expect(page.getByTestId("live-minute")).toHaveText("32’");

    expect(errors.consoleErrors, `Erreurs console : ${errors.consoleErrors.join(" | ")}`).toEqual([]);
  });

  test('BLOC 3 : sans événements fournis par l\'API (le cas réel aujourd\'hui), la timeline affiche un message clair — jamais une section vide ni une erreur', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");
    await page.getByTestId("match-list").getByText("ANALYSER").nth(2).click(); // match 103, Flamengo-Palmeiras
    await expect(page).toHaveURL(/\/match\/103/);

    await expect(page.getByRole("heading", { name: "Moments forts" })).toBeVisible();
    await expect(page.getByTestId("timeline-empty")).toHaveText("Événements non disponibles pour ce match.");
    await expect(page.getByTestId("match-timeline")).toHaveCount(0);

    expect(errors.consoleErrors, `Erreurs console : ${errors.consoleErrors.join(" | ")}`).toEqual([]);
  });
});

test.describe("Écran 4 — Page d'une compétition (accessible par lien direct)", () => {
  test("Calendrier / Résultats / Classement contiennent chacun du vrai contenu", async ({ page }) => {
    await page.goto("/competition/PL");

    await expect(page.getByRole("heading", { name: "Premier League" })).toBeVisible();
    await expect(page.getByText("Liverpool FC")).toBeVisible(); // Calendrier (par défaut)

    await page.getByRole("button", { name: "Résultats", exact: true }).click();
    await expect(page.getByText("Arsenal FC").first()).toBeVisible();
    await expect(page.getByText("3 : 1", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Classement", exact: true }).click();
    await expect(page.getByText("Arsenal FC").first()).toBeVisible();
    await expect(page.getByText("55", { exact: true })).toBeVisible(); // points réels
  });

  test("compétition sans classement structuré (Coupe du Monde) : message clair, pas de plantage", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/competition/WC");

    await page.getByRole("button", { name: "Classement", exact: true }).click();
    await expect(page.getByText(/classement indisponible/i)).toBeVisible();

    expect(errors.consoleErrors, `Erreurs console : ${errors.consoleErrors.join(" | ")}`).toEqual([]);
  });
});
