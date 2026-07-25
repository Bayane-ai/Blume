// Rate limiting par IP, en mémoire — limite le scraping massif et les tentatives
// répétées sur les routes de mutation. "Best effort" par nature sur une plateforme
// serverless (Vercel) : chaque instance de fonction a sa propre mémoire, remise à
// zéro à chaque redémarrage à froid ; ce n'est donc PAS une garantie absolue à
// l'échelle de tout le trafic, seulement une première barrière peu coûteuse. Une
// protection strictement fiable multi-instances nécessiterait un magasin partagé
// (Vercel KV / Upstash Redis) — volontairement pas ajouté ici pour rester "la
// solution la plus simple", voir le rapport final.
const WINDOW_MS = 60_000;
const buckets = new Map(); // clé "ip:route" -> { count, windowStart }

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

// `limit` requêtes maximum par IP et par route, dans une fenêtre glissante de
// `windowMs` (60s par défaut) — renvoie `true` si la requête est autorisée, `false`
// si la limite est dépassée pour cette IP sur cette route.
export function checkRateLimit(req, routeKey, { limit = 20, windowMs = WINDOW_MS } = {}) {
  const ip = clientIp(req);
  const key = `${routeKey}:${ip}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

// Réservé aux tests : remet le compteur à zéro entre deux scénarios indépendants.
export function __resetRateLimitForTests() {
  buckets.clear();
}
