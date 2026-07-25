import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import { friendlySigninError } from "../lib/authErrors";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Page "Se connecter" (Bloc 3) — même thème visuel que le reste du site (mêmes tokens
// de couleurs/espacements que pages/login.js et pages/inscription.js). C'est
// désormais la première page vue par une personne non connectée (voir
// lib/useRequireAuth.js, qui redirige ici dès qu'aucune session n'est trouvée).
export default function Connexion() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  // Déjà connecté ? Inutile de repasser par cette page : direction l'application.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/");
    });
  }, [router]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const cleanEmail = email.trim().toLowerCase();
    setLoading(true);
    try {
      // Session persistante (voir PROMPT "reste connecté même s'il ferme et rouvre le
      // site") : lib/supabaseClient.js utilise createBrowserClient (@supabase/ssr),
      // qui garde la session en cookies avec rafraîchissement automatique du jeton —
      // rien à faire de spécifique ici, c'est le comportement par défaut du client.
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
      if (signInError) throw signInError;
      router.push("/");
    } catch (err) {
      setError(friendlySigninError(err));
    } finally {
      setLoading(false);
    }
  };

  const forgotPassword = async () => {
    setError(null);
    setInfo(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(cleanEmail)) {
      setError("Renseigne d'abord ton adresse email ci-dessus pour recevoir le lien de réinitialisation.");
      return;
    }

    setResetLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(cleanEmail);
      if (resetError) throw resetError;
      setInfo("Email de réinitialisation envoyé. Vérifie ta boîte mail (et les spams).");
    } catch (err) {
      setError(friendlySigninError(err));
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <form onSubmit={submit} style={styles.form}>
          <h1 style={styles.h1}>Connexion</h1>

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
            autoComplete="current-password"
            required
            style={styles.input}
          />

          <button
            type="button"
            onClick={forgotPassword}
            disabled={resetLoading}
            style={styles.forgotBtn}
          >
            {resetLoading ? "Envoi…" : "Mot de passe oublié ?"}
          </button>

          {error && <p style={styles.error}>{error}</p>}
          {info && <p style={styles.info}>{info}</p>}

          <button type="submit" disabled={loading} style={styles.btn}>
            {loading ? "..." : "Se connecter"}
          </button>
        </form>

        <p style={styles.switchText}>
          Pas encore de compte ?{" "}
          <a href="/inscription" style={styles.switchLink}>Créer un compte</a>
        </p>
      </div>
    </div>
  );
}

// Mêmes tokens de couleurs/espacements/rayons que pages/login.js et pages/inscription.js
// — même identité visuelle que le reste du site (voir styles/globals.css).
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
  forgotBtn: {
    background: "transparent", border: "none", color: "var(--text-secondary)", fontSize: 12.5,
    cursor: "pointer", textAlign: "right", padding: 0, alignSelf: "flex-end",
  },
  btn: {
    background: "var(--accent)", border: "none", color: "var(--on-accent)", fontWeight: 700,
    borderRadius: 999, padding: "11px 0", fontSize: 14, cursor: "pointer", marginTop: 6,
  },
  error: { color: "var(--negative)", fontSize: 12.5, margin: 0 },
  info: { color: "var(--accent)", fontSize: 12.5, margin: 0 },
  switchText: { textAlign: "center", fontSize: 12.5, color: "var(--text-secondary)", margin: 0, padding: "0 8px 8px" },
  switchLink: { color: "var(--accent)", fontWeight: 700, textDecoration: "none" },
};
