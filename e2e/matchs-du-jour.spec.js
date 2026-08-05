// Vérification RÉELLE (navigateur) de la page "Matchs du jour" et de ses deux sections
// SportScore — desktop ET mobile. L'API sportscore.com est injoignable depuis cet
// environnement de développement : elle est donc simulée au niveau réseau, avec une
// réponse de la forme documentée, pour exercer le vrai code applicatif sans le modifier.
const { test, expect } = require("@playwright/test");

const IPHONE = { width: 390, height: 844 };

function ssMatches(sport) {
  if (sport === "basketball") {
    return [
      { id: 31, home_team: { name: "Los Angeles Lakers", logo: "https://example.test/lal.png" }, away_team: { name: "Boston Celtics", logo: "https://example.test/bos.png" }, league: { name: "NBA" }, start_at: "2026-08-11T02:00:00Z", status: "not_started" },
      { id: 32, home_team: { name: "Petit Club Regional" }, away_team: { name: "Autre Club Regional" }, league: { name: "Liga ACB" }, start_at: "2026-08-10T18:00:00Z", status: "finished" },
    ];
  }
  if (sport === "tennis") {
    return [
      { id: 21, home_team: { name: "Novak Djokovic", logo: "https://example.test/nd.png" }, away_team: { name: "Carlos Alcaraz", logo: "https://example.test/ca.png" }, tournament: { name: "Wimbledon" }, start_at: "2026-08-10T13:00:00Z", status: "not_started" },
      { id: 22, home_team: { name: "Joueur ITF Un Nom Particulierement Long" }, away_team: { name: "Joueur ITF Deux Nom Tres Long Aussi" }, tournament: { name: "ITF M15 Monastir" }, start_at: "2026-08-10T09:00:00Z", status: "live" },
    ];
  }
  return [
    { id: 11, home_team: { name: "Club Amical A" }, away_team: { name: "Club Amical B" }, league: { name: "Club Friendlies" }, start_at: "2026-08-10T10:00:00Z", status: "not_started" },
    { id: 12, home_team: { name: "Real Madrid", logo: "https://example.test/rm.png" }, away_team: { name: "Manchester City", logo: "https://example.test/mc.png" }, league: { name: "UEFA Champions League" }, start_at: "2026-08-10T20:00:00Z", status: "not_started" },
  ];
}

async function setup(page, { sportscoreFails = false } = {}) {
  // En Playwright, la DERNIÈRE route enregistrée l'emporte : le motif générique doit
  // donc venir en premier, les motifs plus spécifiques ensuite.
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { session: { id: "u1", email: "test@example.com" } } })
  );
  await page.route("**sportscore.com/**", (route) => {
    if (sportscoreFails) return route.fulfill({ status: 503, body: "service unavailable" });
    const sport = new URL(route.request().url()).searchParams.get("sport");
    return route.fulfill({ json: { matches: ssMatches(sport) } });
  });
  // Les logos pointent vers un domaine de test : on renvoie une vraie image VISIBLE
  // (64x64) pour vérifier réellement leur mise en page — un pixel transparent laisserait
  // croire que tout va bien sans rien prouver.
  await page.route("**example.test/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="#39b577"/></svg>',
    })
  );
}

// Le bandeau de consentement aux cookies (global au site) recouvre le bas de page tant
// qu'il n'a pas été fermé : on l'accepte d'abord, pour vérifier les sections sans
// obstruction — comme le fera n'importe quel visiteur après sa première visite.
async function dismissCookieBanner(page) {
  const accept = page.getByRole("button", { name: "Tout accepter" });
  if (await accept.count()) await accept.click();
  await expect(accept).toHaveCount(0);
}

