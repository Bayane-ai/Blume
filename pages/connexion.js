import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import { friendlyAuthError } from "../lib/authErrors";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Écran d'authentification UNIQUE (voir PROMPT) : plus de mot de passe, plus de
// distinction inscription/connexion. Deux façons d'arriver au même résultat (une
// session Supabase) :
//   1. "Continuer avec Google" (option principale) : supabase.auth.signInWithOAuth
//      redirige vers Google, puis revient sur le site déjà connecté — le compte est
//      créé automatiquement par Supabase au tout premier passage sur cet email.
//   2. Email + code à 6 chiffres (supabase.auth.signInWithOtp puis verifyOtp) : même
//      chose, "shouldCreateUser: true" (comportement par défaut, explicité ici) crée
//      le compte au premier code vérifié avec succès si l'email n'existait pas
//      encore. Le code expire après une durée fixée dans Supabase (Dashboard ->
//      Authentication -> Email -> OTP Expiry, à régler sur 600s / 10 min — ce projet
//      ne peut pas configurer cette valeur depuis le code applicatif).
//
// Dans les deux cas, "un email = un seul compte" est garanti par Supabase Auth
// lui-même : une seule ligne auth.users par adresse email, et Google/email OTP se
// rattachent à la MÊME ligne si l'email correspond (liaison automatique des
// identités par email vérifié — comportement par défaut du projet Supabase).
export default function Connexion() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState("email"); // "email" | "code"
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const codeRef = useRef(null);

  // Déjà connecté ? Inutile de repasser par cet écran : direction l'application.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/");
    });
  }, [router]);

  // Échec de "Continuer avec Google" APRÈS le départ vers Google (provider pas
  // encore activé côté Supabase, redirect URI non autorisée, personne qui annule sur
  // l'écran Google...) : Supabase renvoie alors vers "/" avec l'erreur dans l'URL,
  // jamais directement ici — c'est lib/useRequireAuth.js (le point de passage commun
  // à toutes les pages protégées) qui détecte ce cas et redirige vers CET écran avec
  // "?authError=...". On l'affiche ici comme n'importe quelle autre erreur de
  // connexion, puis on nettoie l'URL pour qu'un rechargement de la page ne la
  // réaffiche pas indéfiniment.
  useEffect(() => {
    if (!router.isReady) return;
    const { authError, authErrorDescription } = router.query;
    if (!authError && !authErrorDescription) return;
    setError(friendlyAuthError({ code: authError, message: authErrorDescription }));
    router.replace("/connexion", undefined, { shallow: true });
  }, [router, router.isReady, router.query]);

  // Réchauffe le bundle JS de la page "/" pendant que la personne est encore sur cet
  // écran : la redirection après connexion n'attend plus le chargement à la demande.
  useEffect(() => {
    router.prefetch?.("/");
  }, [router]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  const continueWithGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: typeof window !== "undefined" ? window.location.origin + "/" : undefined },
      });
      if (oauthError) throw oauthError;
      // Succès : le navigateur est redirigé vers Google, cette page est quittée —
      // pas besoin de remettre googleLoading à false dans ce cas.
    } catch (err) {
      setError(friendlyAuthError(err));
      setGoogleLoading(false);
    }
  };

  const sendCode = async (e) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(cleanEmail)) {
      setError("Adresse email invalide.");
      return;
    }

    setSendLoading(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: { shouldCreateUser: true },
      });
      if (otpError) throw otpError;
      setEmail(cleanEmail);
      setStep("code");
      setInfo("Code envoyé par email. Vérifie ta boîte mail (et les spams) — il est valable 10 minutes.");
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setSendLoading(false);
    }
  };

  const verifyCode = async (e) => {
    e.preventDefault();
    setError(null);

    const cleanCode = code.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      setError("Le code doit contenir 6 chiffres.");
      return;
    }

    setVerifyLoading(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: cleanCode,
        type: "email",
      });
      if (verifyError) throw verifyError;
      router.push("/");
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setVerifyLoading(false);
    }
  };

  const changeEmail = () => {
    setStep("email");
    setCode("");
    setError(null);
    setInfo(null);
  };

  const resendCode = async () => {
    setError(null);
    setInfo(null);
    setSendLoading(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
      if (otpError) throw otpError;
      setInfo("Nouveau code envoyé.");
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setSendLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.h1}>Connexion à Blume</h1>

        <button
          type="button"
          onClick={continueWithGoogle}
          disabled={googleLoading}
          style={styles.googleBtn}
        >
          <GoogleIcon />
          {googleLoading ? "Redirection…" : "Continuer avec Google"}
        </button>

        <div style={styles.separator}>
          <span style={styles.separatorLine} />
          <span style={styles.separatorText}>ou</span>
          <span style={styles.separatorLine} />
        </div>

        {step === "email" && (
          <form onSubmit={sendCode} style={styles.form}>
            <input
              type="text"
              inputMode="email"
              placeholder="Ton email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              style={styles.input}
            />
            {error && <p style={styles.error}>{error}</p>}
            <button type="submit" disabled={sendLoading} style={styles.btn}>
              {sendLoading ? "Envoi…" : "Recevoir un code par email"}
            </button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={verifyCode} style={styles.form}>
            <p style={styles.codeHint}>Code envoyé à {email}</p>
            <input
              ref={codeRef}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Code à 6 chiffres"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              maxLength={6}
              autoComplete="one-time-code"
              style={{ ...styles.input, ...styles.codeInput }}
            />
            {info && <p style={styles.info}>{info}</p>}
            {error && <p style={styles.error}>{error}</p>}
            <button type="submit" disabled={verifyLoading} style={styles.btn}>
              {verifyLoading ? "Vérification…" : "Valider le code"}
            </button>
            <div style={styles.codeActionsRow}>
              <button type="button" onClick={changeEmail} style={styles.linkBtn}>Changer d'email</button>
              <button type="button" onClick={resendCode} disabled={sendLoading} style={styles.linkBtn}>
                {sendLoading ? "Envoi…" : "Renvoyer le code"}
              </button>
            </div>
          </form>
        )}

        {step === "email" && info && <p style={styles.info}>{info}</p>}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.16.28-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03l2.97-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.98 4.97l2.97 2.33C4.66 5.17 6.65 3.58 9 3.58z" />
    </svg>
  );
}

