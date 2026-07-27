/**
 * lib/apiErrorMessages.js — messages d'erreur TECHNIQUES explicites (voir PROMPT :
 * "clé invalide, quota dépassé, service indisponible... au lieu d'une liste vide et
 * silencieuse").
 */
import { describeFootballDataError } from "../lib/apiErrorMessages";

test("401/403 -> message mentionnant une clé invalide/refusée", () => {
  expect(describeFootballDataError({ status: 401 })).toMatch(/clé api.*invalide|refusée/i);
  expect(describeFootballDataError({ status: 403 })).toMatch(/clé api.*invalide|refusée/i);
});

test("429 -> message mentionnant le quota dépassé", () => {
  expect(describeFootballDataError({ status: 429 })).toMatch(/quota/i);
});

test("5xx -> message mentionnant un service indisponible", () => {
  expect(describeFootballDataError({ status: 500 })).toMatch(/indisponible/i);
  expect(describeFootballDataError({ status: 503 })).toMatch(/indisponible/i);
});

test("le message technique de l'API (bodyMessage) est repris dans le message final quand disponible", () => {
  expect(describeFootballDataError({ status: 401, bodyMessage: "Invalid credentials" })).toContain("Invalid credentials");
});

test("erreur réseau (aucun code HTTP) -> message distinct, mentionnant l'injoignabilité", () => {
  const message = describeFootballDataError({ networkError: "fetch failed" });
  expect(message).toMatch(/injoignable/i);
  expect(message).toContain("fetch failed");
});

test("code inattendu -> message générique incluant quand même le code", () => {
  expect(describeFootballDataError({ status: 418 })).toContain("418");
});
