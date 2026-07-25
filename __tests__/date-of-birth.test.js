import { validateDateOfBirth } from "../lib/dateOfBirth";

test("3 champs vides : ni date ni erreur (rien saisi pour l'instant)", () => {
  expect(validateDateOfBirth("", "", "")).toEqual({ iso: null, error: null });
});

test("date valide : renvoie le format AAAA-MM-JJ, identique à l'ancien <input type=\"date\">", () => {
  expect(validateDateOfBirth("01", "06", "2000")).toEqual({ iso: "2000-06-01", error: null });
});

test("jour sur 1 chiffre : erreur claire", () => {
  expect(validateDateOfBirth("1", "06", "2000").error).toBe("Le jour doit comporter 2 chiffres.");
});

test("mois sur 1 chiffre : erreur claire", () => {
  expect(validateDateOfBirth("01", "6", "2000").error).toBe("Le mois doit comporter 2 chiffres.");
});

test("année sur moins de 4 chiffres : erreur claire", () => {
  expect(validateDateOfBirth("01", "06", "200").error).toBe("L'année doit comporter 4 chiffres.");
});

test("mois hors de 1-12 : erreur claire", () => {
  expect(validateDateOfBirth("15", "13", "2000").error).toBe("Le mois doit être entre 1 et 12.");
  expect(validateDateOfBirth("15", "00", "2000").error).toBe("Le mois doit être entre 1 et 12.");
});

test("jour hors de 1-31 : erreur claire", () => {
  expect(validateDateOfBirth("32", "06", "2000").error).toBe("Le jour doit être entre 1 et 31.");
  expect(validateDateOfBirth("00", "06", "2000").error).toBe("Le jour doit être entre 1 et 31.");
});

test("année avant 1900 : erreur claire", () => {
  expect(validateDateOfBirth("01", "06", "1899").error).toBe("L'année doit être 1900 ou après.");
});

test("année 1900 pile : acceptée", () => {
  expect(validateDateOfBirth("01", "06", "1900")).toEqual({ iso: "1900-06-01", error: null });
});

test("31 avril (avril n'a que 30 jours) : \"Cette date n'existe pas.\"", () => {
  expect(validateDateOfBirth("31", "04", "2000").error).toBe("Cette date n'existe pas.");
});

test("29 février d'une année bissextile (2000) : accepté", () => {
  expect(validateDateOfBirth("29", "02", "2000")).toEqual({ iso: "2000-02-29", error: null });
});

test("29 février d'une année NON bissextile (2001) : \"Cette date n'existe pas.\"", () => {
  expect(validateDateOfBirth("29", "02", "2001").error).toBe("Cette date n'existe pas.");
});

test("29 février d'une année séculaire non bissextile (1900) : \"Cette date n'existe pas.\"", () => {
  expect(validateDateOfBirth("29", "02", "1900").error).toBe("Cette date n'existe pas.");
});

test("31 janvier : accepté (31 jours)", () => {
  expect(validateDateOfBirth("31", "01", "2000")).toEqual({ iso: "2000-01-31", error: null });
});

test("date dans le futur : refusée", () => {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  const day = String(future.getDate()).padStart(2, "0");
  const month = String(future.getMonth() + 1).padStart(2, "0");
  const year = String(future.getFullYear());
  expect(validateDateOfBirth(day, month, year).error).toBe("La date de naissance ne peut pas être dans le futur.");
});

test("aujourd'hui même : accepté (pas \"dans le futur\")", () => {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String(now.getFullYear());
  expect(validateDateOfBirth(day, month, year).error).toBeNull();
});
