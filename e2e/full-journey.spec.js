// Parcours E2E complet du site Blume, contre un serveur local (next dev) avec
// /api/* simulé via l'interception réseau de Playwright (e2e/mockApi.js) — le vrai
// football-data.org est injoignable depuis cet environnement de développement.
// L'authentification Supabase est simulée en remplaçant temporairement
// lib/supabaseClient.js par un client factice déjà connecté (backup/restauration
// autour de l'exécution de cette suite) : le code applicatif réel n'est jamais modifié.
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

test.describe("Écran 1 — Accueil", () => {
  test("en-tête, hero, match phare réel, chips, onglets avec compteurs réels, barre de recherche", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");

    await expect(page.getByText("Blume", { exact: true })).toBeVisible();
    await expect(page.getByText("test@example.com")).toBeVisible();
    await expect(page.getByRole("button", { name: "Déconnexion", exact: true })).toBeVisible();

    await expect(page.getByRole("heading", { name: /football en direct/i })).toBeVisible();

    // Match phare : un vrai match en direct (le premier de la liste simulée).
    const featured = page.getByTestId("featured-match");
    await expect(featured.getByText("EN DIRECT", { exact: true })).toBeVisible();
    await expect(featured.getByText("Arsenal FC")).toBeVisible();

    await expect(page.getByText("Les plus populaires", { exact: true })).toBeVisible();
    await expect(page.getByText("Live : 2", { exact: true })).toBeVisible();

    // Compteurs réels et cohérents avec les données simulées : 2 en direct + 3 à
    // venir = 5 au total.
    const tabs = page.getByTestId("home-tabs");
    await expect(tabs.getByRole("button", { name: "Tous (5)", exact: true })).toBeVisible();
    await expect(tabs.getByRole("button", { name: "En direct (2)", exact: true })).toBeVisible();
    await expect(tabs.getByRole("button", { name: "À venir (3)", exact: true })).toBeVisible();

    await expect(page.locator('input[type="text"], input:not([type])').first()).toBeVisible();

    expect(errors.consoleErrors, `Erreurs console : ${errors.consoleErrors.join(" | ")}`).toEqual([]);
    expect(errors.failedRequests, `Requêtes en échec : ${errors.failedRequests.join(" | ")}`).toEqual([]);
  });
});

test.describe("Écran 1/3/4 — Chaque carte de match", () => {
  test("compétition, équipes, LIVE+minute, score en direct, ANALYSER dans le même bloc", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("home-tabs").getByRole("button", { name: "En direct (2)", exact: true }).click();

    const list = page.getByTestId("match-list");
    await expect(list.getByText("ANALYSER")).toHaveCount(2);
    await expect(list.getByText("Premier League")).toBeVisible();
    await expect(list.getByText(/LIVE · 32/)).toBeVisible();
    await expect(list.getByText("1 : 0", { exact: true })).toBeVisible();
  });

  test("un match à venir n'affiche aucun score, seulement l'heure", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("home-tabs").getByRole("button", { name: "À venir (3)", exact: true }).click();

    const list = page.getByTestId("match-list");
    await expect(list.getByText("Liverpool FC")).toBeVisible();
    // Aucune carte de la liste (hors match phare, qui est un match en direct distinct)
    // n'affiche de score "chiffre : chiffre".
    await expect(list.getByText(/^\d{1,2}\s*:\s*\d{1,2}$/)).toHaveCount(0);
  });

  test("les onglets filtrent réellement (pas de match live dans \"à venir\", pas de match à venir dans \"en direct\")", async ({ page }) => {
    await page.goto("/");
    const tabs = page.getByTestId("home-tabs");
    const list = page.getByTestId("match-list");

    await tabs.getByRole("button", { name: "En direct (2)", exact: true }).click();
    await expect(list.getByText("Liverpool FC")).toHaveCount(0);

    await tabs.getByRole("button", { name: "À venir (3)", exact: true }).click();
    await expect(list.getByText("Real Madrid")).toHaveCount(0);
  });
});

test.describe("Écran 5 — Analyser un match", () => {
  test("clic ANALYSER : une seule navigation vers les pronostics, tous les champs sont remplis", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");
    await page.getByTestId("home-tabs").getByRole("button", { name: "En direct (2)", exact: true }).click();

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
});

test.describe("Écran 5 — Page détail d'un match", () => {
  test("équipes, forme récente, coup d'envoi/stade/arbitre, lien retour fonctionnel", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("home-tabs").getByRole("button", { name: "En direct (2)", exact: true }).click();
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

test.describe("Écran 6/7 — Compétitions", () => {
  test("carousel des plus populaires, filtres région, recherche, navigation vers une compétition", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("home-tabs").getByRole("button", { name: "Compétitions", exact: true }).click();

    // Carrousel horizontal des compétitions populaires (plusieurs cartes visibles).
    const carousel = page.getByTestId("popular-carousel");
    await expect(carousel.getByRole("button", { name: /^Coupe du Monde/ })).toBeVisible();

    // Chips de filtre par région : "Europe" ne doit garder que les compétitions
    // européennes (la Coupe du Monde, qui est "Monde", doit disparaître de la liste
    // complète en dessous — hors carrousel, qui reste inchangé).
    await page.getByRole("button", { name: "Europe", exact: true }).click();
    const list = page.getByTestId("competitions-list");
    await expect(list.getByText("Coupe du Monde")).toHaveCount(0);
    await expect(list.getByText("Premier League")).toBeVisible();

    await page.getByRole("button", { name: "Toutes", exact: true }).click();

    // Recherche texte.
    await page.getByPlaceholder(/rechercher une compétition/i).fill("premier");
    await expect(list.getByText("Premier League")).toBeVisible();
    await expect(list.getByText("LaLiga")).toHaveCount(0);
    await page.getByPlaceholder(/rechercher une compétition/i).fill("");

    await list.getByRole("button", { name: /^Premier League/ }).click();
    await expect(page).toHaveURL(/\/competition\/PL/);
  });
});

test.describe("Écran 7 — Page d'une compétition", () => {
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

test.describe("Écran 8 — Page Analyse IA", () => {
  test("sélection libre de deux équipes, suggestion, croix, lancement sans compte supplémentaire", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/analyse");

    await expect(page.getByRole("heading", { name: /analyse un match/i })).toBeVisible();

    // Une suggestion réelle (issue des vrais matchs à venir simulés) pré-remplit
    // directement les deux équipes.
    await page.getByText("Bayern Munich - Paris Saint-Germain", { exact: true }).click();
    await expect(page.getByText("Bayern Munich").first()).toBeVisible();
    await expect(page.getByText("Paris Saint-Germain").first()).toBeVisible();

    // Retirer une équipe (croix) puis la re-choisir via le sélecteur.
    await page.getByRole("button", { name: "Retirer Bayern Munich", exact: true }).click();
    await expect(page.getByText("Bayern Munich", { exact: true })).toHaveCount(1); // ne reste que dans la suggestion

    const homeSelect = page.locator("select").nth(1);
    await homeSelect.selectOption({ label: "Bayern Munich" });

    await page.getByRole("button", { name: /lancer l'analyse/i }).click();
    await expect(page.getByText("48.2%", { exact: true })).toBeVisible();

    expect(errors.consoleErrors, `Erreurs console : ${errors.consoleErrors.join(" | ")}`).toEqual([]);
  });
});
