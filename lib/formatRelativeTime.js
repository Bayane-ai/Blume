// Formate un horodatage ISO passé en "il y a X minutes/heures" — utilisé pour le
// message discret de fraîcheur des données quand le quota API du jour est épuisé
// (voir PROMPT : "message discret « Données mises à jour il y a X minutes »"),
// pages/index.js, pages/a-venir.js et pages/admin/quota.js.
export function formatMinutesAgo(isoDate) {
  if (!isoDate) return null;
  const then = new Date(isoDate).getTime();
  if (!Number.isFinite(then)) return null;
  const diffMs = Date.now() - then;
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} minute${minutes > 1 ? "s" : ""}`;
  const hours = Math.round(minutes / 60);
  return `il y a ${hours} heure${hours > 1 ? "s" : ""}`;
}
