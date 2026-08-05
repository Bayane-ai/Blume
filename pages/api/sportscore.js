// Relais same-origin vers l'API publique SportScore.
//
// Pourquoi : les sections "Matchs du jour" appellent d'abord sportscore.com DIRECTEMENT
// depuis le navigateur (voir lib/sportScore.js) — c'est le fonctionnement voulu, sans
// backend. Mais si ce domaine refuse l'appel navigateur (en-têtes CORS absents, filtrage
// Cloudflare, extension bloquante côté visiteur, réseau d'entreprise...), la requête
// échoue et la section n'a plus rien à afficher. Ce relais est le filet : le navigateur
// rappelle alors la MÊME donnée via le site lui-même, où la politique CORS ne s'applique
// pas (c'est un appel serveur à serveur).
//
// Aucune configuration nécessaire : cette route fait partie du site et se déploie avec
// lui (aucune clé API, SportScore étant gratuit et sans authentification).
//
// Quota : côté serveur, TOUS les visiteurs partagent l'adresse IP de l'hébergeur — la
// limite SportScore (~1000 requêtes/24h/IP) s'applique donc au site entier, pas par
// visiteur. D'où le cache CDN de 5 minutes ci-dessous, calé sur l'intervalle de
// rafraîchissement de l'interface : 3 sports × 288 rafraîchissements/jour = 864 appels
// réels par jour au maximum, quel que soit le nombre de visiteurs.
const SPORTSCORE_BASE = "https://sportscore.com";
const MATCHES_PATH = "/api/widget/matches/";
const ALLOWED_SPORTS = new Set(["football", "tennis", "basketball", "cricket"]);
const MAX_LIMIT = 50;
const CACHE_SECONDS = 300;

export default async function handler(req, res) {
  const sport = String(req.query.sport || "");
  // Liste blanche stricte : cette route ne doit jamais pouvoir servir à relayer une URL
  // arbitraire choisie par l'appelant.
  if (!ALLOWED_SPORTS.has(sport)) {
    return res.status(400).json({ error: "Sport non pris en charge" });
  }

  const requested = Number(req.query.limit);
  const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : MAX_LIMIT, 1), MAX_LIMIT);

  try {
    const upstream = await fetch(`${SPORTSCORE_BASE}${MATCHES_PATH}?sport=${sport}&limit=${limit}`, {
      headers: { Accept: "application/json" },
    });

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => "");
      console.warn(`[SportScore] relais ${sport} : HTTP ${upstream.status} — ${body.slice(0, 200)}`);
      // Le vrai code HTTP est renvoyé tel quel : la page sait ainsi distinguer "source
      // indisponible" d'un défaut du site lui-même, et /admin peut le diagnostiquer.
      return res.status(upstream.status).json({ error: `SportScore a répondu ${upstream.status}` });
    }

    const payload = await upstream.json();
    res.setHeader("Cache-Control", `s-maxage=${CACHE_SECONDS}, stale-while-revalidate=600`);
    return res.status(200).json(payload);
  } catch (e) {
    console.warn(`[SportScore] relais ${sport} injoignable : ${e.message}`);
    return res.status(502).json({ error: "Source de matchs injoignable" });
  }
}
