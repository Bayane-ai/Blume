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
    await expect(page.getByText("Live : 2", { exact: true })).toBeVisible();

    await expect(page.locator('input[type="text"], input:not([type])').first()).toBeVisible();

    expect(errors.consoleErrors, `Erreurs console : ${errors.consoleErrors.join(" | ")}`).toEqual([]);
    expect(errors.failedRequests, `Requêtes en échec : ${errors.failedRequests.join(" | ")}`).toEqual([]);
  });

  test("chaque carte de match : compétition, équipes, LIVE+minute, score en direct, ANALYSER dans le même bloc", async ({ page }) => {
    await page.goto("/");

    const list = page.getByTestId("match-list");
    await expect(list.getByText("ANALYSER")).toHaveCount(2);
    await expect(list.getByText("Premier League")).toBeVisible();
    await expect(list.getByText(/LIVE · 32/)).toBeVisible();
    await expect(list.getByText("1 : 0", { exact: true })).toBeVisible();
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

test.describe("Écran 3 — Analyser un match", () => {
  test("clic ANALYSER depuis Matchs en ligne : une seule navigation vers les pronostics, tous les champs sont remplis", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");

    await page.getByTestId("match-list").getByText("ANALYSER").first().click();
    await expect(page).toHaveURL(/\/match\/101/);

    await expect(page.getByText("48.2%", { exact: true })).toBeVisible();
    await expect(page.getByText("26.1%", { exact: true })).toBeVisible();
    await expect(page.getByText("25.7%", { exact: true })).toBeVisible();
    await expect(page.getByText("2.7", { exact: true }).first()).toBeVisible(); // buts probables (total)
    await expect(page.getByText("10", { exact: true }).first()).toBeVisible(); // corners (total)
    await expect(page.getByText("24", { exact: true }).first()).toBeVisible(); // tirs (total)

    expect(errors.consoleErrors, `Erreurs console : ${errors.consoleErrors.join(" | ")}`).toEqual([]);
  });

  test("clic ANALYSER depuis Matchs à venir : navigue vers les pronostics du bon match, sans aucun score affiché (pas encore joué)", async ({ page }) => {
    await page.goto("/a-venir");
    await page.getByTestId("match-list").getByText("ANALYSER").first().click();
    await expect(page).toHaveURL(/\/match\/201/);
    await expect(page.getByText("Liverpool FC").first()).toBeVisible();

    // Match pas encore commencé : aucun score nulle part, seulement les pronostics.
    await expect(page.getByText(/^\d+\s*:\s*\d+$/)).toHaveCount(0);
  });
});

test.describe("Écran 3 — Page détail d'un match", () => {
  test("équipes, forme récente, coup d'envoi/stade/arbitre, lien retour fonctionnel", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("match-list").getByText("ANALYSER").first().click();
    await expect(page).toHaveURL(/\/match\/101/);

    await expect(page.getByText("Arsenal FC").first()).toBeVisible();
    await expect(page.getByText("Chelsea FC").first()).toBeVisible();
    // Forme récente : au moins un badge W et un badge L visibles.
    await expect(page.getByText("W", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Emirates Stadium", { exact: true })).toBeVisible();
    await expect(page.getByText("Michael Oliver", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: /retour au dashboard/i }).click();
    await expect(page).toHaveURL("/");
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
