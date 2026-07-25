// Traduit les erreurs Supabase Auth les plus courantes à l'INSCRIPTION en messages
// clairs, en français — voir aussi pages/login.js (friendlyAuthError, non modifié ici),
// qui couvre en plus les erreurs propres à la CONNEXION (email non confirmé,
// identifiants invalides), non pertinentes pour un formulaire de création de compte.
export function friendlySignupError(error) {
  const code = error?.code || "";
  const msg = (error?.message || "").toLowerCase();

  if (code === "user_already_exists" || msg.includes("already registered")) {
    return "Un compte existe déjà avec cet email. Connecte-toi plutôt.";
  }
  if (code === "weak_password" || msg.includes("password should be at least")) {
    return "Le mot de passe doit contenir au moins 6 caractères.";
  }
  if (code === "over_email_send_rate_limit" || msg.includes("rate limit")) {
    return "Trop de tentatives en peu de temps. Réessaie dans quelques minutes.";
  }
  if (code === "validation_failed" || msg.includes("email") && msg.includes("invalid")) {
    return "Adresse email invalide.";
  }
  if (msg.includes("invalid path specified")) {
    return "Erreur de configuration du service de connexion. Réessaie dans quelques instants ; si ça persiste, préviens l'administrateur du site.";
  }
  return error?.message || "Une erreur est survenue lors de la création du compte.";
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
  if (msg.includes("invalid path specified")) {
    return "Erreur de configuration du service de connexion. Réessaie dans quelques instants ; si ça persiste, préviens l'administrateur du site.";
  }
  return error?.message || "Une erreur est survenue.";
}
