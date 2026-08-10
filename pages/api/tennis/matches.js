// Matchs de tennis — chaîne de trois sources, côté serveur uniquement (bloc 2).
//
// Cette route répondait autrefois par un refus ÉCRIT EN DUR (« non disponibles avec
// cette source, plan gratuit »). Ce refus était non seulement une décision du code,
// il était FAUX : le tier gratuit de Live Tennis API expose bien un calendrier
// (GET /fixtures), vérifié sur le client officiel du fournisseur. C'est la raison de
// fond pour laquelle l'onglet tennis restait vide.
//
// Ordre d'interrogation, avec passage automatique à la suivante si la précédente
// échoue OU renvoie 0 match (voir lib/sports/tennis/sources.js et lib/sourceCascade.js) :
//   A — SportScore
//   B — Live Tennis API  GET /fixtures
//   C — Live Tennis API  GET /matches?status=upcoming
//
// Aucun filtre de tournoi, de circuit ni de pays. Toujours HTTP 200, jamais de 502 :
// un vide et une panne sont deux faits différents, et la réponse dit lequel des deux
// s'est produit.
import { chaineTennis } from "../../../lib/sports/tennis/sources";
import { runCascade } from "../../../lib/sourceCascade";
import { readRouteCache, writeRouteCache } from "../../../lib/routeCache";
import {
  fenetreUtc,
  dedupliquer,
  trierParDebut,
  dansLaFenetre,
  versFormeBlume,
} from "../../../lib/normalizedMatch";

export default async function handler(req, res) {
  const fenetre = fenetreUtc();

  // Cache serveur 60 s par sport (bloc 1, point 8). La clé porte le jour : un
  // changement de journée invalide l'entrée sans attendre l'expiration.
  const cacheKey = `tennis:${fenetre.debutUtc.slice(0, 10)}`;
  const enCache = readRouteCache(cacheKey);
  if (enCache) {
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ ...enCache, cache: true });
  }

  const debutMs = Date.now();
  const cascade = await runCascade(chaineTennis());

  // Déduplication (mêmes deux joueurs à moins de 30 min d'écart), puis fenêtre, puis
  // tri par heure de début croissante.
  const matches = trierParDebut(dedupliquer(cascade.matches)).filter((m) => dansLaFenetre(m, fenetre));

  // Journal structuré, lisible dans les logs Vercel : ce que chaque source a réellement
  // répondu, jamais un résumé qui masquerait une source muette.
  console.log(
    JSON.stringify({
      tag: "blume.matches",
      sport: "tennis",
      fenetre,
      matchs: matches.length,
      dureeMs: Date.now() - debutMs,
      sources: cascade.attempts.map((a) => ({ nom: a.nom, statut: a.statut, httpCode: a.httpCode, recus: a.recus, erreur: a.erreur })),
    })
  );

  // Regroupement par tournoi, forme historique que l'affichage sait déjà lire.
  const parTournoi = new Map();
  for (const m of matches) {
    const b = versFormeBlume(m);
    const nom = b.competition.name;
    if (!parTournoi.has(nom)) parTournoi.set(nom, { code: b.competition.code, name: nom, area: b.competition.area, matches: [] });
    parTournoi.get(nom).matches.push({ ...b, pronostic: { available: false } });
  }

  const sources = cascade.attempts.map((a) => ({
    nom: a.nom,
    statut: a.statut,
    httpCode: a.httpCode,
    recus: a.recus,
    erreur: a.erreur,
  }));

  const payload = {
    // Forme exigée par le bloc 2.
    matches,
    sources,
    fenetre,
    cache: false,
    // Forme historique, conservée pour que l'affichage et le reste du site continuent
    // de fonctionner sans réécriture (voir lib/upcomingMatches.js).
    competitions: [...parTournoi.values()].sort((a, b) => a.name.localeCompare(b.name)),
    diagnostic: {
      source: sources.map((s) => s.nom).join(" → "),
      window: { from: fenetre.debutUtc.slice(0, 10), to: fenetre.finUtc.slice(0, 10) },
      upstreamStatus: cascade.attempts.find((a) => a.recus > 0)?.httpCode ?? cascade.attempts[0]?.httpCode ?? null,
      received: cascade.matches.length,
      inWindow: matches.length,
      sources: cascade.attempts,
      allSourcesFailed: cascade.allSourcesFailed,
      anySourceFailed: cascade.anySourceFailed,
      error: cascade.error,
    },
  };

  // Une réponse dégradée n'est jamais mise en cache : une panne de quelques secondes
  // ne doit pas figer le sport pendant une minute entière.
  if (!cascade.anySourceFailed) writeRouteCache(cacheKey, payload);

  res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
  return res.status(200).json(payload);
}
