import { useEffect, useState } from "react";
import { readConsent, writeConsent, CONSENT_RESET_EVENT } from "../lib/consentCookie";

// Bandeau de consentement (voir PROMPT Partie 3) : affiché uniquement tant qu'aucun
// choix n'a été enregistré (readConsent() === null), sur TOUTES les pages (monté une
// seule fois dans pages/_app.js). Volontairement absent du rendu serveur initial
// (état par défaut : caché) — se décide côté client au montage, comme n'importe quel
// bandeau de consentement : il n'y a jamais de "bon" contenu à montrer avant d'avoir
// pu lire le cookie, contrairement au thème (Partie 2) où le mauvais thème
// clignoterait visiblement.
export default function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(readConsent() === null);

    const onReset = () => setVisible(true);
    window.addEventListener(CONSENT_RESET_EVENT, onReset);
    return () => window.removeEventListener(CONSENT_RESET_EVENT, onReset);
  }, []);

  const choose = (value) => {
    writeConsent(value);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div style={st.wrap} role="dialog" aria-label="Consentement aux cookies" data-testid="cookie-banner">
      <div style={st.card}>
        <p style={st.text}>
          Blume utilise des cookies pour te garder connecté et mémoriser tes préférences (thème, onglet, favoris).
          Aucun cookie de mesure ou de publicité n'est utilisé.{" "}
          <a href="/cookies" style={st.link}>En savoir plus</a>
        </p>
        <div style={st.actions}>
          <button type="button" onClick={() => choose("essential")} style={st.secondaryBtn} data-testid="cookie-refuse">
            Refuser les cookies non essentiels
          </button>
          <button type="button" onClick={() => choose("all")} style={st.primaryBtn} data-testid="cookie-accept">
            Tout accepter
          </button>
        </div>
      </div>
    </div>
  );
}

const st = {
  wrap: {
    position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 1000,
    display: "flex", justifyContent: "center", padding: "0 16px 16px",
  },
  card: {
    width: "100%", maxWidth: 640, background: "var(--card-bg)", border: "1px solid var(--border)",
    borderRadius: 16, padding: 18, display: "flex", flexDirection: "column", gap: 14,
    boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
  },
  text: { fontSize: 12.5, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 },
  link: { color: "var(--accent)", fontWeight: 700, textDecoration: "underline" },
  actions: { display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end" },
  secondaryBtn: {
    background: "transparent", border: "1px solid var(--border)", color: "var(--text-primary)",
    borderRadius: 999, padding: "10px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
  },
  primaryBtn: {
    background: "var(--accent)", border: "none", color: "var(--on-accent)",
    borderRadius: 999, padding: "10px 20px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
  },
};
