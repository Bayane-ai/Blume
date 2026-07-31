/**
 * lib/sports/basketball/normalDist.js — approximation numérique de la loi normale,
 * utilisée pour les totaux basket (grands nombres, contrairement au modèle de
 * Poisson du football — voir le commentaire du fichier).
 */
import { normalCdf, normalProbabilityOver } from "../lib/sports/basketball/normalDist";

test("normalCdf(mean) = 0,5 (la moyenne partage la distribution en deux)", () => {
  expect(normalCdf(100, 100, 10)).toBeCloseTo(0.5, 5);
});

test("normalCdf est croissante et bornée entre 0 et 1", () => {
  expect(normalCdf(70, 100, 10)).toBeLessThan(0.5);
  expect(normalCdf(130, 100, 10)).toBeGreaterThan(0.5);
  expect(normalCdf(1000, 100, 10)).toBeCloseTo(1, 5);
  expect(normalCdf(-1000, 100, 10)).toBeCloseTo(0, 5);
});

test("règle des 68-95-99.7 (empirique, loi normale standard)", () => {
  expect(normalCdf(110, 100, 10) - normalCdf(90, 100, 10)).toBeCloseTo(0.6827, 2);
  expect(normalCdf(120, 100, 10) - normalCdf(80, 100, 10)).toBeCloseTo(0.9545, 2);
});

test("normalProbabilityOver(mean) = 0,5", () => {
  expect(normalProbabilityOver(100, 100, 10)).toBeCloseTo(0.5, 5);
});

test("un écart-type nul ou absent ne plante jamais (repli honnête binaire)", () => {
  expect(normalCdf(105, 100, 0)).toBe(1);
  expect(normalCdf(95, 100, 0)).toBe(0);
  expect(normalCdf(100, 100, null)).toBe(1);
});
