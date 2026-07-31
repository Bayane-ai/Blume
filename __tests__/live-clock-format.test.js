/**
 * lib/liveClockFormat.js — chrono affiché en direct, partagé entre football (pas de
 * champ `period`, comportement "34’" strictement inchangé) et basket (période +
 * chrono officiel, voir PROMPT bloc 2 — "quart-temps en cours et le chrono").
 */
import { formatLiveClock } from "../lib/liveClockFormat";

test("football (pas de `period`) : format minute inchangé", () => {
  expect(formatLiveClock({ minute: 34 })).toBe("34’");
});

test("football sans minute connue : chaîne vide, jamais 'null’'", () => {
  expect(formatLiveClock({ minute: null })).toBe("");
  expect(formatLiveClock({})).toBe("");
});

test("basket : quart-temps + chrono officiel", () => {
  expect(formatLiveClock({ period: "Q3", minute: "5:23" })).toBe("Q3 · 5:23");
  expect(formatLiveClock({ period: "Q1", minute: "10:00" })).toBe("Q1 · 10:00");
});

test("basket, prolongation : libellé explicite", () => {
  expect(formatLiveClock({ period: "OT", minute: "2:10" })).toBe("Prolongation · 2:10");
});

test("basket sans chrono connu : seulement le quart-temps", () => {
  expect(formatLiveClock({ period: "Q2", minute: null })).toBe("Q2");
});
