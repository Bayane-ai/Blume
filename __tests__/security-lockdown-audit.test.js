/**
 * Garde-fous structurels du verrouillage "propriétaire unique" :
 *   - les routes API 100% publiques (données football en lecture) ne dépendent
 *     JAMAIS de lib/auth/admin.js — jamais verrouillées par erreur ;
 *   - robots.txt interdit /api/ et /admin ;
 *   - les en-têtes de sécurité (anti-iframe) sont bien appliqués à tout le site.
 */
const fs = require("fs");
const path = require("path");

const PUBLIC_READ_ONLY_ROUTES = [
  "pages/api/matches.js",
  "pages/api/live-matches.js",
  "pages/api/competition-matches.js",
  "pages/api/competition-standings.js",
  "pages/api/news.js",
];

describe.each(PUBLIC_READ_ONLY_ROUTES)("%s reste une route publique, jamais verrouillée", (relPath) => {
  test("n'importe jamais lib/auth/admin.js", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", relPath), "utf8");
    expect(source).not.toMatch(/lib\/auth\/admin/);
  });
});

test("robots.txt interdit l'indexation de /api/ et /admin", () => {
  const robots = fs.readFileSync(path.join(__dirname, "..", "public", "robots.txt"), "utf8");
  expect(robots).toMatch(/Disallow:\s*\/api\//);
  expect(robots).toMatch(/Disallow:\s*\/admin/);
});

test("next.config.js applique des en-têtes anti-iframe à tout le site", async () => {
  const nextConfig = require("../next.config.js");
  const headerGroups = await nextConfig.headers();
  const global = headerGroups.find((g) => g.source === "/:path*");
  expect(global).toBeDefined();

  const byKey = Object.fromEntries(global.headers.map((h) => [h.key, h.value]));
  expect(byKey["X-Frame-Options"]).toBe("DENY");
  expect(byKey["Content-Security-Policy"]).toMatch(/frame-ancestors 'none'/);
  expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
});

test("le module admin n'est utilisé que par les routes d'administration et /api/whoami", () => {
  const { execSync } = require("child_process");
  // Ne cherche que de VRAIS imports ("lib/auth/admin" entre guillemets, sans
  // extension .js) — pas une simple mention dans un commentaire de documentation
  // (ex. "voir lib/auth/admin.js", qui se termine par ".js" et jamais un guillemet).
  const output = execSync(
    `grep -rlE "lib/auth/admin['\\"]" pages lib components 2>/dev/null || true`,
    { cwd: path.join(__dirname, ".."), encoding: "utf8" }
  );
  const files = output.split("\n").filter(Boolean).map((f) => f.replace(/\\/g, "/"));
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    expect(f === "pages/api/admin/recompute.js" || f === "pages/admin.js" || f === "pages/api/whoami.js" || f === "lib/auth/admin.js").toBe(true);
  }
});
