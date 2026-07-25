// Traduit les erreurs Supabase Auth en messages clairs, en français — connexion SANS
// mot de passe (voir pages/connexion.js) : "Continuer avec Google" (OAuth) ou email +
// code à 6 chiffres (OTP). Un seul écran, une seule fonction d'erreur : il n'y a plus
// de distinction inscription/connexion côté Supabase non plus (signInWithOtp crée le
// compte automatiquement s'il n'existe pas encore, signInWithOAuth de même).
const GENERIC_ERROR = "Une erreur est survenue. Réessaie dans quelques instants ; si ça persiste, préviens l'administrateur du site.";

// supabase-js (@supabase/auth-js) a un comportement surprenant pour TOUTE réponse
// HTTP 5xx (500-504, 520-530) : au lieu de lire le corps JSON de la réponse (qui
// contient pourtant un message exploitable), la librairie construit son erreur à
// partir de l'objet Response brut *avant* de lire son corps (voir node_modules/
// @supabase/auth-js/dist/main/lib/fetch.js: handleError()). Comme un Response n'a ni
// `.msg` ni `.message` ni `.error_description` ni `.error`, son "message" devient
// `JSON.stringify(responseBrute)`, qui vaut littéralement la chaîne "{}" (un Response
// n'a aucune propriété énumérable) — repéré et corrigé en reproduisant ce
// comportement dans un vrai navigateur contre un faux serveur Supabase renvoyant un
// vrai 500 (voir la conversation de correction du bug initial à l'inscription).
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

export function friendlyAuthError(error) {
  const code = error?.code || error?.error_code || "";
  const msg = (error?.message || "").toLowerCase();

  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || code === "over_sms_send_rate_limit" || msg.includes("rate limit")) {
    return "Trop de tentatives en peu de temps. Réessaie dans quelques minutes.";
  }
  if (code === "validation_failed" || code === "email_address_invalid" || (msg.includes("email") && msg.includes("invalid"))) {
    return "Adresse email invalide.";
  }
  // Code à 6 chiffres expiré (plus de 10 minutes, voir configuration Supabase — durée
  // du code) ou tout simplement faux : même message dans les deux cas, jamais
  // d'indice permettant de deviner lequel des deux (ni de tenter plusieurs codes).
  if (code === "otp_expired" || msg.includes("token has expired") || msg.includes("invalid otp") || msg.includes("token is invalid")) {
    return "Ce code est invalide ou a expiré. Demande-en un nouveau.";
  }
  if (code === "otp_disabled" || code === "email_provider_disabled" || code === "signup_disabled") {
    return "La connexion par email est momentanément indisponible. Réessaie plus tard ou utilise Google.";
  }
  if (code === "provider_disabled" || code === "oauth_provider_not_supported") {
    return "La connexion avec Google est momentanément indisponible. Réessaie plus tard ou utilise ton email.";
  }
  if (code === "bad_oauth_state" || code === "bad_oauth_callback") {
    return "La connexion avec Google a échoué (session expirée). Réessaie.";
  }
  // "access_denied" : la personne a annulé/refusé sur l'écran de consentement Google.
  // "server_error"/"temporarily_unavailable" : erreur renvoyée PAR Google lui-même
  // pendant l'échange (ex. redirect URI non autorisée côté Google Cloud Console).
  if (code === "access_denied") {
    return "Connexion annulée.";
  }
  if (code === "server_error" || code === "temporarily_unavailable") {
    return "La connexion avec Google a échoué. Réessaie dans quelques instants ou utilise ton email.";
  }
  if (msg.includes("invalid path specified") || code === "missing_config") {
    return "Erreur de configuration du service de connexion. Réessaie dans quelques instants ; si ça persiste, préviens l'administrateur du site.";
  }
  // 5xx (dont "Database error saving new user") : message français clair plutôt que
  // "{}" (voir isServerSideFailure ci-dessus).
  if (code === "unexpected_failure" || isServerSideFailure(error)) {
    return "Le service de connexion a rencontré une erreur technique. Réessaie dans quelques instants ; si ça persiste, préviens l'administrateur du site.";
  }
  return isDisplayableMessage(error?.message) ? error.message : GENERIC_ERROR;
}
