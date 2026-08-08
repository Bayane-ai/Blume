// Vérification RÉELLE (navigateur) de l'onglet unique "Matchs à venir" : fusion de
// l'ancien "Matchs du jour", hiérarchie sport -> date -> compétition, couverture
// totale (reçu == affiché), et bouton ANALYSER fonctionnel.
const { test, expect } = require("@playwright/test");

const IPHONE = { width: 390, height: 844 };
const H = (n) => new Date(Date.now() + n * 3600000).toISOString();

// 10 compétitions volontairement hétéroclites par sport : grandes, jeunes, réserves,
// féminines, amicaux, petites fédérations — rien ne doit être écarté.
const COMPS = {
  football: ["UEFA Champions League", "Premier League", "Serie A", "Club Friendlies",
             "Russia U20 League", "Latvia Virsliga Reserves", "Women's Cup",
             "Bhutan Premier League", "Regional Amateur Cup", "Iceland 3. deild"],
  basketball: ["NBA", "EuroLeague", "Liga ACB", "NCAA D3", "WNBA", "Youth U18 Cup",
               "Regional Amateur League", "Reserves Cup", "Summer League", "3x3 Open"],
  tennis: ["Wimbledon", "ATP 250 Metz", "WTA 125 Contrexeville", "ITF M15 Monastir",
           "Challenger Como", "Junior Open", "Davis Cup Group IV", "Senior Tour",
           "Wheelchair Open", "Exhibition Match"],
};

function ssMatches(sport) {
  return (COMPS[sport] || []).map((name, i) => ({
    id: `${sport}-${i}`,
    home_team: { name: `${sport} H${i}` },
    away_team: { name: `${sport} A${i}` },
    league: { name },
    // Étalés sur aujourd'hui et demain pour exercer le groupement par date.
    start_at: H(i < 5 ? 3 + i : 27 + i),
    status: "not_started",
  }));
}

async function setup(page) {
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { session: { id: "u1", email: "test@example.com" } } })
  );
  // Sources maison vides ici : SportScore fournit tout, ce qui rend le comptage
  // parfaitement prévisible.
  for (const r of ["**/api/matches", "**/api/basketball/matches", "**/api/tennis/matches"]) {
    await page.route(r, (route) => route.fulfill({ json: { competitions: [] } }));
  }
  await page.route("**sportscore.com/**", (route) => {
    const sport = new URL(route.request().url()).searchParams.get("sport");
    return route.fulfill({ json: { matches: ssMatches(sport) } });
  });
}

async function dismissCookieBanner(page) {
  const accept = page.getByRole("button", { name: "Tout accepter" });
  if (await accept.count()) await accept.click();
  await expect(accept).toHaveCount(0);
}

test("BLOC 1 — l'ancienne URL /matchs-du-jour redirige définitivement vers /a-venir", async ({ page }) => {
  await setup(page);
  const res = await page.goto("/matchs-du-jour");
  expect(page.url()).toContain("/a-venir");
  expect(res.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Matchs à venir", level: 1 })).toBeVisible();
});

test("BLOC 1+2 — l'onglet « Matchs du jour » a disparu ; les pills sont dans l'ordre demandé", async ({ page }) => {
  await setup(page);
  await page.goto("/a-venir");
  await dismissCookieBanner(page);

  const nav = page.getByTestId("main-nav");
  await expect(nav.getByText(/matchs du jour/i)).toHaveCount(0);
  await expect(nav.locator('a[href="/matchs-du-jour"]')).toHaveCount(0);
  // Aucun texte "Matchs du jour" nulle part sur la page.
  expect(await page.locator("body").innerText()).not.toMatch(/matchs du jour/i);

  const labels = await nav.locator("a").allTextContents();
  expect(labels.map((t) => t.trim()).slice(0, 7)).toEqual([
    "Live", "Matchs à venir", "Combiné Vision", "News",
    "Historique", "Probabilités réussies", "Probabilités échouées",
  ]);
  // Une SEULE pill est active : "Matchs à venir" a le fond vif et un texte foncé,
  // toutes les autres le fond sombre et un texte clair (couleurs lues sur le rendu
  // réel plutôt que codées en dur, pour ne pas figer la charte du site).
  const active = nav.locator('a[href="/a-venir"]');
  const inactive = nav.locator('a[href="/news"]');
  const [activeBg, inactiveBg] = [
    await active.evaluate((el) => getComputedStyle(el).backgroundColor),
    await inactive.evaluate((el) => getComputedStyle(el).backgroundColor),
  ];
  expect(activeBg).not.toBe(inactiveBg);
  const [activeColor, inactiveColor] = [
    await active.evaluate((el) => getComputedStyle(el).color),
    await inactive.evaluate((el) => getComputedStyle(el).color),
  ];
  expect(activeColor).not.toBe(inactiveColor);
  // Texte foncé sur la pill active, clair sur les autres.
  const lum = (c) => c.match(/\d+/g).slice(0, 3).reduce((a, v) => a + Number(v), 0);
  expect(lum(activeColor)).toBeLessThan(lum(inactiveColor));
});

test("BLOC 5+9 — hiérarchie date -> compétition, couverture totale et sports séparés", async ({ page }) => {
  const infos = [];
  const appErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "info") infos.push(msg.text());
    if (msg.type() === "error" && !/Failed to load resource/i.test(msg.text())) appErrors.push(msg.text());
  });
  page.on("pageerror", (e) => appErrors.push(String(e)));

  await setup(page);
  await page.goto("/a-venir");
  await dismissCookieBanner(page);

  for (const sport of ["football", "basketball", "tennis"]) {
    if (sport !== "football") {
      await page.getByTestId(`sport-tab-${sport}`).click();
    }
    const list = page.getByTestId("match-list");
    await expect(list).toHaveAttribute("data-sport", sport);

    // Reçu == affiché : le comptage déclaré, le DOM réel et le journal coïncident.
    const declared = Number(await list.getAttribute("data-match-count"));
    const rendered = await page.getByTestId("upcoming-match-card").count();
    expect(declared).toBe(COMPS[sport].length);
    expect(rendered).toBe(COMPS[sport].length);
    await expect(list).toHaveAttribute("data-competition-count", String(COMPS[sport].length));

    // Groupement par date, en-têtes lisibles.
    const dayLabels = await page.getByTestId("day-section").locator("h2").allTextContents();
    expect(dayLabels.length).toBeGreaterThanOrEqual(2);
    expect(dayLabels[0]).toBe("Aujourd'hui");

    // Chaque compétition, même la plus obscure, est réellement présente.
    for (const name of COMPS[sport]) {
      await expect(page.getByRole("heading", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) })).toBeVisible();
    }

    // Aucun match d'un autre sport ne s'est glissé ici.
    for (const other of ["football", "basketball", "tennis"].filter((s) => s !== sport)) {
      await expect(page.getByText(new RegExp(`^${other} H\\d`))).toHaveCount(0);
    }

    // Aucun score : ces matchs n'ont pas commencé.
    expect(await list.innerText()).not.toMatch(/\b\d+\s*-\s*\d+\b/);
  }

  for (const sport of ["football", "basketball", "tennis"]) {
    expect(infos.some((l) => l.includes(`[À venir] ${sport} : 10 match(s) à venir, 10 compétition(s)`))).toBe(true);
  }
  expect(appErrors).toEqual([]);

  await page.screenshot({ path: "e2e-out/a-venir-tennis.png", fullPage: true });
});

