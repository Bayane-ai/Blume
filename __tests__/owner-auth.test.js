/**
 * lib/auth/owner.js — modèle "propriétaire unique" : SEUL le compte dont l'email
 * VÉRIFIÉ correspond à OWNER_EMAIL est autorisé (OWNER_ID, optionnelle, resserre
 * encore si renseignée). Refus par défaut dans toute situation ambiguë — jamais une
 * autorisation implicite.
 */
import { isOwner, requireOwner, OwnerRequiredError } from "../lib/auth/owner";

const ORIGINAL_OWNER_ID = process.env.OWNER_ID;
const ORIGINAL_OWNER_EMAIL = process.env.OWNER_EMAIL;

afterEach(() => {
  if (ORIGINAL_OWNER_ID === undefined) delete process.env.OWNER_ID;
  else process.env.OWNER_ID = ORIGINAL_OWNER_ID;
  if (ORIGINAL_OWNER_EMAIL === undefined) delete process.env.OWNER_EMAIL;
  else process.env.OWNER_EMAIL = ORIGINAL_OWNER_EMAIL;
});

function ownerSession(overrides = {}) {
  return { user: { id: "user-owner", email: "owner@example.com", email_confirmed_at: "2026-01-01T00:00:00Z", ...overrides } };
}

describe("isOwner", () => {
  test("OWNER_EMAIL non définie : jamais propriétaire, même avec une session qui semble correspondre", () => {
    delete process.env.OWNER_EMAIL;
    expect(isOwner(ownerSession())).toBe(false);
  });

  test("aucune session : jamais propriétaire", () => {
    process.env.OWNER_EMAIL = "owner@example.com";
    expect(isOwner(null)).toBe(false);
    expect(isOwner(undefined)).toBe(false);
    expect(isOwner({})).toBe(false);
    expect(isOwner({ user: null })).toBe(false);
  });

  test("email d'un AUTRE compte : jamais propriétaire", () => {
    process.env.OWNER_EMAIL = "owner@example.com";
    expect(isOwner({ user: { id: "quelquun-dautre", email: "quelquun@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" } })).toBe(false);
  });

  test("email correspondant à OWNER_EMAIL et vérifié : propriétaire", () => {
    process.env.OWNER_EMAIL = "owner@example.com";
    expect(isOwner(ownerSession())).toBe(true);
  });

  test("insensible à la casse et aux espaces superflus de OWNER_EMAIL", () => {
    process.env.OWNER_EMAIL = "  Owner@Example.com  ";
    expect(isOwner(ownerSession({ email: "owner@example.com" }))).toBe(true);
    expect(isOwner(ownerSession({ email: "OWNER@EXAMPLE.COM" }))).toBe(true);
  });

  test("email correspondant mais NON vérifié (email_confirmed_at absent) : refusé", () => {
    process.env.OWNER_EMAIL = "owner@example.com";
    expect(isOwner(ownerSession({ email_confirmed_at: null }))).toBe(false);
    expect(isOwner(ownerSession({ email_confirmed_at: undefined }))).toBe(false);
  });

  test("OWNER_ID renseignée : l'id ET l'email doivent correspondre (resserre, n'affaiblit jamais)", () => {
    process.env.OWNER_EMAIL = "owner@example.com";
    process.env.OWNER_ID = "user-owner";

    // Bon email, mauvais id -> refusé.
    expect(isOwner(ownerSession({ id: "un-autre-id" }))).toBe(false);
    // Bon email, bon id -> accepté.
    expect(isOwner(ownerSession())).toBe(true);
  });

  test("mauvais email mais bon id (si OWNER_ID définie) : toujours refusé (l'email reste requis)", () => {
    process.env.OWNER_EMAIL = "owner@example.com";
    process.env.OWNER_ID = "user-owner";
    expect(isOwner(ownerSession({ email: "autre@example.com" }))).toBe(false);
  });
});

describe("requireOwner", () => {
  test("propriétaire : ne lève rien", () => {
    process.env.OWNER_EMAIL = "owner@example.com";
    expect(() => requireOwner(ownerSession())).not.toThrow();
  });

  test("non-propriétaire : lève OwnerRequiredError (statusCode 403), message générique", () => {
    process.env.OWNER_EMAIL = "owner@example.com";
    let caught;
    try {
      requireOwner({ user: { id: "quelquun-dautre", email: "quelquun@example.com", email_confirmed_at: "2026-01-01T00:00:00Z" } });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OwnerRequiredError);
    expect(caught.statusCode).toBe(403);
    expect(caught.message.toLowerCase()).not.toMatch(/owner|proprietaire|propriétaire|@example/i);
  });

  test("session absente : lève OwnerRequiredError", () => {
    process.env.OWNER_EMAIL = "owner@example.com";
    expect(() => requireOwner(null)).toThrow(OwnerRequiredError);
  });

  test("OWNER_EMAIL non définie : lève systématiquement, quelle que soit la session", () => {
    delete process.env.OWNER_EMAIL;
    expect(() => requireOwner(ownerSession())).toThrow(OwnerRequiredError);
  });
});
