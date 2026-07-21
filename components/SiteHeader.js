import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";

// Navigation du site, partagée par toutes les pages : "Live", "Matchs à venir",
// "News", "Probabilités réussies" et "Probabilités échouées" — même style visuel et
// même comportement actif/inactif pour les cinq. Liens en <a> classiques (comme le
// lien "Se connecter" déjà existant) plutôt que next/link : chaque page recharge ses
// propres données réelles à l'arrivée, et ça évite de dépendre du RouterContext de
// next/link dans les tests.
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
        <a
          href="/news"
          style={{ ...st.navBtn, ...(router.pathname === "/news" ? st.navBtnActive : {}) }}
        >
          News
        </a>
        <a
          href="/probabilites-reussies"
          style={{ ...st.navBtn, ...(router.pathname === "/probabilites-reussies" ? st.navBtnActive : {}) }}
        >
          Probabilités réussies
        </a>
        <a
          href="/probabilites-echouees"
          style={{ ...st.navBtn, ...(router.pathname === "/probabilites-echouees" ? st.navBtnActive : {}) }}
        >
          Probabilités échouées
        </a>
      </nav>
    </header>
  );
}

const st = {
  header: { maxWidth: 640, margin: "0 auto 16px", display: "flex", flexDirection: "column", gap: 12 },
  top: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  logo: { fontSize: 20, fontWeight: 800, color: "#1A7F4F", letterSpacing: 0.3 },
  headerRight: { display: "flex", alignItems: "center", gap: 10 },
  userEmail: { fontSize: 11.5, color: "#5C7A6A", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  smallBtn: {
    background: "transparent", border: "1px solid #D8E6DE", color: "#13291D",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, textDecoration: "none", cursor: "pointer",
  },
  // Cinq boutons (dont deux libellés longs, "Probabilités réussies/échouées") sur une
  // seule ligne, jamais à la ligne (flexWrap: nowrap) — sur un écran étroit, ils
  // débordent et se parcourent par défilement horizontal (overflowX: auto) plutôt que
  // de se compresser illisiblement ou de passer à la ligne.
  nav: { display: "flex", flexWrap: "nowrap", gap: 8, overflowX: "auto", WebkitOverflowScrolling: "touch" },
  navBtn: {
    flex: "0 0 auto", whiteSpace: "nowrap", textAlign: "center", background: "#FFFFFF", border: "1px solid #D8E6DE",
    color: "#5C7A6A", borderRadius: 999, padding: "10px 14px", fontSize: 13, fontWeight: 700,
    cursor: "pointer", textDecoration: "none",
  },
  liveDot: {
    display: "inline-block", width: 8, height: 8, borderRadius: "50%",
    background: "#FF3B30", marginRight: 6, boxShadow: "0 0 6px rgba(255,59,48,0.9)",
    verticalAlign: "middle",
  },
  navBtnActive: { background: "#39B577", border: "1px solid #39B577", color: "#06121F" },
};
