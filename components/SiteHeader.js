import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { writePrefs } from "../lib/prefsCookie";

// Les 4 onglets dont le PROMPT (Partie 2) demande explicitement de retenir le dernier
// consulté ("Live, Matchs à venir, News, Combiné Vision") — volontairement PAS les
// sept liens de navigation au complet (Historique/Probabilités n'en font pas partie).
// Simple mémorisation dans le cookie blume_prefs : aucune redirection automatique
// n'est ajoutée ici (revenir sur "/" affiche toujours "Live", jamais une page
// surprise) — la préférence est juste prête à être exploitée si besoin plus tard.
const TRACKED_TABS = ["/", "/a-venir", "/news", "/combine-vision"];

// Navigation du site, partagée par toutes les pages : "Live", "Matchs à venir",
// "Combiné Vision", "News", "Historique", "Probabilités réussies" et "Probabilités
// échouées" — même style visuel et même comportement actif/inactif pour les sept.
// Liens en <a> classiques plutôt que next/link : chaque page recharge ses propres
// données réelles à l'arrivée, et ça évite de dépendre du RouterContext de next/link
// dans les tests.
//
// `session` est ici `{ id, email }` (voir lib/session.js#getSession) — il n'y a plus
// de pseudo (la table "profiles" ne stocke plus qu'un email, voir
// supabase/migrations/0008_custom_auth.sql) : l'email est affiché directement, sans
// lecture supplémentaire.
export default function SiteHeader({ session }) {
  const router = useRouter();
  const userId = session?.id;
  const [isOwnerAccount, setIsOwnerAccount] = useState(false);

  // Lien "Admin" affiché UNIQUEMENT pour l'administrateur (voir PROMPT point 8 :
  // "seul le compte dont l'email est égal à ADMIN_EMAIL peut modifier quoi que ce
  // soit"). /api/whoami ne renvoie qu'un booléen calculé côté serveur (jamais
  // ADMIN_EMAIL lui-même) — ceci est un confort d'affichage, PAS la protection
  // réelle : /admin et les routes d'écriture restent protégés côté serveur (voir
  // pages/admin.js, lib/auth/admin.js) même si ce fetch échoue ou est falsifié.
  useEffect(() => {
    if (!userId) {
      setIsOwnerAccount(false);
      return;
    }
    let active = true;
    // try/catch synchrone en plus du .catch() : un environnement sans `fetch` global
    // (certains tests) ne doit jamais faire planter l'en-tête pour ce simple confort
    // d'affichage — l'Admin reste alors simplement invisible, jamais une exception.
    try {
      fetch("/api/whoami")
        .then((r) => r.json())
        .then((data) => {
          if (active) setIsOwnerAccount(Boolean(data?.isOwner));
        })
        .catch(() => {
          if (active) setIsOwnerAccount(false);
        });
    } catch (e) {
      setIsOwnerAccount(false);
    }
    return () => {
      active = false;
    };
  }, [userId]);

  // Mémorise le dernier onglet consulté parmi TRACKED_TABS (voir PROMPT Partie 2).
  useEffect(() => {
    if (TRACKED_TABS.includes(router.pathname)) {
      writePrefs({ lastTab: router.pathname });
    }
  }, [router.pathname]);

  // "Se déconnecter" (voir PROMPT) efface le cookie de session côté serveur puis
  // renvoie explicitement vers /connexion — sans attendre le mécanisme réactif de
  // lib/useRequireAuth.js, pour un comportement immédiat et prévisible.
  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (e) {
      // Le cookie httpOnly reste alors en place côté navigateur : redirection quand
      // même, la prochaine vérification de session (voir useRequireAuth) le
      // détectera à nouveau si l'appel a réellement échoué.
    }
    router.push("/connexion");
  };

  return (
    <header style={st.header}>
      <div style={st.top}>
        <span style={st.logo}>Blume</span>
        {session && (
          <div style={st.headerRight}>
            <span style={st.userEmail}>{session.email}</span>
            <button onClick={logout} style={st.smallBtn}>Se déconnecter</button>
          </div>
        )}
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
          href="/combine-vision"
          style={{ ...st.navBtn, ...(router.pathname === "/combine-vision" ? st.navBtnActive : {}) }}
        >
          Combiné Vision
        </a>
        <a
          href="/news"
          style={{ ...st.navBtn, ...(router.pathname === "/news" ? st.navBtnActive : {}) }}
        >
          News
        </a>
        <a
          href="/historique"
          style={{ ...st.navBtn, ...(router.pathname === "/historique" ? st.navBtnActive : {}) }}
        >
          Historique
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
        {isOwnerAccount && (
          <a
            href="/admin"
            style={{ ...st.navBtn, ...(router.pathname === "/admin" ? st.navBtnActive : {}) }}
          >
            Admin
          </a>
        )}
        <a
          href="/reglages"
          style={{ ...st.navBtn, ...(router.pathname === "/reglages" ? st.navBtnActive : {}) }}
        >
          Réglages
        </a>
      </nav>
    </header>
  );
}

const st = {
  header: { maxWidth: 640, margin: "0 auto 16px", display: "flex", flexDirection: "column", gap: 12 },
  top: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  logo: { fontSize: 20, fontWeight: 800, color: "var(--accent)", letterSpacing: 0.3 },
  headerRight: { display: "flex", alignItems: "center", gap: 10 },
  userEmail: { fontSize: 11.5, color: "var(--text-secondary)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  smallBtn: {
    background: "transparent", border: "1px solid var(--border)", color: "var(--text-primary)",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, textDecoration: "none", cursor: "pointer",
  },
  // Sept boutons (dont deux libellés longs, "Probabilités réussies/échouées") sur une
  // seule ligne, jamais à la ligne (flexWrap: nowrap) — sur un écran étroit, ils
  // débordent et se parcourent par défilement horizontal (overflowX: auto) plutôt que
  // de se compresser illisiblement ou de passer à la ligne.
  nav: { display: "flex", flexWrap: "nowrap", gap: 8, overflowX: "auto", WebkitOverflowScrolling: "touch" },
  navBtn: {
    flex: "0 0 auto", whiteSpace: "nowrap", textAlign: "center", background: "var(--card-bg)", border: "1px solid var(--border)",
    color: "var(--text-secondary)", borderRadius: 999, padding: "10px 14px", fontSize: 13, fontWeight: 700,
    cursor: "pointer", textDecoration: "none",
  },
  liveDot: {
    display: "inline-block", width: 8, height: 8, borderRadius: "50%",
    background: "var(--negative)", marginRight: 6, boxShadow: "0 0 6px rgba(var(--negative-rgb),0.9)",
    verticalAlign: "middle",
  },
  navBtnActive: { background: "var(--accent)", border: "1px solid var(--accent)", color: "var(--on-accent)" },
};
