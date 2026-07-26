import { getSupabaseAdmin } from "../../../lib/supabaseAdmin";
import { createSessionToken, setSessionCookie } from "../../../lib/session";
import { isSameOriginRequest } from "../../../lib/security/sameOrigin";

export const config = { api: { bodyParser: true } };

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Connexion SANS mot de passe, SANS code, SANS lien magique, SANS Google (voir
// PROMPT) : un email tape, un clic sur "Continuer" (pages/connexion.js), un compte
// connecté immédiatement. Aucun email n'est envoyé par Supabase — cette route ne
// touche jamais à supabase.auth.*, uniquement à la table "profiles" (voir
// supabase/migrations/0008_custom_auth.sql) via la clé service_role.
//
// Il n'y a plus de distinction inscription/connexion : l'upsert (onConflict: email)
// crée le compte au premier passage sur cet email, ou retrouve la ligne existante —
// un seul parcours, un seul code (voir PROMPT, point 3 : "si l'email n'existe pas,
// le compte est créé automatiquement").
//
// Les messages d'erreur renvoyés ici sont déjà des phrases françaises précises
// (jamais "contactez l'administrateur", voir PROMPT point 7) : contrairement à
// l'ancien système (Supabase Auth), il n'y a plus besoin d'une couche de traduction
// séparée — cette route EST la source du message affiché tel quel sur /connexion.
// AUCUN détail technique de base de données (message Postgres/PostgREST brut,
// nom de colonne, etc.) ne doit jamais atteindre le client : loggé côté serveur
// (console.error) et remplacé par une phrase générique côté réponse HTTP.
//
// L'upsert est volontairement scindé en DEUX appels distincts (voir PROMPT) : seul
// le premier (id + email) conditionne la connexion — une colonne non essentielle
// absente ou un cache de schéma PostgREST périmé sur `last_login_at` ne doit JAMAIS
// empêcher qui que ce soit de se connecter. C'est exactement ce qui s'est produit une
// fois en production ("Could not find the 'last_login_at' column ... in the schema
// cache") : les deux étaient combinés dans un seul upsert, donc un souci sur la
// colonne accessoire faisait échouer l'authentification elle-même.
//
// AUCUNE limitation de débit ici, volontairement (voir PROMPT : "un même email doit
// pouvoir se connecter autant de fois qu'il veut d'affilée, sans aucun blocage") : ni
// compteur en mémoire, ni table Supabase de tentatives, ni cookie/localStorage de
// cooldown — seule reste la vérification d'origine (CSRF), qui ne bloque jamais un
// visiteur légitime répétant la même action depuis le site lui-même, seulement une
// requête forgée depuis un autre site.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  if (!isSameOriginRequest(req)) {
    return res.status(403).json({ error: "Non autorisé" });
  }

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

  // 1) Appel ESSENTIEL — seul celui-ci conditionne la connexion : id + email
  // uniquement, jamais last_login_at ici. Si ça échoue, aucune session n'est créée
  // (message générique côté client, détail réel dans les logs serveur).
  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .upsert({ email: cleanEmail }, { onConflict: "email" })
    .select("id, email")
    .single();

  if (error || !profile) {
    console.error("Échec de l'upsert essentiel sur profiles (connexion) :", error?.message || "réponse vide de la base de données");
    return res.status(500).json({ error: "Impossible de te connecter pour l'instant. Réessaie dans un instant." });
  }

  // 2) Appel ACCESSOIRE, isolé — met à jour last_login_at "au mieux" : une colonne
  // absente, un cache de schéma PostgREST périmé ou une erreur réseau ici ne doivent
  // JAMAIS empêcher la connexion, qui a déjà réussi à l'étape 1. Seulement loggé.
  try {
    const { error: lastLoginError } = await supabaseAdmin
      .from("profiles")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", profile.id);
    if (lastLoginError) {
      console.error("Échec de la mise à jour de last_login_at (non bloquant) :", lastLoginError.message);
    }
  } catch (e) {
    console.error("Échec de la mise à jour de last_login_at (non bloquant) :", e.message);
  }

  const token = createSessionToken({ id: profile.id, email: profile.email }, process.env.AUTH_SESSION_SECRET);
  setSessionCookie(res, token);
  return res.status(200).json({ ok: true });
}
