// Modèle "propriétaire unique" : SEUL le compte dont l'email correspond à la
// variable d'environnement ADMIN_EMAIL est autorisé à effectuer des actions
// d'administration (voir PROMPT, point 8). Jamais écrite en dur ici ni ailleurs dans
// le code — fournie au runtime via les variables d'environnement Vercel (jamais
// NEXT_PUBLIC_*, donc jamais exposée au navigateur).
//
// Être connecté (avoir une session valide, voir lib/session.js) ne donne AUCUN droit
// de modification : cette vérification est un contrôle SUPPLÉMENTAIRE, jamais
// remplacé par la simple présence d'une session. Elle doit être appelée sur CHAQUE
// route d'écriture, jamais uniquement pour masquer un bouton côté client (voir
// pages/api/admin/recompute.js pour l'exemple d'usage).
//
// REFUS PAR DÉFAUT : toute situation ambiguë (ADMIN_EMAIL absente, session absente)
// est traitée comme "pas l'administrateur" — jamais une autorisation implicite.
// `session` est ici l'objet renvoyé par lib/session.js#getSession (`{ id, email }`
// ou `null`), jamais un email brut passé séparément : ça empêcherait un appelant de
// comparer un email à la légère sans avoir de VRAIE session vérifiée derrière (jeton
// signé, non expiré — voir lib/session.js#verifySessionToken).
export function isAdmin(session) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return false;

  const email = session?.email;
  if (!email) return false;

  return email.toLowerCase() === adminEmail.trim().toLowerCase();
}

// Erreur dédiée (jamais un message qui révèle quel compte est l'administrateur) —
// portée par un code HTTP explicite pour que l'appelant (route API, page) puisse la
// traduire directement en réponse 403 générique.
export class AdminRequiredError extends Error {
  constructor() {
    super("Non autorisé");
    this.statusCode = 403;
  }
}

// Lève systématiquement si `session` n'est pas celle de l'administrateur — jamais un
// simple retour silencieux : l'appelant doit explicitement attraper cette erreur
// (voir pages/api/admin/recompute.js) pour ne jamais oublier le contrôle par
// inadvertance.
export function requireAdmin(session) {
  if (!isAdmin(session)) {
    throw new AdminRequiredError();
  }
}
