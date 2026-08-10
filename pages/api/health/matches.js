// Contrôle de santé quotidien des trois routes « matchs » (bloc 2, point 4a).
//
// Appelle RÉELLEMENT /api/football/matches, /api/basketball/matches et
// /api/tennis/matches sur la fenêtre J → J+7, et renvoie pour chaque sport : le nombre
// de matchs, le statut de chaque source, le temps de réponse et un verdict OK/ÉCHEC.
// La mesure elle-même vit dans lib/healthMatches.mjs, partagée avec le script local.
//
// Volontairement distinct de /api/health/matchs (accent), qui mesure ce que la PAGE
// affiche via loadUpcoming. Celui-ci mesure ce que les ROUTES renvoient : les deux
// répondent à des questions différentes, et les confondre masquerait un écart.
import { getSession } from "../../../lib/session";
import { isAdmin } from "../../../lib/auth/admin";
import { controlerTous } from "../../../lib/healthMatches.mjs";

// Les appels partent du serveur : `fetch` d'une route relative n'y existe pas.
function origine(req) {
  const proto = req.headers?.["x-forwarded-proto"] || "https";
  const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "localhost:3000";
  return `${proto}://${host}`;
}

// Trois portes d'entrée légitimes, et aucune autre : chaque appel déclenche de vrais
// appels réseau, qui ne doivent jamais être déclenchables par un visiteur.
//   1. le cron Vercel (en-tête `x-vercel-cron`, posé par la plateforme elle-même) ;
//   2. un secret partagé CRON_SECRET en Bearer, si la variable est configurée (Vercel
//      l'envoie automatiquement sur ses crons quand elle existe) ;
//   3. une session administrateur, pour ouvrir la page à la main dans un navigateur.
// Aucune configuration manuelle n'est nécessaire : sans CRON_SECRET, le cas 1 suffit.
export function estAutorise(req) {
  if (req.headers?.["x-vercel-cron"]) return true;
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers?.authorization === `Bearer ${secret}`) return true;
  const session = getSession(req);
  return Boolean(session && isAdmin(session.email));
}

export default async function handler(req, res) {
  if (!estAutorise(req)) {
    res.statusCode = 403;
    return res.end("Non autorisé");
  }

  const rapport = await controlerTous({ base: origine(req) });
  res.setHeader("Cache-Control", "no-store");
  // Toujours 200 : ce rapport DÉCRIT un échec, il n'en est pas un. Un code d'erreur ici
  // empêcherait de lire le diagnostic, ce qui est exactement le contraire du but.
  return res.status(200).json(rapport);
}
