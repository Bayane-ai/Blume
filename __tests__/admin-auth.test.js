/**
 * lib/auth/admin.js — modèle "propriétaire unique" : SEUL le compte dont l'email
 * correspond à ADMIN_EMAIL est autorisé à effectuer des actions d'administration.
 * Être connecté (avoir une session valide) ne donne AUCUN droit de modification —
 * refus par défaut dans toute situation ambiguë, jamais une autorisation implicite.
 */
import { isAdmin, requireAdmin, AdminRequiredError } from "../lib/auth/admin";

const ORIGINAL_ADMIN_EMAIL = process.env.ADMIN_EMAIL;

afterEach(() => {
  if (ORIGINAL_ADMIN_EMAIL === undefined) delete process.env.ADMIN_EMAIL;
  else process.env.ADMIN_EMAIL = ORIGINAL_ADMIN_EMAIL;
});

function adminSession(overrides = {}) {
  return { id: "user-admin", email: "admin@example.com", ...overrides };
}

describe("isAdmin", () => {
  test("ADMIN_EMAIL non définie : jamais administrateur, même avec une session qui semble correspondre", () => {
    delete process.env.ADMIN_EMAIL;
    expect(isAdmin(adminSession())).toBe(false);
  });

  test("aucune session : jamais administrateur", () => {
    process.env.ADMIN_EMAIL = "admin@example.com";
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin({})).toBe(false);
  });

  test("email d'un AUTRE compte : jamais administrateur", () => {
    process.env.ADMIN_EMAIL = "admin@example.com";
    expect(isAdmin({ id: "quelquun-dautre", email: "quelquun@example.com" })).toBe(false);
  });

  test("email correspondant à ADMIN_EMAIL : administrateur", () => {
    process.env.ADMIN_EMAIL = "admin@example.com";
    expect(isAdmin(adminSession())).toBe(true);
  });

  test("insensible à la casse et aux espaces superflus de ADMIN_EMAIL", () => {
    process.env.ADMIN_EMAIL = "  Admin@Example.com  ";
    expect(isAdmin(adminSession({ email: "admin@example.com" }))).toBe(true);
    expect(isAdmin(adminSession({ email: "ADMIN@EXAMPLE.COM" }))).toBe(true);
  });

  test("être simplement connecté ne donne aucun droit : seul l'email compte", () => {
    process.env.ADMIN_EMAIL = "admin@example.com";
    expect(isAdmin({ id: "n-importe-qui", email: "visiteur@example.com" })).toBe(false);
  });
});

describe("requireAdmin", () => {
  test("administrateur : ne lève rien", () => {
    process.env.ADMIN_EMAIL = "admin@example.com";
    expect(() => requireAdmin(adminSession())).not.toThrow();
  });

  test("non-administrateur : lève AdminRequiredError (statusCode 403), message générique", () => {
    process.env.ADMIN_EMAIL = "admin@example.com";
    let caught;
    try {
      requireAdmin({ id: "quelquun-dautre", email: "quelquun@example.com" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AdminRequiredError);
    expect(caught.statusCode).toBe(403);
    expect(caught.message.toLowerCase()).not.toMatch(/admin|@example/i);
  });

  test("session absente : lève AdminRequiredError", () => {
    process.env.ADMIN_EMAIL = "admin@example.com";
    expect(() => requireAdmin(null)).toThrow(AdminRequiredError);
  });

  test("ADMIN_EMAIL non définie : lève systématiquement, quelle que soit la session", () => {
    delete process.env.ADMIN_EMAIL;
    expect(() => requireAdmin(adminSession())).toThrow(AdminRequiredError);
  });
});