const styles = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  card: {
    width: "100%", maxWidth: 360, background: "var(--card-bg)", border: "1px solid var(--border)",
    borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 16,
  },
  h1: { fontSize: 20, margin: 0, textAlign: "center" },
  googleBtn: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
    background: "#fff", border: "1px solid var(--border)", color: "#1f1f1f", fontWeight: 700,
    borderRadius: 999, padding: "12px 0", fontSize: 14, cursor: "pointer", width: "100%",
  },
  separator: { display: "flex", alignItems: "center", gap: 10 },
  separatorLine: { flex: 1, height: 1, background: "var(--border)" },
  separatorText: { fontSize: 12, color: "var(--text-secondary)" },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  input: {
    background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
    borderRadius: 9, padding: "11px 12px", fontSize: 14, width: "100%",
  },
  codeInput: { textAlign: "center", letterSpacing: 4, fontSize: 18, fontWeight: 700 },
  codeHint: { fontSize: 12.5, color: "var(--text-secondary)", margin: 0 },
  btn: {
    background: "var(--accent)", border: "none", color: "var(--on-accent)", fontWeight: 700,
    borderRadius: 999, padding: "11px 0", fontSize: 14, cursor: "pointer",
  },
  codeActionsRow: { display: "flex", justifyContent: "space-between", gap: 8 },
  linkBtn: {
    background: "transparent", border: "none", color: "var(--text-secondary)", fontSize: 12.5,
    cursor: "pointer", padding: 0, textDecoration: "underline",
  },
  error: { color: "var(--negative)", fontSize: 12.5, margin: 0 },
  info: { color: "var(--accent)", fontSize: 12.5, margin: 0 },
};
