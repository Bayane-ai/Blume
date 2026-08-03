import { formatMinutesAgo } from "../lib/formatRelativeTime";

test("formatMinutesAgo : moins d'une minute -> 'à l'instant'", () => {
  expect(formatMinutesAgo(new Date(Date.now() - 10000).toISOString())).toBe("à l'instant");
});

test("formatMinutesAgo : minutes, singulier/pluriel corrects", () => {
  expect(formatMinutesAgo(new Date(Date.now() - 60000).toISOString())).toBe("il y a 1 minute");
  expect(formatMinutesAgo(new Date(Date.now() - 5 * 60000).toISOString())).toBe("il y a 5 minutes");
});

test("formatMinutesAgo : heures, singulier/pluriel corrects", () => {
  expect(formatMinutesAgo(new Date(Date.now() - 90 * 60000).toISOString())).toBe("il y a 2 heures");
  expect(formatMinutesAgo(new Date(Date.now() - 60 * 60000).toISOString())).toBe("il y a 1 heure");
});

test("formatMinutesAgo : entrée absente ou invalide -> null (jamais une chaîne cassée affichée)", () => {
  expect(formatMinutesAgo(null)).toBeNull();
  expect(formatMinutesAgo(undefined)).toBeNull();
  expect(formatMinutesAgo("pas une date")).toBeNull();
});
