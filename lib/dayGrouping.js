// Regroupe les matchs par jour calendaire — pour la page "Matchs à venir", qui
// n'affiche plus qu'un seul jour à la fois (barre de sélection en haut), toutes
// compétitions et tous pays confondus, sans filtre par compétition.
//
// Le jour est calculé en fuseau LOCAL (celui du navigateur), pas en UTC : c'est la
// même convention que l'heure de coup d'envoi déjà affichée ailleurs dans l'app
// (voir formatKickoff dans pages/match/[id].js) — un match à 23h30 UTC ne doit pas
// basculer dans "le jour suivant" pour un fuseau en avance sur UTC.
const LIVE_STATUSES = ["IN_PLAY", "PAUSED"];
export const DAY_TAB_COUNT = 7;

function startOfLocalDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Clé stable "AAAA-MM-JJ" en fuseau local — deux matchs affichés le même jour côté
// utilisateur tombent toujours dans le même groupe.
export function localDayKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Les N prochains jours à partir d'aujourd'hui, pour la barre de sélection — toujours
// au moins 7 jours. Un jour sans aucun match derrière reste dans la liste (jamais
// masqué) : sa section affiche "Aucun match ce jour" plutôt que de faire disparaître
// le bouton, pour que la barre reste stable pendant qu'on navigue.
export function buildDayList(count = DAY_TAB_COUNT) {
  const today = startOfLocalDay(new Date());
  const days = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    days.push({ key: localDayKey(date), date, label: dayLabel(date, i) });
  }
  return days;
}

// "Aujourd'hui" / "Demain" puis "Mercredi 22 juillet" — jamais une date brute au-delà
// des deux premiers jours.
export function dayLabel(date, index) {
  if (index === 0) return "Aujourd'hui";
  if (index === 1) return "Demain";
  const weekday = date.toLocaleDateString("fr-FR", { weekday: "long" });
  const day = date.getDate();
  const month = date.toLocaleDateString("fr-FR", { month: "long" });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${day} ${month}`;
}

// Regroupe une liste de matchs (toutes compétitions confondues) par jour calendaire
// local — un match sans date exploitable est ignoré plutôt que de casser le groupage.
export function groupMatchesByDay(matches) {
  const map = new Map();
  (matches || []).forEach((m) => {
    if (!m?.utcDate) return;
    const key = localDayKey(m.utcDate);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(m);
  });
  return map;
}

// Les matchs en direct de CE jour en premier, puis les autres par heure de coup
// d'envoi croissante — jamais l'ordre brut renvoyé par l'API.
export function sortDayMatches(matches) {
  return [...(matches || [])].sort((a, b) => {
    const aLive = LIVE_STATUSES.includes(a.status) ? 0 : 1;
    const bLive = LIVE_STATUSES.includes(b.status) ? 0 : 1;
    if (aLive !== bLive) return aLive - bLive;
    return new Date(a.utcDate) - new Date(b.utcDate);
  });
}
