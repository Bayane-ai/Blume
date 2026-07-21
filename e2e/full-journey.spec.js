// Parcours E2E complet du site Blume, contre un serveur local (next dev) avec
// /api/* simulé via l'interception réseau de Playwright (e2e/mockApi.js) — le vrai
// football-data.org est injoignable depuis cet environnement de développement.
// L'authentification Supabase est simulée en remplaçant temporairement
// lib/supabaseClient.js par un client factice déjà connecté (backup/restauration
// autour de l'exécution de cette suite) : le code applicatif réel n'est jamais modifié.
//
// La navigation comporte trois boutons ("Live" / "Matchs à venir" / "News") — les
// écrans Compétitions et Analyse IA de l'ancienne maquette de référence ont été
// retirés en conséquence (voir CLAUDE.md/historique).
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

    // Navigation : exactement cinq boutons.
    const nav = page.getByTestId("main-nav");
    await expect(nav.getByRole("link")).toHaveCount(5);
    const liveLink = nav.getByRole("link", { name: "Live" });
    await expect(liveLink).toBeVisible();
    // Bouton "Live" marqué visuellement par un point rouge à côté du texte.
    await expect(liveLink.locator("span").first()).toBeVisible();
    await expect(nav.getByRole("link", { name: "Matchs à venir" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "News" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Probabilités réussies" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Probabilités échouées" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Probabilités réussies" })).toHaveAttribute("href", "/probabilites-reussies");
    await expect(nav.getByRole("link", { name: "Probabilités échouées" })).toHaveAttribute("href", "/probabilites-echouees");

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
    await expect(list.getByText("1 - 0", { exact: true })).toBeVisible();
    // Minute en rouge à côté du score (badge dédié, distinct du bandeau LIVE du haut).
    await expect(list.getByTestId("card-minute").first()).toHaveText("32’");
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
    await expect(nav.getByRole("link", { name: "Live" })).toBeVisible();

    const list = page.getByTestId("match-list");
    await expect(list.getByText("Liverpool FC")).toBeVisible();
    await expect(list.getByText("ANALYSER").first()).toBeVisible();
    // Aucun score affiché pour un match pas encore joué.
    await expect(list.getByText(/^\d{1,2}\s*:\s*\d{1,2}$/)).toHaveCount(0);

    expect(errors.consoleErrors, `Erreurs console : ${errors.consoleErrors.join(" | ")}`).toEqual([]);
  });

  test('revenir sur "Live" depuis "Matchs à venir" affiche de nouveau les matchs en direct', async ({ page }) => {
    await page.goto("/a-venir");
    await page.getByTestId("main-nav").getByRole("link", { name: "Live" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByTestId("match-list").getByText("Arsenal FC").first()).toBeVisible();
  });
});

