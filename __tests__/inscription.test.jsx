/**
 * @jest-environment jsdom
 *
 * Bloc 2 : page d'inscription "/inscription" — email, mot de passe + confirmation,
 * date de naissance (>= 18 ans), pseudo, case "J'accepte les conditions" obligatoire.
 * À la validation : crée le compte Supabase (email/mot de passe), passe le pseudo et
 * la date de naissance en métadonnées (recopiées dans "profiles" par le trigger SQL,
 * voir supabase/migrations/0005_profiles.sql). Connexion automatique + redirection
 * vers l'accueil quand Supabase renvoie une session immédiate ; sinon message clair
 * (confirmation par email requise).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Inscription from "../pages/inscription";

const pushMock = jest.fn();
jest.mock("next/router", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const signUp = jest.fn();
const rpc = jest.fn();
jest.mock("../lib/supabaseClient", () => ({
  supabase: { auth: { signUp: (...args) => signUp(...args) }, rpc: (...args) => rpc(...args) },
}));

// La date de naissance se saisit désormais en 3 champs (Jour/Mois/Année, voir
// components/DateOfBirthInput.js) plutôt qu'un unique <input type="date"> — on
// éclate ici l'ISO "AAAA-MM-JJ" en ses 3 parties pour remplir chaque champ.
function fillDateOfBirth(iso) {
  const [year, month, day] = iso.split("-");
  fireEvent.change(screen.getByLabelText("Jour de naissance"), { target: { value: day } });
  fireEvent.change(screen.getByLabelText("Mois de naissance"), { target: { value: month } });
  fireEvent.change(screen.getByLabelText("Année de naissance"), { target: { value: year } });
}

function fillValidForm({ email = "test@example.com", password = "motdepasse123", confirmPassword = "motdepasse123", dob = "2000-06-01", pseudo = "Bayane", acceptTerms = true } = {}) {
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByPlaceholderText("Mot de passe"), { target: { value: password } });
  fireEvent.change(screen.getByPlaceholderText("Confirmer le mot de passe"), { target: { value: confirmPassword } });
  if (dob) fillDateOfBirth(dob);
  fireEvent.change(screen.getByPlaceholderText("Pseudo"), { target: { value: pseudo } });
  if (acceptTerms) fireEvent.click(screen.getByRole("checkbox"));
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: /créer le compte/i }));
}

// Dates de naissance calculées par rapport à AUJOURD'HUI (pas de date figée) : la
// vérification précise de la limite exacte des 18 ans (jour J, veille...) est déjà
// couverte par les tests unitaires purs de lib/age.js (__tests__/age.test.js) — ici on
// vérifie seulement le comportement du FORMULAIRE avec un cas nettement mineur et un
// cas nettement majeur, sans dépendre d'une horloge figée (donc compatible avec les
// utilitaires asynchrones de Testing Library, qui reposent sur de vrais timers).
function isoDateYearsAgo(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

beforeEach(() => {
  signUp.mockReset().mockResolvedValue({ data: { session: null }, error: null });
  rpc.mockReset().mockResolvedValue({ data: false, error: null }); // pseudo disponible par défaut
  pushMock.mockClear();
});

test("affiche tous les champs requis : email, mot de passe, confirmation, date de naissance (3 champs), pseudo, case des conditions", () => {
  render(<Inscription />);
  expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("Mot de passe")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("Confirmer le mot de passe")).toBeInTheDocument();
  expect(screen.getByText("Date de naissance")).toBeInTheDocument();
  expect(screen.getByLabelText("Jour de naissance")).toBeInTheDocument();
  expect(screen.getByLabelText("Mois de naissance")).toBeInTheDocument();
  expect(screen.getByLabelText("Année de naissance")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("Pseudo")).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).toBeInTheDocument();
  expect(screen.getByText(/j'accepte les conditions/i)).toBeInTheDocument();
});

test('lien "Déjà un compte ? Se connecter" vers /connexion', () => {
  render(<Inscription />);
  const link = screen.getByRole("link", { name: /se connecter/i });
  expect(link).toHaveAttribute("href", "/connexion");
});

test("email invalide : message clair, jamais d'appel à Supabase", async () => {
  render(<Inscription />);
  fillValidForm({ email: "pas-un-email" });
  submit();

  await screen.findByText(/adresse email invalide/i);
  expect(signUp).not.toHaveBeenCalled();
});

test("mots de passe différents : message clair, jamais d'appel à Supabase", async () => {
  render(<Inscription />);
  fillValidForm({ password: "motdepasse123", confirmPassword: "autrechose1" });
  submit();

  await screen.findByText(/ne correspondent pas/i);
  expect(signUp).not.toHaveBeenCalled();
});

test("mot de passe trop court : message clair, jamais d'appel à Supabase", async () => {
  render(<Inscription />);
  fillValidForm({ password: "123", confirmPassword: "123" });
  submit();

  await screen.findByText(/au moins 6 caractères/i);
  expect(signUp).not.toHaveBeenCalled();
});

test("moins de 18 ans : refuse avec un message clair, jamais d'appel à Supabase", async () => {
  render(<Inscription />);
  fillValidForm({ dob: isoDateYearsAgo(15) }); // clairement mineur
  submit();

  await screen.findByText(/au moins 18 ans/i);
  expect(signUp).not.toHaveBeenCalled();
});

test("nettement majeur (30 ans) : la vérification d'âge n'empêche pas l'inscription", async () => {
  render(<Inscription />);
  fillValidForm({ dob: isoDateYearsAgo(30) });
  submit();

  await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
});

test("case des conditions non cochée : message clair, jamais d'appel à Supabase", async () => {
  render(<Inscription />);
  fillValidForm({ acceptTerms: false });
  submit();

  await screen.findByText(/accepter les conditions/i);
  expect(signUp).not.toHaveBeenCalled();
});

test("pseudo vide : message clair, jamais d'appel à Supabase", async () => {
  render(<Inscription />);
  fillValidForm({ pseudo: "   " });
  submit();

  await screen.findByText(/choisis un pseudo/i);
  expect(signUp).not.toHaveBeenCalled();
});

// Bug corrigé : "nom_utilisateur" est unique en base (voir
// supabase/migrations/0007_signup_resilience.sql) — sans cette vérification
// préalable, choisir un pseudo déjà pris déclenchait une violation de contrainte
// côté trigger, que Supabase renvoyait comme une erreur 500 générique. On vérifie
// maintenant la disponibilité du pseudo AVANT d'appeler signUp.
test("pseudo déjà utilisé : message clair, jamais d'appel à signUp", async () => {
  rpc.mockResolvedValue({ data: true, error: null });
  render(<Inscription />);
  fillValidForm({ pseudo: "Bayane" });
  submit();

  await screen.findByText(/ce pseudo est déjà utilisé/i);
  expect(rpc).toHaveBeenCalledWith("pseudo_is_taken", { p_pseudo: "Bayane" });
  expect(signUp).not.toHaveBeenCalled();
});

// La vérification de pseudo est un confort : si la fonction RPC n'est pas encore
// déployée (migration pas encore appliquée) ou échoue pour une autre raison,
// l'inscription ne doit JAMAIS être bloquée pour autant (échec ouvert).
test("la vérification du pseudo échoue (RPC indisponible) : l'inscription continue quand même", async () => {
  rpc.mockRejectedValue(new Error("RPC pseudo_is_taken introuvable"));
  render(<Inscription />);
  fillValidForm();
  submit();

  await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
});

// Bug corrigé : quand la création du profil échoue côté base (ex. collision de
// pseudo malgré tout, ou toute autre panne), Supabase Auth répond avec un HTTP 5xx
// générique — et à cause d'un comportement de supabase-js (voir lib/authErrors.js),
// le message brut de CETTE erreur précise vaut littéralement "{}", jamais du texte
// lisible. Vérifie que la page affiche bien un message français clair à la place.
test("erreur 500 de Supabase (ex. échec du trigger de création de profil) : message français clair, jamais \"{}\"", async () => {
  signUp.mockResolvedValue({
    data: null,
    error: { name: "AuthRetryableFetchError", message: "{}", status: 500 },
  });
  render(<Inscription />);
  fillValidForm();
  submit();

  await screen.findByText(/erreur technique côté serveur/i);
  expect(screen.queryByText("{}")).not.toBeInTheDocument();
});

test("inscription valide : appelle signUp avec email/mot de passe et les métadonnées pseudo/date de naissance", async () => {
  render(<Inscription />);
  fillValidForm({ email: "  Test@Example.com  ", dob: "2000-06-01", pseudo: "Bayane" });
  submit();

  await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1));
  expect(signUp).toHaveBeenCalledWith({
    email: "test@example.com",
    password: "motdepasse123",
    options: { data: { nom_utilisateur: "Bayane", date_de_naissance: "2000-06-01" } },
  });
});

test("Supabase renvoie une session immédiate (pas de confirmation email exigée) : connexion auto + redirection vers l'accueil", async () => {
  signUp.mockResolvedValue({ data: { session: { access_token: "tok" } }, error: null });
  render(<Inscription />);
  fillValidForm();
  submit();

  await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
});

test("Supabase ne renvoie aucune session (confirmation email exigée) : message clair, pas de redirection", async () => {
  signUp.mockResolvedValue({ data: { session: null }, error: null });
  render(<Inscription />);
  fillValidForm();
  submit();

  await screen.findByText(/compte créé/i);
  expect(pushMock).not.toHaveBeenCalled();
});

test("email déjà utilisé : message clair, pas de jargon Supabase", async () => {
  signUp.mockResolvedValue({ data: null, error: { code: "user_already_exists", message: "User already registered" } });
  render(<Inscription />);
  fillValidForm();
  submit();

  await screen.findByText(/un compte existe déjà/i);
  expect(screen.queryByText(/already registered/i)).not.toBeInTheDocument();
});
