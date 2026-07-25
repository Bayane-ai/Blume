// Modèle "propriétaire unique" : SEUL le compte identifié par les variables
// d'environnement OWNER_ID (et, si renseignée, OWNER_EMAIL) est autorisé à effectuer
// des actions d'administration. Ni l'une ni l'autre ne sont jamais écrites en dur ici
// ni ailleurs dans le code — elles sont fournies au runtime via les variables
// d'environnement Vercel (jamais NEXT_PUBLIC_*, donc jamais exposées au navigateur).
//
// REFUS PAR DÉFAUT : toute situation ambiguë (OWNER_ID absent, session absente,
// invalide, sans id) est traitée comme "pas le propriétaire" — jamais une
// autorisation implicite. `session` est ici un objet Supabase Auth `{ user: { id,
// email } }` (ou équivalent), jamais un id/email brut passé séparément : ça empêcherait
// un appelant de comparer un id à la légère sans avoir de VRAIE session vérifiée
// derrière (voir lib/supabaseServer.js — la session doit venir de
// `supabase.auth.getUser()`, qui revalide le jeton auprès de Supabase, jamais de
// `getSession()` seul côté serveur).
export function isOwner(session) {
  const ownerId = process.env.OWNER_ID;
  if (!ownerId) return false;

  const userId = session?.user?.id;
  if (!userId || userId !== ownerId) return false;

  // OWNER_EMAIL est optionnelle : si elle est renseignée, elle RESSERRE la
  // vérification (les deux doivent correspondre) — elle n'affaiblit jamais le
  // contrôle par id, et son absence ne dispense jamais de la vérification par id.
  const ownerEmail = process.env.OWNER_EMAIL;
  if (ownerEmail) {
    const userEmail = session?.user?.email;
    if (!userEmail || userEmail.toLowerCase() !== ownerEmail.toLowerCase()) return false;
  }

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
