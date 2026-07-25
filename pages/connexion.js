import { useEffect, useState } from "react";
import { useRouter } from "next/router";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Écran d'authentification UNIQUE (voir PROMPT) : plus de mot de passe, plus de code
// à 6 chiffres, plus de lien magique, plus de Google — un seul champ (email), un seul
// bouton ("Continuer"). Au clic, POST /api/auth/login : la personne est connectée
// IMMÉDIATEMENT (voir cette route — un compte est créé automatiquement si l'email
// n'existe pas encore, aucune distinction visible entre inscription et connexion,
// aucun email n'est envoyé). En cas d'erreur, le message renvoyé par l'API est
// affiché TEL QUEL (déjà une phrase française précise, jamais "contactez
// l'administrateur" — voir PROMPT point 7 et pages/api/auth/login.js).
export default function Connexion() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Déjà connecté ? Inutile de repasser par cet écran : direction l'application.
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((data) => {
        if (data?.session) router.replace("/");
      })
      .catch(() => {});
  }, [router]);

  // Réchauffe le bundle JS de la page "/" pendant que la personne tape encore son
  // email : la redirection après connexion n'attend plus le chargement à la demande.
  useEffect(() => {
    router.prefetch?.("/");
  }, [router]);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(cleanEmail)) {
      setError("Adresse email invalide.");
      return;
    }

    setLoading(true);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail }),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok) {
        setError(data?.error || `Erreur de connexion (code ${r.status}).`);
        return;
      }
      router.push("/");
    } catch (err) {
      setError("Impossible de contacter le serveur. Vérifie ta connexion internet et réessaie.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h1 style={styles.h1}>Connexion à Blume</h1>

        <form onSubmit={submit} style={styles.form}>
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
          <button type="submit" disabled={loading} style={styles.btn}>
            {loading ? "Connexion…" : "Continuer"}
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
    borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 16,
  },
  h1: { fontSize: 20, margin: 0, textAlign: "center" },
  form: { display: "flex", flexDirection: "column", gap: 12 },
  input: {
    background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
    borderRadius: 9, padding: "11px 12px", fontSize: 14, width: "100%",
  },
  btn: {
    background: "var(--accent)", border: "none", color: "var(--on-accent)", fontWeight: 700,
    borderRadius: 999, padding: "11px 0", fontSize: 14, cursor: "pointer",
  },
  error: { color: "var(--negative)", fontSize: 12.5, margin: 0 },
};
