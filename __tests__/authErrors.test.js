import { friendlyAuthError } from "../lib/authErrors";

// Reproduit fidèlement ce que renvoie réellement supabase-js (@supabase/auth-js) pour
// une réponse HTTP 5xx : il construit son erreur à partir de l'objet Response BRUT
// (avant même de lire son corps JSON) — un Response n'ayant ni .msg ni .message ni
// .error_description ni .error, son "message" devient littéralement la chaîne "{}"
// (voir node_modules/@supabase/auth-js/dist/main/lib/fetch.js: handleError() /
// _getErrorMessage()). Sans le correctif ci-dessous, la personne voyait s'afficher
// "{}", jamais un message compréhensible.
function fakeAuthRetryableFetchError(status = 500) {
  return { name: "AuthRetryableFetchError", message: "{}", status };
}

test("une erreur 5xx : message français clair, jamais \"{}\"", () => {
  const msg = friendlyAuthError(fakeAuthRetryableFetchError());
  expect(msg).not.toBe("{}");
  expect(msg).not.toMatch(/^\{/);
  expect(msg).toMatch(/erreur technique|réessaie/i);
});

test("error_code \"unexpected_failure\" : message clair", () => {
  const msg = friendlyAuthError({ code: "unexpected_failure", message: "Database error saving new user", status: 500 });
  expect(msg).not.toMatch(/database error/i);
  expect(msg).toMatch(/erreur technique|réessaie/i);
});

test("un message brut ressemblant à du JSON sérialisé n'est jamais affiché tel quel", () => {
  const msg = friendlyAuthError({ message: '{"code":500,"error_code":"weird"}' });
  expect(msg).not.toMatch(/^\{/);
});

test("code expiré ou invalide (otp_expired) : message clair, sans indice sur la cause exacte", () => {
  expect(friendlyAuthError({ code: "otp_expired", message: "Token has expired or is invalid" }))
    .toBe("Ce code est invalide ou a expiré. Demande-en un nouveau.");
});

test("email invalide : message clair", () => {
  expect(friendlyAuthError({ code: "validation_failed", message: "Unable to validate email address: invalid format" }))
    .toBe("Adresse email invalide.");
});

test("trop de tentatives : message clair", () => {
  expect(friendlyAuthError({ code: "over_email_send_rate_limit", message: "Email rate limit exceeded" }))
    .toBe("Trop de tentatives en peu de temps. Réessaie dans quelques minutes.");
});

test("provider Google désactivé : message clair pointant vers l'alternative email", () => {
  expect(friendlyAuthError({ code: "provider_disabled", message: "Provider disabled" }))
    .toMatch(/google.*momentanément indisponible/i);
});

test("callback OAuth invalide (session expirée pendant le retour de Google) : message clair", () => {
  expect(friendlyAuthError({ code: "bad_oauth_callback", message: "..." }))
    .toMatch(/connexion avec google a échoué/i);
});

test("erreur inconnue mais message lisible : le message d'origine est affiché", () => {
  expect(friendlyAuthError({ message: "Une erreur métier précise et lisible." }))
    .toBe("Une erreur métier précise et lisible.");
});

test("aucune erreur reconnue et aucun message exploitable : message générique français, jamais vide", () => {
  const msg = friendlyAuthError({});
  expect(msg).toBeTruthy();
  expect(msg).toMatch(/erreur est survenue/i);
});

// Voir lib/supabaseClient.js : si NEXT_PUBLIC_SUPABASE_URL / ANON_KEY manquent
// (typiquement définies en Preview/Development sur Vercel mais pas en Production),
// le client renvoie ce code plutôt que de faire planter toute l'application.
test("configuration Supabase manquante (code missing_config) : message clair pointant vers un souci de configuration", () => {
  const msg = friendlyAuthError({ code: "missing_config", message: "Configuration Supabase manquante", status: 500 });
  expect(msg).toMatch(/configuration/i);
});
