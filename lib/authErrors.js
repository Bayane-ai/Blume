// Un message n'est montrable à la personne que si on est SÛR qu'il s'agit de texte
// lisible (pas un objet sérialisé, pas vide, pas juste de la ponctuation) — voir
// isDisplayableMessage plus bas pour la raison précise.
const GENERIC_SIGNUP_ERROR = "Une erreur est survenue lors de la création du compte. Réessaie dans quelques instants ; si ça persiste, préviens l'administrateur du site.";
const GENERIC_SIGNIN_ERROR = "Une erreur est survenue. Réessaie dans quelques instants ; si ça persiste, préviens l'administrateur du site.";

// supabase-js (@supabase/auth-js) a un comportement surprenant pour TOUTE réponse
// HTTP 5xx (500-504, 520-530) : au lieu de lire le corps JSON de la réponse (qui
// contient pourtant un message exploitable, ex. {"error_code":"unexpected_failure",
// "msg":"Database error saving new user"} — ce que renvoie Supabase quand le trigger
// "on_auth_user_created" échoue, voir supabase/migrations/0005_profiles.sql et
// 0007_signup_resilience.sql), la librairie construit son erreur à partir de l'objet
// Response brut *avant* de lire son corps (voir node_modules/@supabase/auth-js/dist/
// main/lib/fetch.js: handleError()). Comme un Response n'a ni `.msg` ni `.message`
// ni `.error_description` ni `.error`, son "message" devient
// `JSON.stringify(responseBrute)`, qui vaut littéralement la chaîne "{}" (un Response
// n'a aucune propriété énumérable) — un utilisateur qui tombe sur un 500 (ex. compte
// créé alors que le pseudo choisi est déjà pris, ou toute autre panne côté base de
// données) voyait donc s'afficher "{}", jamais un message clair. Repéré et corrigé en
// reproduisant ce comportement dans un vrai navigateur contre un faux serveur
// Supabase renvoyant un vrai 500 (voir la conversation de correction du bug).
function isServerSideFailure(error) {
  return error?.name === "AuthRetryableFetchError" || (typeof error?.status === "number" && error.status >= 500);
}

// Un `.message` n'est digne de confiance que s'il ressemble à du texte qu'une
// personne peut lire — jamais un JSON sérialisé ("{}", "{\"code\":500}"...) ni une
// chaîne vide. Filet de sécurité qui s'ajoute à isServerSideFailure() : si une future
// version de supabase-js renvoie un autre objet non-Response dont le JSON.stringify
// ressemble à ça, on ne l'affiche pas non plus tel quel.
function isDisplayableMessage(message) {
  if (typeof message !== "string") return false;
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (trimmed === "{}" || trimmed === "[]") return false;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
  return true;
}

// Traduit les erreurs Supabase Auth les plus courantes à l'INSCRIPTION en messages
// clairs, en français — voir aussi pages/login.js (friendlyAuthError, non modifié ici),
// qui couvre en plus les erreurs propres à la CONNEXION (email non confirmé,
// identifiants invalides), non pertinentes pour un formulaire de création de compte.
export function friendlySignupError(error) {
  const code = error?.code || error?.error_code || "";
  const msg = (error?.message || "").toLowerCase();

  if (code === "user_already_exists" || code === "email_exists" || msg.includes("already registered")) {
    return "Un compte existe déjà avec cet email. Connecte-toi plutôt.";
  }
  if (code === "weak_password" || msg.includes("password should be at least")) {
    return "Le mot de passe doit contenir au moins 6 caractères.";
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || msg.includes("rate limit")) {
    return "Trop de tentatives en peu de temps. Réessaie dans quelques minutes.";
  }
  if (code === "validation_failed" || (msg.includes("email") && msg.includes("invalid"))) {
    return "Adresse email invalide.";
  }
  if (msg.includes("invalid path specified") || code === "missing_config") {
    return "Erreur de configuration du service de connexion. Réessaie dans quelques instants ; si ça persiste, préviens l'administrateur du site.";
  }
  // 500 (dont "Database error saving new user", ex. contrainte d'unicité sur le
  // pseudo ou tout autre souci d'écriture en base) : message français clair plutôt
  // que "{}" (voir isServerSideFailure ci-dessus) — le compte n'a PAS été créé.
  if (code === "unexpected_failure" || isServerSideFailure(error)) {
    return "Le compte n'a pas pu être créé pour le moment (erreur technique côté serveur). Réessaie dans quelques instants ; si ça persiste, préviens l'administrateur du site.";
  }
  return isDisplayableMessage(error?.message) ? error.message : GENERIC_SIGNUP_ERROR;
}

// Traduit les erreurs Supabase Auth les plus courantes à la CONNEXION (pages/connexion.js) —
// même mapping que pages/login.js (friendlyAuthError, non modifié ici, toujours utilisé
// par cette page héritée), factorisé ici pour ne pas dupliquer cette logique dans un
// second formulaire de connexion.
export function friendlySigninError(error) {
  const code = error?.code || "";
  const msg = (error?.message || "").toLowerCase();

  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) {
    return "Ton adresse email n'est pas encore confirmée. Vérifie ta boîte mail (et les spams) et clique sur le lien reçu avant de te connecter.";
  }
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) {
    return "Email ou mot de passe incorrect.";
  }
  if (code === "over_email_send_rate_limit" || msg.includes("rate limit")) {
    return "Trop de tentatives en peu de temps. Réessaie dans quelques minutes.";
  }
  if (msg.includes("invalid path specified") || code === "missing_config") {
    return "Erreur de configuration du service de connexion. Réessaie dans quelques instants ; si ça persiste, préviens l'administrateur du site.";
  }
  // Voir isServerSideFailure() ci-dessus : un 5xx ne doit jamais afficher "{}".
  if (isServerSideFailure(error)) {
    return "Le service de connexion est momentanément indisponible. Réessaie dans quelques instants.";
  }
  return isDisplayableMessage(error?.message) ? error.message : GENERIC_SIGNIN_ERROR;
}
