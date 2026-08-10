// Format normalisé COMMUN à toutes les sources et à tous les sports (bloc 2, point 2).
//
// Chaque source — quelle que soit la forme de sa réponse — est convertie vers un seul
// et même objet :
//   { id, sport, tournoi, pays, categorie, joueur1, joueur2, debutUtc, statut, source }
//
// L'intérêt n'est pas cosmétique : tant que chaque source gardait sa propre forme, on
// ne pouvait ni dédupliquer entre sources, ni trier l'ensemble, ni brancher une source
// de secours sans réécrire l'appelant. Le basket utilise le MÊME format que le tennis
// pour cette raison exacte, alors qu'il n'a pas encore de source de secours.

// Fenêtre commune : aujourd'hui 00h00 UTC → J+7 23h59:59 UTC.
export const HORIZON_DAYS = 7;

export function fenetreUtc(now = Date.now()) {
  const debut = new Date(now);
  debut.setUTCHours(0, 0, 0, 0);
  const fin = new Date(debut.getTime() + HORIZON_DAYS * 24 * 3600000);
  fin.setUTCHours(23, 59, 59, 999);
  return { debutUtc: debut.toISOString(), finUtc: fin.toISOString() };
}

function texte(v) {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

// Comparaison de noms insensible à la casse ET aux accents (demandé) : "Muller",
// "MÜLLER" et "müller" désignent le même joueur. La ponctuation et les espaces sont
// également neutralisés — les sources écrivent "Djokovic N." / "N. Djokovic" /
// "Novak Djokovic" pour la même personne.
export function normaliserNom(nom) {
  return (nom || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function normaliserMatch(brut) {
  return {
    id: texte(brut?.id),
    sport: brut?.sport || null,
    tournoi: texte(brut?.tournoi),
    pays: texte(brut?.pays),
    categorie: texte(brut?.categorie),
    joueur1: texte(brut?.joueur1),
    joueur2: texte(brut?.joueur2),
    debutUtc: texte(brut?.debutUtc),
    statut: texte(brut?.statut) || "inconnu",
    source: texte(brut?.source),
  };
}

// Deux matchs sont le MÊME match si les deux mêmes joueurs commencent à moins de
// 30 minutes d'écart (demandé). L'ordre des joueurs est neutralisé : une source peut
// inverser domicile/extérieur, ou p1/p2.
const ECART_MAX_MS = 30 * 60 * 1000;

function memeAffiche(a, b) {
  const ja = [normaliserNom(a.joueur1), normaliserNom(a.joueur2)].sort();
  const jb = [normaliserNom(b.joueur1), normaliserNom(b.joueur2)].sort();
  if (!ja[0] || !ja[1]) return false;
  return ja[0] === jb[0] && ja[1] === jb[1];
}

function ecartAcceptable(a, b) {
  const ta = Date.parse(a.debutUtc);
  const tb = Date.parse(b.debutUtc);
  // Une source peut ne pas encore connaître l'heure (l'ordre du jour n'est pas publié).
  // Deux fois la même affiche sans horaire exploitable reste le même match.
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return true;
  return Math.abs(ta - tb) <= ECART_MAX_MS;
}

// « En cas de doublon, garde l'entrée la plus complète » : on compte les champs
// réellement renseignés plutôt que de privilégier arbitrairement une source.
function completude(m) {
  return ["tournoi", "pays", "categorie", "joueur1", "joueur2", "debutUtc", "statut"].filter(
    (k) => m[k] && m[k] !== "inconnu"
  ).length;
}

export function dedupliquer(matchs) {
  const gardes = [];
  for (const m of matchs) {
    const i = gardes.findIndex((g) => memeAffiche(g, m) && ecartAcceptable(g, m));
    if (i === -1) {
      gardes.push(m);
      continue;
    }
    // À doublon, on garde la version la plus complète, et on complète champ par champ
    // avec l'autre : deux sources partielles valent mieux qu'une seule tronquée.
    const [riche, pauvre] = completude(m) > completude(gardes[i]) ? [m, gardes[i]] : [gardes[i], m];
    gardes[i] = {
      ...riche,
      tournoi: riche.tournoi || pauvre.tournoi,
      pays: riche.pays || pauvre.pays,
      categorie: riche.categorie || pauvre.categorie,
      debutUtc: riche.debutUtc || pauvre.debutUtc,
    };
  }
  return gardes;
}

// Tri final par debutUtc croissant (demandé). Un match sans horaire connu passe en
// fin de liste plutôt que d'être écarté : c'est un état réel, pas une donnée manquante.
export function trierParDebut(matchs) {
  return [...matchs].sort((a, b) => {
    const ta = Date.parse(a.debutUtc);
    const tb = Date.parse(b.debutUtc);
    if (!Number.isFinite(ta)) return Number.isFinite(tb) ? 1 : 0;
    if (!Number.isFinite(tb)) return -1;
    return ta - tb;
  });
}

export function dansLaFenetre(m, { debutUtc, finUtc }) {
  if (!m.debutUtc) return false;
  const t = Date.parse(m.debutUtc);
  return Number.isFinite(t) && t >= Date.parse(debutUtc) && t <= Date.parse(finUtc);
}

// Passerelle vers la forme historique du site (celle que components/MatchCard.js et
// lib/upcomingMatches.js savent déjà afficher). Le format normalisé est la vérité
// interne ; cette conversion n'existe que pour ne pas réécrire tout l'affichage.
export function versFormeBlume(m) {
  const tournoi = m.tournoi || "Compétition non communiquée";
  return {
    id: m.id,
    status: m.statut === "en_cours" ? "IN_PLAY" : m.statut === "termine" ? "FINISHED" : "SCHEDULED",
    utcDate: m.debutUtc,
    competition: { code: tournoi, name: tournoi, area: m.pays || "", category: m.categorie || "" },
    homeTeam: { id: "", name: m.joueur1 || "", crest: "" },
    awayTeam: { id: "", name: m.joueur2 || "", crest: "" },
    score: { fullTime: { home: null, away: null } },
  };
}
