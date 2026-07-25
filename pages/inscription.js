import { useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import { calculateAge } from "../lib/age";
import { friendlySignupError } from "../lib/authErrors";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_AGE = 18;

// Page "Créer un compte" (Bloc 2) — même thème visuel que le reste du site (mêmes
// tokens de couleurs/espacements que pages/login.js, voir styles ci-dessous), mais une
// page dédiée à l'inscription : pas d'onglets, un lien "Se connecter" renvoie vers
// /login (page de connexion existante — Bloc 3 s'en chargera séparément).
//
// nom_utilisateur et date_de_naissance sont passés en métadonnées à
// supabase.auth.signUp (options.data) : c'est le trigger "on_auth_user_created" (voir
// supabase/migrations/0005_profiles.sql) qui les recopie dans la table "profiles" au
// moment de la création du compte — cette page n'écrit donc jamais directement dans
// "profiles" (la Row Level Security empêcherait de toute façon une insertion directe,
// voir la migration : aucune policy d'insertion, seul le trigger security definer peut
// écrire cette ligne).
export default function Inscription() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [dateDeNaissance, setDateDeNaissance] = useState("");
  const [pseudo, setPseudo] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const cleanEmail = email.trim().toLowerCase();
    const cleanPseudo = pseudo.trim();

    if (!EMAIL_REGEX.test(cleanEmail)) {
      setError("Adresse email invalide.");
      return;
    }
    if (password.length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caractères.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    if (!dateDeNaissance) {
      setError("Indique ta date de naissance.");
      return;
    }
    const age = calculateAge(dateDeNaissance);
    if (age === null) {
      setError("Date de naissance invalide.");
      return;
    }
    if (age < MIN_AGE) {
      setError("Tu dois avoir au moins 18 ans pour créer un compte sur Blume.");
      return;
    }
    if (!cleanPseudo) {
      setError("Choisis un pseudo.");
      return;
    }
    if (!acceptedTerms) {
      setError("Tu dois accepter les conditions pour créer un compte.");
      return;
    }

    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: { data: { nom_utilisateur: cleanPseudo, date_de_naissance: dateDeNaissance } },
      });
      if (signUpError) throw signUpError;

      // Une session est renvoyée immédiatement quand la confirmation par email n'est
      // pas exigée par le projet Supabase : on connecte alors directement la personne
      // et on la renvoie vers l'accueil (voir PROMPT). Si la confirmation par email
      // EST exigée (comportement par défaut de Supabase, voir pages/login.js), aucune
      // session n'existe encore à ce stade : impossible de connecter automatiquement
      // tant que le lien de confirmation n'a pas été cliqué — message clair plutôt
      // qu'une redirection silencieuse vers une page qui la déconnecterait aussitôt.
      if (data?.session) {
        router.push("/");
      } else {
        setInfo("Compte créé. Vérifie ta boîte mail (et les spams) pour confirmer ton adresse, puis connecte-toi.");
      }
    } catch (err) {
      setError(friendlySignupError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <form onSubmit={submit} style={styles.form}>
          <h1 style={styles.h1}>Créer un compte</h1>

          {/* type="text" plutôt que "email" : la validité de l'adresse est vérifiée
              explicitement par ce composant (EMAIL_REGEX, voir PROMPT "vérifie que...
              l'email est valide") avec un message clair — la validation native du
              navigateur sur un champ type="email" bloquerait silencieusement la
              soumission du formulaire avant même d'atteindre ce code. */}
          <input
            type="text"
            inputMode="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            style={styles.input}
          />
          <input
            type="password"
            placeholder="Mot de passe"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={6}
            style={styles.input}
          />
          <input
            type="password"
            placeholder="Confirmer le mot de passe"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
            minLength={6}
            style={styles.input}
          />
          <label style={styles.fieldLabel}>
            Date de naissance
            <input
              type="date"
              value={dateDeNaissance}
              onChange={(e) => setDateDeNaissance(e.target.value)}
              required
              style={styles.input}
            />
          </label>
          <input
            type="text"
            placeholder="Pseudo"
            value={pseudo}
            onChange={(e) => setPseudo(e.target.value)}
            autoComplete="username"
            required
            style={styles.input}
          />

          <label style={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              style={styles.checkbox}
            />
            <span>J'accepte les conditions</span>
          </label>

          {error && <p style={styles.error}>{error}</p>}
          {info && <p style={styles.info}>{info}</p>}

          <button type="submit" disabled={loading} style={styles.btn}>
            {loading ? "..." : "Créer le compte"}
          </button>
        </form>

        <p style={styles.switchText}>
          Déjà un compte ?{" "}
          <a href="/login" style={styles.switchLink}>Se connecter</a>
        </p>
      </div>
    </div>
  );
}

// Mêmes tokens de couleurs/espacements/rayons que pages/login.js — même identité
// visuelle que le reste du site (voir styles/globals.css pour les variables).
const styles = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  card: {
    width: "100%", maxWidth: 360, background: "var(--card-bg)", border: "1px solid var(--border)",
    borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 16,
  },
  form: { display: "flex", flexDirection: "column", gap: 12, padding: "8px 8px 0" },
  h1: { fontSize: 20, margin: "0 0 8px", textAlign: "center" },
  input: {
    background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
    borderRadius: 9, padding: "11px 12px", fontSize: 14, width: "100%",
  },
  fieldLabel: {
    display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "var(--text-secondary)",
  },
  checkboxRow: {
    display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-primary)", cursor: "pointer",
  },
  checkbox: { width: 16, height: 16, flexShrink: 0, accentColor: "var(--accent)" },
  btn: {
    background: "var(--accent)", border: "none", color: "var(--on-accent)", fontWeight: 700,
    borderRadius: 999, padding: "11px 0", fontSize: 14, cursor: "pointer", marginTop: 6,
  },
  error: { color: "var(--negative)", fontSize: 12.5, margin: 0 },
  info: { color: "var(--accent)", fontSize: 12.5, margin: 0 },
  switchText: { textAlign: "center", fontSize: 12.5, color: "var(--text-secondary)", margin: 0, padding: "0 8px 8px" },
  switchLink: { color: "var(--accent)", fontWeight: 700, textDecoration: "none" },
};
