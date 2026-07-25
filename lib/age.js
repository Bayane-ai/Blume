// Âge en années complètes à une date de référence donnée (aujourd'hui par défaut) —
// tient compte du mois/jour, pas seulement de la différence d'années : une personne
// née le 31 décembre n'a pas "un an de plus" dès le 1er janvier suivant.
export function calculateAge(dateOfBirth, referenceDate = new Date()) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const ref = new Date(referenceDate);
  if (dob > ref) return null;

  let age = ref.getFullYear() - dob.getFullYear();
  const hasHadBirthdayThisYear =
    ref.getMonth() > dob.getMonth() ||
    (ref.getMonth() === dob.getMonth() && ref.getDate() >= dob.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}
