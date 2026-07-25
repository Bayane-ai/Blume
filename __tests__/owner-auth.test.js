/**
 * lib/auth/owner.js — modèle "propriétaire unique" : SEUL le compte identifié par
 * OWNER_ID (et OWNER_EMAIL si renseignée) est autorisé. Refus par défaut dans toute
 * situation ambiguë — jamais une autorisation implicite.
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

describe("isOwner", () => {
  test("OWNER_ID non défini : jamais propriétaire, même avec une session qui semble correspondre", () => {
    delete process.env.OWNER_ID;
    expect(isOwner({ user: { id: "user-owner", email: "owner@example.com" } })).toBe(false);
  });

  test("aucune session : jamais propriétaire", () => {
    process.env.OWNER_ID = "user-owner";
    expect(isOwner(null)).toBe(false);
    expect(isOwner(undefined)).toBe(false);
    expect(isOwner({})).toBe(false);
    expect(isOwner({ user: null })).toBe(false);
  });

  test("session d'un AUTRE compte : jamais propriétaire", () => {
    process.env.OWNER_ID = "user-owner";
    expect(isOwner({ user: { id: "user-quelquun-dautre", email: "quelquun@example.com" } })).toBe(false);
  });

  test("id correspondant à OWNER_ID : propriétaire", () => {
    process.env.OWNER_ID = "user-owner";
    expect(isOwner({ user: { id: "user-owner", email: "owner@example.com" } })).toBe(true);
  });

  test("OWNER_EMAIL renseignée : l'id ET l'email doivent correspondre (resserre, n'affaiblit jamais)", () => {
    process.env.OWNER_ID = "user-owner";
    process.env.OWNER_EMAIL = "owner@example.com";

    // Bon id, mauvais email -> refusé.
    expect(isOwner({ user: { id: "user-owner", email: "autre@example.com" } })).toBe(false);
    // Bon id, bon email -> accepté.
    expect(isOwner({ user: { id: "user-owner", email: "owner@example.com" } })).toBe(true);
    // Insensible à la casse de l'email.
    expect(isOwner({ user: { id: "user-owner", email: "Owner@Example.com" } })).toBe(true);
  });

  test("mauvais id mais bon email (si OWNER_EMAIL définie) : toujours refusé (l'id reste requis)", () => {
    process.env.OWNER_ID = "user-owner";
    process.env.OWNER_EMAIL = "owner@example.com";
    expect(isOwner({ user: { id: "un-autre-id", email: "owner@example.com" } })).toBe(false);
  });
});

describe("requireOwner", () => {
  test("propriétaire : ne lève rien", () => {
    process.env.OWNER_ID = "user-owner";
    expect(() => requireOwner({ user: { id: "user-owner" } })).not.toThrow();
  });

  test("non-propriétaire : lève OwnerRequiredError (statusCode 403), message générique", () => {
    process.env.OWNER_ID = "user-owner";
    let caught;
    try {
      requireOwner({ user: { id: "quelquun-dautre" } });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OwnerRequiredError);
    expect(caught.statusCode).toBe(403);
    expect(caught.message.toLowerCase()).not.toMatch(/owner|proprietaire|propriétaire|email/i);
  });

  test("session absente : lève OwnerRequiredError", () => {
    process.env.OWNER_ID = "user-owner";
    expect(() => requireOwner(null)).toThrow(OwnerRequiredError);
  });

  test("OWNER_ID non défini : lève systématiquement, quelle que soit la session", () => {
    delete process.env.OWNER_ID;
    expect(() => requireOwner({ user: { id: "nimporte-quoi" } })).toThrow(OwnerRequiredError);
  });
});
