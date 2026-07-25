// Modèle "propriétaire unique" : SEUL le compte dont l'email VÉRIFIÉ correspond à la
// variable d'environnement OWNER_EMAIL est autorisé à effectuer des actions
// d'administration. Jamais écrite en dur ici ni ailleurs dans le code — fournie au
// runtime via les variables d'environnement Vercel (jamais NEXT_PUBLIC_*, donc jamais
// exposée au navigateur).
//
// Pourquoi l'email est désormais la vérification PRINCIPALE (et non plus l'id) : la
// connexion se fait maintenant sans mot de passe, uniquement via un code reçu par
// email (voir pages/connexion.js) — c'est l'email qui est l'identifiant que le
// propriétaire choisit et reconnaît lui-même (contrairement à l'id Supabase, une
// valeur opaque qu'il ne voit jamais). "vérifié" n'est jamais une simple déclaration :
// la connexion par code n'aboutit QUE si le code reçu sur CETTE boîte mail a été
// saisi avec succès — Supabase renseigne alors `email_confirmed_at` ; on l'exige
// explicitement ici pour ne jamais dépendre uniquement d'un champ `email` déclaratif.
//
// REFUS PAR DÉFAUT : toute situation ambiguë (OWNER_EMAIL absente, session absente,
// invalide, email non vérifié) est traitée comme "pas le propriétaire" — jamais une
// autorisation implicite. `session` est ici un objet Supabase Auth `{ user: { id,
// email, email_confirmed_at } }` (ou équivalent), jamais un id/email brut passé
// séparément : ça empêcherait un appelant de comparer un email à la légère sans avoir
// de VRAIE session vérifiée derrière (voir lib/supabaseServer.js — la session doit
// venir de `supabase.auth.getUser()`, qui revalide le jeton auprès de Supabase, jamais
// de `getSession()` seul côté serveur).
export function isOwner(session) {
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail) return false;

  const user = session?.user;
  if (!user) return false;

  const userEmail = user.email;
  if (!userEmail || userEmail.toLowerCase() !== ownerEmail.trim().toLowerCase()) return false;

  // Email non vérifié (ne devrait jamais arriver après une connexion par code
  // réussie, voir commentaire ci-dessus) : refusé quand même, jamais une exception.
  if (!user.email_confirmed_at) return false;

  // OWNER_ID reste supporté et OPTIONNEL : si renseignée, elle RESSERRE encore la
  // vérification (les deux doivent correspondre) — elle n'affaiblit jamais le
  // contrôle par email, et son absence ne dispense jamais de la vérification par email.
  const ownerId = process.env.OWNER_ID;
  if (ownerId && user.id !== ownerId) return false;

  return true;
}

// Erreur dédiée (jamais un message qui révèle quel compte est le propriétaire) —
// portée par un code HTTP explicite pour que l'appelant (route API, page) puisse la
// traduire directement en réponse 403 générique.
export class OwnerRequiredError extends Error {
  constructor() {
    super("Non autorisé");
    this.statusCode = 403;
  }
}

// Lève systématiquement si `session` n'est pas celle du propriétaire — jamais un
// simple retour silencieux : l'appelant doit explicitement attraper cette erreur
// (voir pages/api/admin/recompute.js) pour ne jamais oublier le contrôle par
// inadvertance.
export function requireOwner(session) {
  if (!isOwner(session)) {
    throw new OwnerRequiredError();
  }
}