test("BLOC 6 — le bouton ANALYSER est dans la carte et mène à la page de pronostics", async ({ page }) => {
  await setup(page);
  await page.goto("/a-venir");
  await dismissCookieBanner(page);

  const card = page.getByTestId("upcoming-match-card").first();
  const btn = card.getByRole("button", { name: "ANALYSER" });
  await expect(btn).toBeVisible();

  // Le bouton est bien À L'INTÉRIEUR de la carte, avec une marge nette sur les côtés.
  const cardBox = await card.boundingBox();
  const btnBox = await btn.boundingBox();
  expect(btnBox.x).toBeGreaterThan(cardBox.x + 8);
  expect(btnBox.x + btnBox.width).toBeLessThan(cardBox.x + cardBox.width - 8);
  expect(btnBox.y + btnBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 1);

  await btn.click();
  await page.waitForURL(/\/match\//);
  expect(page.url()).toContain("/match/");
});

test("BLOC 7 — toutes les sources en panne : message d'erreur DISTINCT et cause technique visible", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { session: { id: "u1", email: "test@example.com" } } })
  );
  await page.route("**/api/matches", (route) => route.fulfill({ status: 500, body: "boom" }));
  await page.route("**sportscore.com/**", (route) => route.fulfill({ status: 503, body: "down" }));
  await page.route("**/api/sportscore**", (route) => route.fulfill({ status: 503, body: "down" }));

  await page.goto("/a-venir");
  await dismissCookieBanner(page);

  const err = page.getByTestId("upcoming-error");
  await expect(err).toBeVisible();
  await expect(err).toContainText(/toutes les sources ont échoué/i);
  // Le message générique "pas disponibles" ne doit plus masquer la cause.
  await expect(page.getByTestId("upcoming-error-detail")).toContainText("503");
  await expect(page.getByTestId("upcoming-error-detail")).toContainText("500");
});

test("BLOC 8 — mobile 390px : aucun débordement horizontal", async ({ page }) => {
  await setup(page);
  await page.setViewportSize(IPHONE);
  await page.goto("/a-venir");
  await dismissCookieBanner(page);
  await expect(page.getByTestId("upcoming-match-card").first()).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  await page.screenshot({ path: "e2e-out/a-venir-mobile.png", fullPage: true });
});

test("écran vide : jamais décidé par le code — source, code HTTP et plage de dates affichés", async ({ page }) => {
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { session: { id: "u1", email: "test@example.com" } } })
  );
  // Toutes les sources répondent 200 avec 0 match : le SEUL vide légitime.
  await page.route("**sportscore.com/**", (route) => route.fulfill({ json: { matches: [] } }));
  await page.route("**/api/sportscore**", (route) => route.fulfill({ json: { matches: [] } }));
  for (const r of ["**/api/matches", "**/api/basketball/matches", "**/api/tennis/matches"]) {
    await page.route(r, (route) => route.fulfill({ json: { competitions: [], diagnostic: { httpStatus: 200 } } }));
  }

  await page.goto("/a-venir");
  await dismissCookieBanner(page);

  await expect(page.getByTestId("upcoming-empty")).toBeVisible();
  const diag = page.getByTestId("upcoming-empty-diagnostic");
  await expect(diag).toBeVisible();

  const text = await diag.innerText();
  // Source interrogée, code HTTP réel, et plage de dates testée.
  expect(text).toContain("SportScore");
  expect(text).toContain("/api/matches");
  expect(text).toContain("HTTP 200");
  expect(text).toMatch(/plage \d{4}-\d{2}-\d{2} → \d{4}-\d{2}-\d{2}/);

  // Et surtout : plus aucun message écrit en dur.
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/plan gratuit/i);
  expect(body).not.toMatch(/non disponibles? (pour|avec) cette source/i);

  await page.screenshot({ path: "e2e-out/a-venir-vide-diagnostic.png", fullPage: true });
});
