import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { createSessionToken, setSessionCookie } from "../../../lib/session";
import { guardMutation } from "../../../lib/security/guardMutation";

export const config = { api: { bodyParser: true } };

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Connexion SANS mot de passe, SANS code, SANS lien magique, SANS Google (voir
// PROMPT) : un email tape, un clic sur "Continuer" (pages/connexion.js), un compte
// connecté immédiatement. Aucun email n'est envoyé par Supabase — cette route ne
// touche jamais à supabase.auth.*, uniquement à la table "profiles" (voir
// supabase/migrations/0008_custom_auth.sql) via la clé service_role.
//
// Il n'y a plus de distinction inscription/connexion : l'upsert (onConflict: email)
// crée le compte au premier passage sur cet email, ou retrouve la ligne existante et
// met juste à jour last_login_at — un seul parcours, un seul code (voir PROMPT,
// point 3 : "si l'email n'existe pas, le compte est créé automatiquement").
//
// Les messages d'erreur renvoyés ici sont déjà des phrases françaises précises
// (jamais "contactez l'administrateur", voir PROMPT point 7) : contrairement à
// l'ancien système (Supabase Auth), il n'y a plus besoin d'une couche de traduction
// séparée — cette route EST la source du message affiché tel quel sur /connexion.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  // CSRF/origine + débit (20 tentatives par minute maximum PAR IP — jamais un
  // compteur global partagé entre tous les visiteurs, jamais de limite journalière
  // sur le nombre d'emails distincts : rien n'empêche donc 2000 comptes différents,
  // depuis 2000 IP différentes, de se connecter le même jour) — avant tout
  // traitement, comme sur toutes les routes de mutation du site.
  if (!guardMutation(req, res, "auth-login", { limit: 20 })) return;

  if (!process.env.AUTH_SESSION_SECRET) {
    return res.status(500).json({
      error: "Configuration serveur manquante : AUTH_SESSION_SECRET est vide dans ce déploiement. Vérifie les variables d'environnement sur Vercel (Production) et redéploie ensuite.",
    });
  }

  const rawEmail = req.body?.email;
  if (typeof rawEmail !== "string" || !rawEmail.trim()) {
    return res.status(400).json({ error: "Indique ton adresse email." });
  }
  const cleanEmail = rawEmail.trim().toLowerCase().replace(/\s+/g, "");
  if (!EMAIL_REGEX.test(cleanEmail)) {
    return res.status(400).json({ error: "Adresse email invalide." });
  }

  let supabaseAdmin;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .upsert({ email: cleanEmail, last_login_at: new Date().toISOString() }, { onConflict: "email" })
    .select()
    .single();

  if (error || !profile) {
    return res.status(500).json({ error: `Impossible de créer ou retrouver le compte : ${error?.message || "réponse vide de la base de données"}.` });
  }

  const token = createSessionToken({ id: profile.id, email: profile.email }, process.env.AUTH_SESSION_SECRET);
  setSessionCookie(res, token);
  return res.status(200).json({ ok: true });
}
