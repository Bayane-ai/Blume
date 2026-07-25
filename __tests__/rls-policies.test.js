/**
 * Bloc 4 : "chaque utilisateur connecté ne voit QUE ses propres données... aucune
 * donnée ne doit être partagée entre comptes." Garde-fou structurel qui relit les
 * migrations SQL elles-mêmes, DANS L'ORDRE (pas seulement le code applicatif), pour
 * vérifier l'état RÉEL des policies après application de toutes les migrations —
 * simule les create/drop policy successifs plutôt qu'une simple recherche de texte,
 * pour ne jamais se laisser abuser par une policy créée dans une migration ancienne
 * puis supprimée par une migration plus récente (voir
 * supabase/migrations/0008_custom_auth.sql, qui abandonne Supabase Auth : les tables
 * personnelles n'ont plus de policy DU TOUT — l'isolation entre comptes est désormais
 * assurée par le CODE SERVEUR, qui filtre chaque requête par profile_id, la clé
 * service_role contournant RLS — jamais par une policy "auth.uid() = ..." qui n'aurait
 * plus aucun sens sans Supabase Auth).
 */
const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "..", "supabase", "migrations");

function readMigrationsInOrder() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
}

// Simule l'état RÉEL des policies après application successive de toutes les
// migrations : { "<table>": { "<nom_policy>": "<corps du create policy>" } }.
function computeFinalPolicyState() {
  const state = {};
  const createRe = /create policy\s+"([^"]+)"\s+on\s+(\w+)([\s\S]*?);/gi;
  const dropPolicyRe = /drop policy\s+if exists\s+"([^"]+)"\s+on\s+(\w+)\s*;/gi;
  // "drop table ... cascade" supprime aussi TOUTES les policies de cette table
  // (voir 0008_custom_auth.sql : l'ancienne "profiles" est supprimée puis recréée
  // sans aucune de ses anciennes policies) — sans ceci, une policy créée sur
  // l'ancienne table, jamais explicitement "drop policy", semblerait encore active.
  const dropTableRe = /drop table\s+if exists\s+(\w+)(\s+cascade)?\s*;/gi;

  for (const migration of readMigrationsInOrder()) {
    // Traite tous les événements DANS L'ORDRE où ils apparaissent dans le fichier
    // (une même migration peut recréer une policy/une table qu'elle vient de
    // supprimer).
    const events = [];
    let m;
    createRe.lastIndex = 0;
    while ((m = createRe.exec(migration))) events.push({ type: "create", index: m.index, name: m[1], table: m[2], body: m[0] });
    dropPolicyRe.lastIndex = 0;
    while ((m = dropPolicyRe.exec(migration))) events.push({ type: "drop", index: m.index, name: m[1], table: m[2] });
    dropTableRe.lastIndex = 0;
    while ((m = dropTableRe.exec(migration))) events.push({ type: "drop-table", index: m.index, table: m[1] });
    events.sort((a, b) => a.index - b.index);

    for (const ev of events) {
      if (ev.type === "drop-table") {
        state[ev.table] = {};
        continue;
      }
      state[ev.table] = state[ev.table] || {};
      if (ev.type === "drop") delete state[ev.table][ev.name];
      else state[ev.table][ev.name] = ev.body;
    }
  }
  return state;
}

function readAllMigrationsConcatenated() {
  return readMigrationsInOrder().join("\n\n");
}

const finalPolicies = computeFinalPolicyState();
const sql = readAllMigrationsConcatenated();

// Tables personnelles : accès SERVEUR uniquement (clé service_role, qui contourne
// RLS) — plus aucune policy, l'isolation entre comptes est assurée par le filtrage
// explicite sur profile_id dans chaque route API (voir pages/api/match-history.js,
// pages/api/search-history.js, pages/api/favorites.js), jamais par Postgres.
const PERSONAL_TABLES = ["search_history", "favorites", "profiles", "match_history"];
// Tables volontairement globales (bilan du site partagé, "stats calculées" — voir
// PROMPT "les données publiques communes... restent visibles par tous").
const GLOBAL_TABLES = ["pronostic_history", "combo_history"];

describe.each(PERSONAL_TABLES)("table personnelle : %s", (table) => {
  test("Row Level Security est activée", () => {
    expect(sql).toMatch(new RegExp(`alter table ${table} enable row level security`, "i"));
  });

  test("AUCUNE policy active (accès exclusivement via la clé service_role, jamais l'anon du navigateur)", () => {
    const activePolicies = Object.keys(finalPolicies[table] || {});
    expect(activePolicies).toHaveLength(0);
  });
});

describe.each(GLOBAL_TABLES)("table volontairement globale : %s", (table) => {
  test("reste bien ouverte (using(true)) — bilan du site, pas une donnée personnelle", () => {
    const activePolicies = Object.values(finalPolicies[table] || {});
    expect(activePolicies.length).toBeGreaterThan(0);
    const hasOpenPolicy = activePolicies.some((block) => /using\s*\(\s*true\s*\)/i.test(block));
    expect(hasOpenPolicy).toBe(true);
  });
});

test("search_history, favorites et match_history référencent bien profiles(id) avec suppression en cascade (aucune ligne orpheline si le compte est supprimé)", () => {
  for (const table of ["search_history", "favorites", "match_history"]) {
    const re = new RegExp(`alter table ${table} add column profile_id uuid not null references profiles\\(id\\) on delete cascade`, "i");
    expect(sql).toMatch(re);
  }
});

test("plus aucune table personnelle ne référence auth.users (Supabase Auth entièrement abandonné)", () => {
  for (const table of ["search_history", "favorites", "match_history"]) {
    const columnDropRe = new RegExp(`alter table ${table} drop column if exists user_id`, "i");
    expect(sql).toMatch(columnDropRe);
  }
});
