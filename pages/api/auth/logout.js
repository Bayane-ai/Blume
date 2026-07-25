import { clearSessionCookie } from "../../../lib/session";

// Efface le cookie de session (voir PROMPT point 4) — jamais besoin d'appeler
// Supabase (aucune session Supabase Auth n'existe dans ce système), juste retirer le
// cookie httpOnly côté client via un Set-Cookie qui l'expire immédiatement.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }
  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}
