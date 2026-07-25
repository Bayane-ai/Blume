import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";
import { friendlyAuthError } from "../lib/authErrors";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_SECONDS = 30;

// Écran d'authentification UNIQUE (voir PROMPT) : uniquement l'email intégré à
// Supabase (Google abandonné) — plus de mot de passe, plus de distinction
// inscription/connexion. Un seul champ (email), un seul bouton (Continuer) :
//   1. supabase.auth.signInWithOtp({ email }) envoie un code à 6 chiffres par email.
//      "shouldCreateUser: true" (comportement par défaut, explicité ici) crée le
//      compte automatiquement au premier code vérifié avec succès si l'email
//      n'existait pas encore — un seul parcours, jamais de distinction visible.
//   2. supabase.auth.verifyOtp({ email, token, type: "email" }) vérifie le code (pas
//      de lien magique : plus fiable sur mobile, voir PROMPT) et ouvre la session.
// Le code expire après une durée fixée dans Supabase (Dashboard -> Authentication ->
// Email -> OTP Expiry, à régler sur 600s / 10 min) — ce projet ne peut pas configurer
// cette valeur depuis le code applicatif.
export default function Connexion() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState("email"); // "email" | "code"
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [sendLoading, setSendLoading] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [secondsUntilResend, setSecondsUntilResend] = useState(0);
  const codeRef = useRef(null);

  // Déjà connecté ? Inutile de repasser par cet écran : direction l'application.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/");
    });
  }, [router]);

  // Réchauffe le bundle JS de la page "/" pendant que la personne est encore sur cet
  // écran : la redirection après connexion n'attend plus le chargement à la demande.
  useEffect(() => {
    router.prefetch?.("/");
  }, [router]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  // Décompte avant de pouvoir renvoyer le code (voir PROMPT : "disponible après 30
  // secondes") — un compte à rebours affiché, jamais juste un bouton désactivé sans
  // explication.
  useEffect(() => {
    if (step !== "code" || secondsUntilResend <= 0) return;
    const id = setInterval(() => setSecondsUntilResend((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [step, secondsUntilResend]);

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
      setSecondsUntilResend(RESEND_COOLDOWN_SECONDS);
      setInfo("Un code vient de t'être envoyé à ton adresse.");
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
    if (secondsUntilResend > 0) return;
    setError(null);
    setInfo(null);
    setSendLoading(true);
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
      if (otpError) throw otpError;
      setSecondsUntilResend(RESEND_COOLDOWN_SECONDS);
      setInfo("Un code vient de t'être envoyé à ton adresse.");
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

        {step === "email" && (
          <form onSubmit={sendCode} style={styles.form}>
            <input
              type="text"
              inputMode="email"
              placeholder="Entre ton email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              style={styles.input}
            />
            {error && <p style={styles.error}>{error}</p>}
            <button type="submit" disabled={sendLoading} style={styles.btn}>
              {sendLoading ? "Envoi…" : "Continuer"}
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
              {secondsUntilResend > 0 ? (
                <span style={styles.cooldownText}>Renvoyer le code (dans {secondsUntilResend}s)</span>
              ) : (
                <button type="button" onClick={resendCode} disabled={sendLoading} style={styles.linkBtn}>
                  {sendLoading ? "Envoi…" : "Renvoyer le code"}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  card: {
    width: "100%", maxWidth: 360, background: "var(--card-bg)", border: "1px solid var(--border)",
    borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 16,
  },
  h1: { fontSize: 20, margin: 0, textAlign: "center" },
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
  codeActionsRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  linkBtn: {
    background: "transparent", border: "none", color: "var(--text-secondary)", fontSize: 12.5,
    cursor: "pointer", padding: 0, textDecoration: "underline",
  },
  cooldownText: { fontSize: 12.5, color: "var(--text-secondary)" },
  error: { color: "var(--negative)", fontSize: 12.5, margin: 0 },
  info: { color: "var(--accent)", fontSize: 12.5, margin: 0 },
};
