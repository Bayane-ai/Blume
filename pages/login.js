import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);

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
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push("/");
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setInfo("Compte créé. Vérifie ta boîte mail pour confirmer, puis reviens te connecter.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.page}>
      <form onSubmit={submit} style={styles.card}>
        <h1 style={styles.h1}>{mode === "signin" ? "Connexion" : "Créer un compte"}</h1>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={styles.input}
        />
        <input
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          style={styles.input}
        />
        {error && <p style={styles.error}>{error}</p>}
        {info && <p style={styles.info}>{info}</p>}
        <button type="submit" disabled={loading} style={styles.btn}>
          {loading ? "..." : mode === "signin" ? "Se connecter" : "Créer le compte"}
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          style={styles.switchBtn}
        >
          {mode === "signin" ? "Pas encore de compte ? Créer un compte" : "Déjà un compte ? Se connecter"}
        </button>
      </form>
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  card: {
    width: "100%", maxWidth: 360, background: "#12291E", border: "1px solid #1E3D2C",
    borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12,
  },
  h1: { fontSize: 20, margin: "0 0 8px", textAlign: "center" },
  input: {
    background: "#0B1F16", border: "1px solid #1E3D2C", color: "#E9F1EC",
    borderRadius: 9, padding: "11px 12px", fontSize: 14,
  },
  btn: {
    background: "#39B577", border: "none", color: "#06121F", fontWeight: 700,
    borderRadius: 999, padding: "11px 0", fontSize: 14, cursor: "pointer", marginTop: 6,
  },
  switchBtn: { background: "transparent", border: "none", color: "#7EA694", fontSize: 12.5, cursor: "pointer" },
  error: { color: "#D8685E", fontSize: 12.5, margin: 0 },
  info: { color: "#39B577", fontSize: 12.5, margin: 0 },
};
