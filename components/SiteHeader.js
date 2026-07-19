import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";

// PROMPT 2 du plan : navigation du site réduite à SEULEMENT deux boutons, partagés
// par les deux pages du site — aucun autre lien de navigation (le filtrage par
// compétition/journée est réintégré directement sur ces deux pages à l'étape 6,
// voir components/FilterCarousel.js, sans ajouter de 3e bouton ici).
// Liens en <a> classiques (comme le lien "Se connecter" déjà existant) plutôt que
// next/link : chaque page recharge ses propres données réelles à l'arrivée, et ça
// évite de dépendre du RouterContext de next/link dans les tests.
export default function SiteHeader({ session }) {
  const router = useRouter();
  const logout = () => supabase.auth.signOut();

  return (
    <header style={st.header}>
      <div style={st.top}>
        <span style={st.logo}>Blume</span>
        <div style={st.headerRight}>
          {session ? (
            <>
              <span style={st.userEmail}>{session.user?.email}</span>
              <button onClick={logout} style={st.smallBtn}>Déconnexion</button>
            </>
          ) : (
            <a href="/login" style={st.smallBtn}>Se connecter</a>
          )}
        </div>
      </div>

      <nav style={st.nav} data-testid="main-nav">
        <a
          href="/"
          style={{ ...st.navBtn, ...(router.pathname === "/" ? st.navBtnActive : {}) }}
        >
          <span style={st.liveDot} aria-hidden="true" />
          Live
        </a>
        <a
          href="/a-venir"
          style={{ ...st.navBtn, ...(router.pathname === "/a-venir" ? st.navBtnActive : {}) }}
        >
          Matchs à venir
        </a>
      </nav>
    </header>
  );
}

const st = {
  header: { maxWidth: 640, margin: "0 auto 16px", display: "flex", flexDirection: "column", gap: 12 },
  top: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  logo: { fontSize: 20, fontWeight: 800, color: "#39B577", letterSpacing: 0.3 },
  headerRight: { display: "flex", alignItems: "center", gap: 10 },
  userEmail: { fontSize: 11.5, color: "#7EA694", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  smallBtn: {
    background: "transparent", border: "1px solid #1E3D2C", color: "#E9F1EC",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, textDecoration: "none", cursor: "pointer",
  },
  nav: { display: "flex", gap: 8 },
  navBtn: {
    flex: "1 1 auto", textAlign: "center", background: "#12291E", border: "1px solid #1E3D2C",
    color: "#7EA694", borderRadius: 999, padding: "10px 8px", fontSize: 13, fontWeight: 700,
    cursor: "pointer", textDecoration: "none",
  },
  liveDot: {
    display: "inline-block", width: 8, height: 8, borderRadius: "50%",
    background: "#FF3B30", marginRight: 6, boxShadow: "0 0 6px rgba(255,59,48,0.9)",
    verticalAlign: "middle",
  },
  navBtnActive: { background: "#39B577", border: "1px solid #39B577", color: "#06121F" },
};