test("desktop : les deux sections affichent les vrais matchs, triés, avec statut et attribution dofollow", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  await setup(page);
  await page.goto("/matchs-du-jour");
  await dismissCookieBanner(page);

  await expect(page.getByRole("heading", { name: "Matchs de football à venir" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Matchs de tennis à venir" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Matchs de basketball à venir" })).toBeVisible();

  const football = page.getByTestId("sportscore-football");
  const tennis = page.getByTestId("sportscore-tennis");
  const basket = page.getByTestId("sportscore-basketball");

  // Grandes compétitions en tête, amicaux conservés en dessous.
  const fCards = football.getByTestId("sportscore-match");
  await expect(fCards).toHaveCount(2);
  await expect(fCards.nth(0)).toContainText("UEFA Champions League");
  await expect(fCards.nth(0)).toContainText("Real Madrid");
  await expect(fCards.nth(1)).toContainText("Club Friendlies");

  // Tennis : Grand Chelem avant l'ITF, et statut réel affiché.
  const tCards = tennis.getByTestId("sportscore-match");
  await expect(tCards.nth(0)).toContainText("Wimbledon");
  await expect(tennis.getByTestId("sportscore-status-live")).toContainText("En direct");

  // Basket : NBA en tête, et le match terminé relégué en fin de liste (jamais en tête).
  const bCards = basket.getByTestId("sportscore-match");
  await expect(bCards.nth(0)).toContainText("NBA");
  await expect(bCards.nth(1)).toContainText("Liga ACB");
  await expect(bCards.nth(1).getByTestId("sportscore-status-finished")).toBeVisible();

  // Aucun "undefined"/"null"/"[object Object]" nulle part à l'écran.
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/undefined|\[object Object\]/);

  // Attribution obligatoire, en dofollow, sous chaque section.
  for (const section of [football, tennis, basket]) {
    const link = section.getByRole("link", { name: "SportScore" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "https://sportscore.com/");
    expect(await link.getAttribute("rel")).not.toContain("nofollow");
  }

  // Purement informatif : aucun bouton d'analyse ni lien de paiement.
  await expect(page.getByRole("button", { name: /analyser/i })).toHaveCount(0);

  // Aucune erreur de console ni exception JavaScript en fonctionnement normal.
  expect(errors).toEqual([]);
  await page.screenshot({ path: "e2e-out/matchs-du-jour-desktop.png", fullPage: true });
});

test("mobile (390px) : aucun débordement horizontal, tout reste lisible", async ({ page }) => {
  await setup(page);
  await page.setViewportSize(IPHONE);
  await page.goto("/matchs-du-jour");
  await dismissCookieBanner(page);

  await expect(page.getByTestId("sportscore-football").getByTestId("sportscore-match").first()).toBeVisible();

  // Aucun débordement horizontal de la page (le vrai défaut visuel sur mobile).
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // Chaque carte reste dans la largeur du viewport, y compris avec des noms très longs.
  const boxes = await page.getByTestId("sportscore-match").evaluateAll((els) =>
    els.map((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; })
  );
  for (const b of boxes) {
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(IPHONE.width + 1);
  }

  await page.screenshot({ path: "e2e-out/matchs-du-jour-mobile.png", fullPage: true });
});

test("API en panne : message de secours lisible, section jamais vide ni cassée, attribution conservée", async ({ page }) => {
  await setup(page, { sportscoreFails: true });
  await page.goto("/matchs-du-jour");
  await dismissCookieBanner(page);

  await expect(page.getByTestId("sportscore-football-fallback")).toContainText(/ne sont pas disponibles/i);
  await expect(page.getByTestId("sportscore-tennis-fallback")).toBeVisible();
  await expect(page.getByTestId("sportscore-football").getByRole("link", { name: "SportScore" })).toBeVisible();

  await page.screenshot({ path: "e2e-out/matchs-du-jour-fallback.png", fullPage: true });
});

test("contenu par défaut : les trois sections affichent un squelette dès le premier rendu, avant toute réponse de l'API", async ({ page }) => {
  await setup(page);
  // L'API ne répond jamais : on observe donc uniquement ce qui est affiché AVANT elle.
  await page.route("**sportscore.com/**", () => {});
  await page.goto("/matchs-du-jour");

  await expect(page.getByTestId("sportscore-skeleton")).toHaveCount(3);
  // Aucune section vide, et surtout aucun match inventé.
  await expect(page.getByTestId("sportscore-match")).toHaveCount(0);
  for (const id of ["sportscore-football", "sportscore-tennis", "sportscore-basketball"]) {
    await expect(page.getByTestId(id).getByRole("link", { name: "SportScore" })).toBeVisible();
  }

  await page.screenshot({ path: "e2e-out/matchs-du-jour-skeleton.png", fullPage: true });
});

test("visite suivante avec API en panne : les derniers vrais matchs connus restent affichés (jamais une section vide)", async ({ page }) => {
  // 1re visite : l'API répond, les matchs sont mémorisés dans le navigateur.
  await setup(page);
  await page.goto("/matchs-du-jour");
  await dismissCookieBanner(page);
  await expect(page.getByTestId("sportscore-football").getByTestId("sportscore-match").first()).toContainText("Real Madrid");

  // 2e visite, API totalement en panne : le contenu réel précédent doit rester visible.
  await page.unroute("**sportscore.com/**");
  await page.route("**sportscore.com/**", (route) => route.fulfill({ status: 503, body: "down" }));
  await page.reload();

  await expect(page.getByTestId("sportscore-football").getByTestId("sportscore-match").first()).toContainText("Real Madrid");
  await expect(page.getByTestId("sportscore-basketball").getByTestId("sportscore-match").first()).toContainText("NBA");
  await expect(page.getByTestId("sportscore-football-fallback")).toHaveCount(0);
});
