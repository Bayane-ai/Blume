import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";

// Traduit les erreurs Supabase Auth (souvent en anglais, parfois peu claires) en
// messages compréhensibles. Le cas le plus trompeur : un compte fraîchement créé
// dont l'email n'est pas encore confirmé ne peut pas se connecter — Supabase répond
// alors une erreur qui peut donner l'impression, à tort, que c'est le mot de passe
// qui est refusé.
function friendlyAuthError(error) {
  const code = error?.code || "";
  const msg = (error?.message || "").toLowerCase();

  if (code === "email_not_confirmed" || msg.includes("email not confirmed")) {
    return "Ton adresse email n'est pas encore confirmée. Vérifie ta boîte mail (et les spams) et clique sur le lien reçu avant de te connecter.";
  }
  if (code === "invalid_credentials" || msg.includes("invalid login credentials")) {
    return "Email ou mot de passe incorrect.";
  }
  if (code === "user_already_exists" || msg.includes("already registered")) {
    return "Un compte existe déjà avec cet email. Connecte-toi plutôt.";
  }
  if (code === "weak_password" || msg.includes("password should be at least")) {
    return "Le mot de passe doit contenir au moins 6 caractères.";
  }
  if (code === "over_email_send_rate_limit" || msg.includes("rate limit")) {
    return "Trop de tentatives en peu de temps. Réessaie dans quelques minutes.";
  }
  if (msg.includes("invalid path specified")) {
    return "Erreur de configuration du service de connexion. Réessaie dans quelques instants ; si ça persiste, préviens l'administrateur du site.";
  }
  return error?.message || "Une erreur est survenue.";
}

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showResend, setShowResend] = useState(false);

  // Déjà connecté ? Inutile de repasser par cette page : direction l'application.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/");
    });
  }, [router]);

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError(null);
    setInfo(null);
    setShowResend(false);
    setConfirmPassword("");
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setShowResend(false);

    const cleanEmail = email.trim().toLowerCase();

    if (mode === "signup" && password !== confirmPassword) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
        router.push("/");
      } else {
        const { error } = await supabase.auth.signUp({ email: cleanEmail, password });
        if (error) throw error;
        setInfo("Compte créé. Vérifie ta boîte mail pour confirmer, puis reviens te connecter.");
      }
    } catch (err) {
      setError(friendlyAuthError(err));
      if (err?.code === "email_not_confirmed" || (err?.message || "").toLowerCase().includes("email not confirmed")) {
        setShowResend(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const resendConfirmation = async () => {
    setError(null);
    setInfo(null);
    const { error } = await supabase.auth.resend({ type: "signup", email: email.trim().toLowerCase() });
    if (error) setError(friendlyAuthError(error));
    else setInfo("Email de confirmation renvoyé. Vérifie ta boîte mail (et les spams).");
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.tabs}>
          <button
            type="button"
            style={{ ...styles.tabBtn, ...(mode === "signin" ? styles.tabBtnActive : {}) }}
            onClick={() => switchMode("signin")}
          >
            Se connecter
          </button>
          <button
            type="button"
            style={{ ...styles.tabBtn, ...(mode === "signup" ? styles.tabBtnActive : {}) }}
            onClick={() => switchMode("signup")}
          >
            Créer un compte
          </button>
        </div>

        <form onSubmit={submit} style={styles.form}>
          <h1 style={styles.h1}>{mode === "signin" ? "Connexion" : "Créer un compte"}</h1>
          <input
            type="email"
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
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required
            minLength={6}
            style={styles.input}
          />
          {mode === "signup" && (
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
          )}
          {error && <p style={styles.error}>{error}</p>}
          {showResend && (
            <button type="button" onClick={resendConfirmation} style={styles.switchBtn}>
              Renvoyer l'email de confirmation
            </button>
          )}
          {info && <p style={styles.info}>{info}</p>}
          <button type="submit" disabled={loading} style={styles.btn}>
            {loading ? "..." : mode === "signin" ? "Se connecter" : "Créer le compte"}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  card: {
    width: "100%", maxWidth: 360, background: "var(--card-bg)", border: "1px solid var(--border)",
    borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 16,
  },
  tabs: { display: "flex", gap: 8 },
  tabBtn: {
    flex: 1, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-secondary)",
    borderRadius: 999, padding: "10px 8px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
  },
  tabBtnActive: { background: "var(--accent)", border: "1px solid var(--accent)", color: "var(--on-accent)" },
  form: { display: "flex", flexDirection: "column", gap: 12, padding: "8px 8px 0" },
  h1: { fontSize: 20, margin: "0 0 8px", textAlign: "center" },
  input: {
    background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
    borderRadius: 9, padding: "11px 12px", fontSize: 14,
  },
  btn: {
    background: "var(--accent)", border: "none", color: "var(--on-accent)", fontWeight: 700,
    borderRadius: 999, padding: "11px 0", fontSize: 14, cursor: "pointer", marginTop: 6,
  },
  switchBtn: { background: "transparent", border: "none", color: "var(--text-secondary)", fontSize: 12.5, cursor: "pointer" },
  error: { color: "var(--negative)", fontSize: 12.5, margin: 0 },
  info: { color: "var(--accent)", fontSize: 12.5, margin: 0 },
};
