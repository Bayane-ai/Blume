// Validation d'une date de naissance saisie en 3 champs séparés (Jour/Mois/Année —
// voir components/DateOfBirthInput.js), à la place de l'ancien sélecteur à
// défilement. Renvoie toujours les DEUX informations utiles à la fois :
//   - `iso` (format "AAAA-MM-JJ", IDENTIQUE à ce que produisait l'ancien
//     <input type="date"> — jamais un format différent, voir lib/age.js et
//     supabase/migrations/0005_profiles.sql qui l'attendent tel quel), uniquement
//     quand les 3 valeurs forment une VRAIE date plausible ;
//   - `error`, un message clair en français dès que ce n'est pas le cas.
// Les 3 champs entièrement vides ne sont ni une date valide ni une erreur : c'est
// "rien saisi pour l'instant", géré séparément par le formulaire appelant.
const MIN_YEAR = 1900;

export function validateDateOfBirth(day, month, year) {
  if (day === "" && month === "" && year === "") {
    return { iso: null, error: null };
  }
  if (day.length !== 2) return { iso: null, error: "Le jour doit comporter 2 chiffres." };
  if (month.length !== 2) return { iso: null, error: "Le mois doit comporter 2 chiffres." };
  if (year.length !== 4) return { iso: null, error: "L'année doit comporter 4 chiffres." };

  const d = Number(day);
  const m = Number(month);
  const y = Number(year);

  if (m < 1 || m > 12) return { iso: null, error: "Le mois doit être entre 1 et 12." };
  if (d < 1 || d > 31) return { iso: null, error: "Le jour doit être entre 1 et 31." };
  if (y < MIN_YEAR) return { iso: null, error: `L'année doit être ${MIN_YEAR} ou après.` };

  // Le jour 0 du mois SUIVANT est le dernier jour réel de CE mois — tient compte des
  // mois à 30/31 jours et des années bissextiles pour février, sans table codée en dur.
  const daysInMonth = new Date(y, m, 0).getDate();
  if (d > daysInMonth) return { iso: null, error: "Cette date n'existe pas." };

  const candidate = new Date(y, m - 1, d);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  if (candidate > endOfToday) return { iso: null, error: "La date de naissance ne peut pas être dans le futur." };

  return { iso: `${year}-${month}-${day}`, error: null };
}
