import { calculateAge } from "../lib/age";

test("anniversaire déjà passé cette année : âge = différence d'années", () => {
  expect(calculateAge("2000-01-15", new Date("2026-06-01"))).toBe(26);
});

test("anniversaire pas encore atteint cette année : un an de moins", () => {
  expect(calculateAge("2000-12-15", new Date("2026-06-01"))).toBe(25);
});

test("jour exact de l'anniversaire : l'année compte déjà", () => {
  expect(calculateAge("2000-06-01", new Date("2026-06-01"))).toBe(26);
});

test("veille de l'anniversaire : l'année ne compte pas encore", () => {
  expect(calculateAge("2000-06-02", new Date("2026-06-01"))).toBe(25);
});

test("date de naissance manquante -> null", () => {
  expect(calculateAge("")).toBeNull();
  expect(calculateAge(null)).toBeNull();
  expect(calculateAge(undefined)).toBeNull();
});

test("date de naissance invalide -> null", () => {
  expect(calculateAge("pas-une-date", new Date("2026-06-01"))).toBeNull();
});

test("date de naissance dans le futur -> null (jamais un âge négatif)", () => {
  expect(calculateAge("2030-01-01", new Date("2026-06-01"))).toBeNull();
});
