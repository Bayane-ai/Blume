import { useEffect, useState } from "react";
import { useRequireAuth } from "../lib/useRequireAuth";
import SiteHeader from "../components/SiteHeader";
import { readPrefs, writePrefs, applyTheme } from "../lib/prefsCookie";
import { readConsent, requestConsentReset } from "../lib/consentCookie";

// Page "Réglages" — sélecteur clair/sombre (voir PROMPT Partie 2) ET moyen de
// revenir sur le choix de cookies (voir PROMPT Partie 3 : "Ajoute dans les réglages
// du compte un moyen de revenir sur ce choix").
export default function Reglages() {
  const { session, sessionChecked, authorized } = useRequireAuth();
  const [theme, setTheme] = useState("dark");
  const [consent, setConsent] = useState(null);

  useEffect(() => {
    setTheme(readPrefs().theme);
    setConsent(readConsent());
  }, []);

  const chooseTheme = (value) => {
    setTheme(value);
    writePrefs({ theme: value });
    applyTheme(value);
  };

  // Efface le cookie blume_consent et fait réapparaître le bandeau (voir
  // components/CookieBanner.js, monté globalement dans pages/_app.js) — sans
  // recharger la page.
  const reopenCookieBanner = () => {
    requestConsentReset();
    setConsent(null);
  };

  if (!sessionChecked) {
    return (
      <div style={st.page}>
        <p style={st.hint}>Chargement…</p>
      </div>
    );
  }
  if (!authorized) return null;

  return (
    <div style={st.page}>
      <SiteHeader session={session} />

      <main style={st.main}>
        <section style={st.hero}>
          <h1 style={st.heroTitle}>Réglages</h1>
        </section>

        <section style={st.card}>
          <h2 style={st.cardTitle}>Apparence</h2>
          <p style={st.cardText}>Choisis l'apparence de Blume — ton choix est mémorisé pour tes prochaines visites.</p>
          <div style={st.themeRow}>
            <button
              type="button"
              onClick={() => chooseTheme("dark")}
              style={{ ...st.themeBtn, ...(theme === "dark" ? st.themeBtnActive : {}) }}
              data-testid="theme-choice-dark"
              aria-pressed={theme === "dark"}
            >
              Sombre
            </button>
            <button
              type="button"
              onClick={() => chooseTheme("light")}
              style={{ ...st.themeBtn, ...(theme === "light" ? st.themeBtnActive : {}) }}
              data-testid="theme-choice-light"
              aria-pressed={theme === "light"}
            >
              Clair
            </button>
          </div>
        </section>

        <section style={st.card}>
          <h2 style={st.cardTitle}>Cookies</h2>
          <p style={st.cardText} data-testid="consent-status">
            {consent === "all" && "Tu as accepté tous les cookies."}
            {consent === "essential" && "Tu as refusé les cookies non essentiels."}
            {consent === null && "Aucun choix enregistré pour l'instant."}
          </p>
          <button type="button" onClick={reopenCookieBanner} style={st.linkBtn} data-testid="reopen-cookie-banner">
            Modifier mes préférences de cookies
          </button>
        </section>
      </main>
    </div>
  );
}

const st = {
  page: { minHeight: "100vh", padding: "20px 16px 60px" },
  main: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  hero: { textAlign: "center", padding: "8px 4px" },
  heroTitle: { fontSize: 21, fontWeight: 800, margin: 0, lineHeight: 1.25 },
  hint: { fontSize: 12.5, color: "var(--text-secondary)" },
  card: {
    background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 16,
    padding: 20, display: "flex", flexDirection: "column", gap: 10,
  },
  cardTitle: { fontSize: 15, fontWeight: 800, margin: 0 },
  cardText: { fontSize: 12.5, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 },
  themeRow: { display: "flex", gap: 10, marginTop: 4 },
  themeBtn: {
    flex: 1, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-primary)",
    borderRadius: 999, padding: "10px 0", fontSize: 13, fontWeight: 700, cursor: "pointer",
  },
  themeBtnActive: { background: "var(--accent)", border: "1px solid var(--accent)", color: "var(--on-accent)" },
  linkBtn: {
    alignSelf: "flex-start", background: "transparent", border: "none", color: "var(--accent)",
    fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: 0, textDecoration: "underline",
  },
};
