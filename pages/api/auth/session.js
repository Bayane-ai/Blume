import { getSession } from "../../../lib/session";

// Le cookie de session est httpOnly (voir lib/session.js) — volontairement illisible
// depuis le JavaScript du navigateur (seule vraie protection contre le vol de session
// par XSS). lib/useRequireAuth.js (et tout code client qui a besoin de savoir "est-ce
// que je suis connecté ?") doit donc le demander au SERVEUR via cette route, plutôt
// que de lire un cookie ou d'appeler un SDK d'auth côté client — il n'y en a plus.
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const session = getSession(req);
  return res.status(200).json({ session });
}
