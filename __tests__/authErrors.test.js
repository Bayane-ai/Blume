import { friendlySignupError, friendlySigninError } from "../lib/authErrors";

// Reproduit fidèlement ce que renvoie réellement supabase-js (@supabase/auth-js) pour
// une réponse HTTP 5xx : il construit son erreur à partir de l'objet Response BRUT
// (avant même de lire son corps JSON) — un Response n'ayant ni .msg ni .message ni
// .error_description ni .error, son "message" devient littéralement la chaîne "{}"
// (voir node_modules/@supabase/auth-js/dist/main/lib/fetch.js: handleError() /
// _getErrorMessage()). C'est exactement ce qui se produit quand le trigger
// "on_auth_user_created" échoue à l'inscription (voir
// supabase/migrations/0007_signup_resilience.sql) : Supabase répond alors 500
// "Database error saving new user" — et sans le correctif ci-dessous, la personne
// voyait s'afficher "{}", jamais un message compréhensible.
function fakeAuthRetryableFetchError(status = 500) {
  return { name: "AuthRetryableFetchError", message: "{}", status };
}

describe("friendlySignupError", () => {
  test("une erreur 5xx (trigger de création de profil en échec, etc.) : message français clair, jamais \"{}\"", () => {
    const msg = friendlySignupError(fakeAuthRetryableFetchError());
    expect(msg).not.toBe("{}");
    expect(msg).not.toMatch(/^\{/);
    expect(msg).toMatch(/erreur technique|réessaie/i);
  });

  test("error_code \"unexpected_failure\" (Database error saving new user) : message clair", () => {
    const msg = friendlySignupError({ code: "unexpected_failure", message: "Database error saving new user", status: 500 });
    expect(msg).not.toMatch(/database error/i);
    expect(msg).toMatch(/erreur technique|réessaie/i);
  });

  test("un message brut ressemblant à du JSON sérialisé n'est jamais affiché tel quel", () => {
    const msg = friendlySignupError({ message: '{"code":500,"error_code":"weird"}' });
    expect(msg).not.toMatch(/^\{/);
  });

  test("email déjà utilisé (code historique user_already_exists) : message clair", () => {
    expect(friendlySignupError({ code: "user_already_exists", message: "User already registered" }))
      .toBe("Un compte existe déjà avec cet email. Connecte-toi plutôt.");
  });

  test("email déjà utilisé (nouveau code email_exists) : même message clair", () => {
    expect(friendlySignupError({ code: "email_exists", message: "Email already registered" }))
      .toBe("Un compte existe déjà avec cet email. Connecte-toi plutôt.");
  });

  test("mot de passe trop court : message clair", () => {
    expect(friendlySignupError({ code: "weak_password", message: "Password should be at least 6 characters" }))
      .toBe("Le mot de passe doit contenir au moins 6 caractères.");
  });

  test("erreur inconnue mais message lisible : le message d'origine est affiché", () => {
    expect(friendlySignupError({ message: "Une erreur métier précise et lisible." }))
      .toBe("Une erreur métier précise et lisible.");
  });

  test("aucune erreur reconnue et aucun message exploitable : message générique français, jamais vide", () => {
    const msg = friendlySignupError({});
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/erreur est survenue/i);
  });
});

describe("friendlySigninError", () => {
  test("une erreur 5xx à la connexion : message français clair, jamais \"{}\"", () => {
    const msg = friendlySigninError(fakeAuthRetryableFetchError());
    expect(msg).not.toBe("{}");
    expect(msg).toMatch(/momentanément indisponible|réessaie/i);
  });

  test("identifiants invalides : message clair", () => {
    expect(friendlySigninError({ code: "invalid_credentials", message: "Invalid login credentials" }))
      .toBe("Email ou mot de passe incorrect.");
  });
});
