/**
 * Bloc 4 : "chaque utilisateur connecté ne voit QUE ses propres données... aucune
 * donnée ne doit être partagée entre comptes." Garde-fou structurel qui relit les
 * migrations SQL elles-mêmes (pas seulement le code applicatif) pour vérifier que
 * chaque table PERSONNELLE a bien Row Level Security activée avec des policies
 * "auth.uid() = user_id" (jamais "using (true)"), et que les tables VOLONTAIREMENT
 * globales (bilan du site, "données publiques communes... les stats calculées",
 * voir PROMPT) le restent explicitement — pour qu'une future migration ne relâche
 * jamais silencieusement l'isolation entre comptes.
 */
const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "..", "supabase", "migrations");

function readAllMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n\n");
}

const sql = readAllMigrations();

// Tables personnelles : chaque compte ne doit lire/écrire QUE sa propre ligne.
const PERSONAL_TABLES = ["search_history", "favorites", "profiles", "match_history"];
// Tables volontairement globales (bilan du site partagé, "stats calculées" — voir
// PROMPT "les données publiques communes... restent visibles par tous").
const GLOBAL_TABLES = ["pronostic_history", "combo_history"];

describe.each(PERSONAL_TABLES)("table personnelle : %s", (table) => {
  test("Row Level Security est activée", () => {
    expect(sql).toMatch(new RegExp(`alter table ${table} enable row level security`, "i"));
  });

  test("aucune policy \"using (true)\" ou \"with check (true)\" pour cette table (jamais ouverte à tout le monde)", () => {
    // Isole les blocs "create policy ... on <table> ... ;" un par un et vérifie
    // qu'aucun ne contient une condition toujours vraie.
    const policyBlocks = sql.match(new RegExp(`create policy[^;]*on ${table}[^;]*;`, "gis")) || [];
    expect(policyBlocks.length).toBeGreaterThan(0);
    for (const block of policyBlocks) {
      expect(block).not.toMatch(/using\s*\(\s*true\s*\)/i);
      expect(block).not.toMatch(/with check\s*\(\s*true\s*\)/i);
    }
  });

  test("au moins une policy utilise auth.uid() = user_id (ou = id pour profiles)", () => {
    const policyBlocks = sql.match(new RegExp(`create policy[^;]*on ${table}[^;]*;`, "gis")) || [];
    const ownershipColumn = table === "profiles" ? "id" : "user_id";
    const hasOwnershipCheck = policyBlocks.some((block) =>
      new RegExp(`auth\\.uid\\(\\)\\s*=\\s*${ownershipColumn}`, "i").test(block)
    );
    expect(hasOwnershipCheck).toBe(true);
  });
});

describe.each(GLOBAL_TABLES)("table volontairement globale : %s", (table) => {
  test("reste bien ouverte (using(true)) — bilan du site, pas une donnée personnelle", () => {
    const policyBlocks = sql.match(new RegExp(`create policy[^;]*on ${table}[^;]*;`, "gis")) || [];
    expect(policyBlocks.length).toBeGreaterThan(0);
    const hasOpenPolicy = policyBlocks.some((block) => /using\s*\(\s*true\s*\)/i.test(block));
    expect(hasOpenPolicy).toBe(true);
  });
});

test("profiles n'a aucune policy d'insertion ou de suppression directe (seul le trigger security definer écrit cette table)", () => {
  const insertPolicies = sql.match(/create policy[^;]*on profiles for insert[^;]*;/gis) || [];
  const deletePolicies = sql.match(/create policy[^;]*on profiles for delete[^;]*;/gis) || [];
  expect(insertPolicies).toHaveLength(0);
  expect(deletePolicies).toHaveLength(0);
});

test("match_history référence bien auth.users avec suppression en cascade (aucune ligne orpheline si le compte est supprimé)", () => {
  expect(sql).toMatch(/user_id uuid not null references auth\.users\(id\) on delete cascade/i);
});