test.describe("Écran — News", () => {
  test('le bouton "News" mène à une vraie page listant les actualités, triées par importance, chaque carte cliquable', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");

    await page.getByTestId("main-nav").getByRole("link", { name: "News", exact: true }).click();
    await expect(page).toHaveURL("/news");
    await expect(page.getByRole("heading", { name: /actualités football/i })).toBeVisible();

    const list = page.getByTestId("news-list");
    const cards = list.getByTestId("news-card");
    await expect(cards).toHaveCount(2);

    // Tri : la grosse actualité (transfert, Champions League) apparaît avant
    // l'actualité mineure (amical de deuxième division) — voir e2e/mockApi.js.
    await expect(cards.first()).toContainText("Real Madrid officialise le transfert");
    await expect(cards.last()).toContainText("Match amical de pré-saison");

    // Chaque carte est un vrai lien cliquable vers l'article réel.
    await expect(cards.first()).toHaveAttribute("href", "https://example.com/news/major");
    await expect(cards.first()).toHaveAttribute("target", "_blank");

    // Navigation toujours intacte depuis l'onglet News.
    const nav = page.getByTestId("main-nav");
    await expect(nav.getByRole("link", { name: "Live" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Matchs à venir" })).toBeVisible();

    expect(errors.consoleErrors, `Erreurs console : ${errors.consoleErrors.join(" | ")}`).toEqual([]);
  });

  test("aucune actualité disponible : message clair, jamais une page blanche", async ({ page }) => {
    await page.route("**/api/news", (route) => route.fulfill({ json: { articles: [] } }));
    await page.goto("/news");
    await expect(page.getByText("Aucune actualité disponible pour le moment.")).toBeVisible();
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
    await compCarousel.getByRole("button", { name: "Coupe du Monde", exact: true }).click();
    await expect(list.getByText("France")).toBeVisible();
    await expect(page.getByTestId("matchday-filter")).toHaveCount(0);
  });

  test('"Matchs à venir" affiche bien des compétitions de plusieurs fédérations différentes, y compris celles absentes de la liste des compétitions majeures connues — mais jamais une catégorie jeune (non pariable)', async ({ page }) => {
    await page.goto("/a-venir");
    const compCarousel = page.getByTestId("competition-filter");
    const list = page.getByTestId("match-list");

    // Par défaut ("Toutes les compétitions"), les matchs de fédérations variées sont
    // déjà tous affichés ensemble, sans action de l'utilisateur.
    await expect(list.getByText("Boca Juniors")).toBeVisible(); // Copa Libertadores (CONMEBOL)

    // "Les matchs sur lesquels on peut parier" : la Coupe du Monde U20 (catégorie
    // jeune, jamais proposée par un bookmaker) n'apparaît nulle part, ni dans la
    // liste, ni comme bouton de filtre — alors que Copa Libertadores, elle, absente
    // de lib/competitions.js mais bien senior/pro, reste affichée.
    await expect(list.getByText("Argentine U20")).toHaveCount(0);
    await expect(compCarousel.getByRole("button", { name: "Copa Libertadores" })).toBeVisible();
    await expect(compCarousel.getByRole("button", { name: "Coupe du Monde U20" })).toHaveCount(0);

    await compCarousel.getByRole("button", { name: "Copa Libertadores" }).click();
    await expect(list.getByText("Boca Juniors")).toBeVisible();
    await expect(list.getByText("River Plate")).toBeVisible();
  });
});

test.describe("Écran 3 — Analyser un match", () => {
  test("clic ANALYSER depuis Matchs en ligne : une seule navigation vers les pronostics, tous les champs sont remplis", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");

    await page.getByTestId("match-list").getByText("ANALYSER").first().click();
    await expect(page).toHaveURL(/\/match\/101/);

    // Structure exacte "app de paris sportifs" : 1X2, puis Total/Total 1/Total 2/Tirs
    // (lignes "Plus de X,X" / "Moins de X,X", jamais une cote), puis 3 à 4 scores
    // exacts. Corners/cartons jaunes/rouges et passes décisives ont leur propre bloc
    // en bas de page.
    await expect(page.getByTestId("prob-home")).toContainText(/^Victoire .+ : \d+(\.\d+)? %$/);
    await expect(page.getByTestId("prob-draw")).toContainText(/^Match nul : \d+(\.\d+)? %$/);
    await expect(page.getByTestId("prob-away")).toContainText(/^Victoire .+ : \d+(\.\d+)? %$/);

    const lineFormat = /: (Plus|Moins) de \d+,5( \(ou \d+,5\))?$/;
    await expect(page.getByTestId("market-total")).toContainText(lineFormat);
    await expect(page.getByTestId("market-total-1")).toContainText(lineFormat);
    await expect(page.getByTestId("market-total-2")).toContainText(lineFormat);
    await expect(page.getByTestId("market-shots")).toContainText(lineFormat);
    await expect(page.getByTestId("market-shots-on-target")).toContainText(lineFormat);
    // Total 1 (domicile) et Total 2 (extérieur) ne sont jamais la même ligne recopiée.
    const totalHomeText = await page.getByTestId("market-total-1").textContent();
    const totalAwayText = await page.getByTestId("market-total-2").textContent();
    expect(totalHomeText.replace("Total 1", "")).not.toBe(totalAwayText.replace("Total 2", ""));

    // Entre 3 et 4 scores exacts, du plus probable au moins probable (PROMPT 5).
    const scoreCells = page.getByTestId("correct-scores").locator("div");
    const scoreCount = await scoreCells.count();
    expect(scoreCount).toBeGreaterThanOrEqual(3);
    expect(scoreCount).toBeLessThanOrEqual(4);

    // Bloc "Cartons" (en bas de page) : pour cartons jaunes et cartons rouges, une
    // option "Sûr" et une option "Risqué", toutes deux en ligne "Plus/Moins de X,5"
    // (jamais une cote).
    const riskFormat = /Sûr (Plus|Moins) de \d+,5.*Risqué (Plus|Moins) de \d+,5/s;
    await expect(page.getByTestId("market-yellow-cards")).toContainText(riskFormat);
    await expect(page.getByTestId("market-red-card")).toContainText(riskFormat);

    // Blocs Corners / Hors-jeu / Fautes / Touches (Total match + Total 1 + Total 2 +
    // mi-temps, figés une seule fois avant le match — même structure pour les 4).
    const lineFormatSingle = /: (Plus|Moins) de \d+,5$/;
    for (const prefix of ["stat-corners", "stat-offsides", "stat-fouls", "stat-throwins"]) {
      await expect(page.getByTestId(`${prefix}-total`)).toHaveText(lineFormatSingle);
      await expect(page.getByTestId(`${prefix}-home`)).toHaveText(lineFormatSingle);
      await expect(page.getByTestId(`${prefix}-away`)).toHaveText(lineFormatSingle);
      await expect(page.getByTestId(`${prefix}-half`)).toHaveText(lineFormatSingle);
    }

    // Aucune cote affichée nulle part (ex : 1.85, 2.40).
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(/\b\d\.\d{2}\b/);
    await expect(page.getByTestId("correct-scores")).not.toContainText("%");

    expect(errors.consoleErrors, `Erreurs console : ${errors.consoleErrors.join(" | ")}`).toEqual([]);
  });

  test("Bloc 1 — cliquer directement sur le corps d'une carte (équipes/score, pas le bouton ANALYSER) mène directement à la page du match, aucune page intermédiaire", async ({ page }) => {
    await page.goto("/");

    const card = page.getByTestId("match-card-body").first();
    // On clique sur le nom de l'équipe à domicile, à l'intérieur de la carte —
    // jamais sur le bouton ANALYSER lui-même.
    await card.getByText("Arsenal FC").click();

    // Navigation directe : l'URL change immédiatement vers /match/ID, aucune page
    // intermédiaire (pas de confirmation, pas d'écran de chargement bloquant).
    await expect(page).toHaveURL(/\/match\/101/);
    await expect(page.getByTestId("win-probability-card")).toBeVisible();
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
        total: await page.getByTestId("market-total").textContent(),
        corners: await page.getByTestId("stat-corners-total").textContent(),
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

    // Régression : le total de corners (et de buts attendus) ne doit plus être une
    // quasi-constante recopiée sur tous les matchs.
    const fingerprints = [a1, a2, a3].map((a) => `${a.home}|${a.total}|${a.corners}`);
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

  test("bloc 3 : sur un match en direct, \"Moments forts\" est épinglé en haut, juste sous le score, jamais le message \"indisponible\"", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");
    await page.getByTestId("match-list").getByText("ANALYSER").nth(2).click(); // match 103, Flamengo-Palmeiras, IN_PLAY
    await expect(page).toHaveURL(/\/match\/103/);

    const pinned = page.getByTestId("pinned-highlights");
    await expect(pinned.getByRole("heading", { name: "Moments forts" })).toBeVisible();
    // Le mock (voir e2e/mockApi.js) ne fournit pas d'événements réels pour ce match :
    // même dans ce cas, un match en direct n'affiche jamais "indisponible".
    await expect(pinned.getByTestId("timeline-empty")).toHaveText("Coup d'envoi — en attente des premiers événements.");

    // Épinglée (sticky) : reste visible après avoir fait défiler la page vers le bas.
    await expect(pinned).toHaveCSS("position", "sticky");
    await page.mouse.wheel(0, 600);
    await expect(pinned).toBeInViewport();

    expect(errors.consoleErrors, `Erreurs console : ${errors.consoleErrors.join(" | ")}`).toEqual([]);
  });

  test("bloc 3 : sur un match TERMINÉ, \"Moments forts\" reste en bas de page (pas épinglé) avec le message d'origine", async ({ page }) => {
    await page.goto("/competition/PL");
    await page.getByRole("button", { name: "Résultats", exact: true }).click();
    await page.getByText("ANALYSER").first().click();

    await expect(page.getByTestId("pinned-highlights")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Moments forts" })).toBeVisible();
    await expect(page.getByTestId("timeline-empty")).toHaveText("Événements non disponibles pour ce match.");
  });
});

test.describe("Écran 4 — Page d'une compétition (accessible par lien direct)", () => {
  test("Calendrier / Résultats / Classement contiennent chacun du vrai contenu", async ({ page }) => {
    await page.goto("/competition/PL");

    await expect(page.getByRole("heading", { name: "Premier League" })).toBeVisible();
    await expect(page.getByText("Liverpool FC")).toBeVisible(); // Calendrier (par défaut)

    await page.getByRole("button", { name: "Résultats", exact: true }).click();
    await expect(page.getByText("Arsenal FC").first()).toBeVisible();
    await expect(page.getByText("3 - 1", { exact: true })).toBeVisible();

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

test.describe("Écran 5 — Probabilités réussies / échouées", () => {
  test("\"Probabilités réussies\" : le bouton mène à la page, un match terminé classé succès y apparaît avec le bon badge", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/");

    await page.getByTestId("main-nav").getByRole("link", { name: "Probabilités réussies" }).click();
    await expect(page).toHaveURL(/\/probabilites-reussies/);

    const card = page.getByTestId("pronostic-history-card").first();
    await expect(card.getByText("Arsenal FC — Chelsea FC")).toBeVisible();
    await expect(card.getByTestId("history-badge")).toHaveText("Succès");
    await expect(card.getByTestId("history-final-score")).toHaveText("3 - 0");

    // PROMPT — chaque ligne de pronostic (fautes, total, corners, cartons, tirs...)
    // porte son propre indicateur visuel : au moins une ligne vérifiée (crochet vert
    // ou croix rouge, à partir du vrai score final 3-0) ET au moins une ligne
    // "Indisponible" (corners/hors-jeu/fautes/tirs/cartons : aucune clé API-Football
    // dans cet environnement E2E, jamais un résultat inventé).
    const verifiedLines = card.getByTestId("verified-line");
    await expect(verifiedLines.first()).toBeVisible();
    const iconCount = await card.getByTestId("line-icon-success").count() + await card.getByTestId("line-icon-failure").count();
    expect(iconCount).toBeGreaterThan(0);
    await expect(card.getByTestId("line-icon-unavailable").first()).toBeVisible();

    expect(errors.consoleErrors, `Erreurs console : ${errors.consoleErrors.join(" | ")}`).toEqual([]);
  });

  test("\"Probabilités échouées\" : le bouton mène à la page, un match terminé classé échec y apparaît avec le bon badge", async ({ page }) => {
    await page.goto("/");

    await page.getByTestId("main-nav").getByRole("link", { name: "Probabilités échouées" }).click();
    await expect(page).toHaveURL(/\/probabilites-echouees/);

    const card = page.getByTestId("pronostic-history-card").first();
    await expect(card.getByText("Real Madrid — FC Barcelona")).toBeVisible();
    await expect(card.getByTestId("history-badge")).toHaveText("Échec");
    await expect(card.getByTestId("history-final-score")).toHaveText("0 - 3");
  });

  test("une entrée de plus de 5 jours n'apparaît dans aucune des deux listes (nettoyage automatique)", async ({ page }) => {
    await page.goto("/probabilites-reussies");
    // Le mock (e2e/mockApi.js) inclut volontairement un 3e match, vieux de 6 jours,
    // filtré comme le ferait le vrai nettoyage à 5 jours de lib/pronosticHistory.js.
    await expect(page.getByTestId("pronostic-history-card")).toHaveCount(1);
  });
});
