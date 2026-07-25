import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../lib/supabaseClient";

// Navigation du site, partagée par toutes les pages : "Live", "Matchs à venir",
// "Combiné Vision", "News", "Historique", "Probabilités réussies" et "Probabilités
// échouées" — même style visuel et même comportement actif/inactif pour les sept.
// Liens en <a> classiques plutôt que next/link : chaque page recharge ses propres
// données réelles à l'arrivée, et ça évite de dépendre du RouterContext de next/link
// dans les tests.
export default function SiteHeader({ session }) {
  const router = useRouter();
  const userId = session?.user?.id;
  const [pseudo, setPseudo] = useState(null);
  const [isOwnerAccount, setIsOwnerAccount] = useState(false);

  // Lien "Admin" affiché UNIQUEMENT pour le propriétaire (voir PROMPT étape 5 :
  // "n'apparaît dans la navigation que si isOwner() est vrai"). /api/whoami ne renvoie
  // qu'un booléen calculé côté serveur (jamais OWNER_ID/OWNER_EMAIL au client) — ceci
  // est un confort d'affichage, PAS la protection réelle : /admin reste protégé côté
  // serveur (voir pages/admin.js) même si ce fetch échoue ou est falsifié.
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

  // Bloc 4 : affiche le pseudo du compte connecté (table "profiles", voir
  // supabase/migrations/0005_profiles.sql) — replie sur l'email tant que le pseudo
  // n'est pas encore renseigné (ex : compte créé avant l'ajout du pseudo à
  // l'inscription). La lecture passe par le client navigateur authentifié : la Row
  // Level Security ("profiles_select_own") garantit déjà qu'un compte ne peut lire
  // QUE sa propre ligne, quoi qu'il arrive.
  useEffect(() => {
    if (!userId) {
      setPseudo(null);
      return;
    }
    let active = true;
    // try/catch synchrone en plus du .catch() : un client Supabase minimal (tests,
    // environnements où seule l'auth est configurée) peut ne pas exposer .from — ne
    // jamais faire planter l'en-tête pour un simple affichage de confort, l'email
    // reste toujours affiché en repli.
    try {
      supabase
        .from("profiles")
        .select("nom_utilisateur")
        .eq("id", userId)
        .maybeSingle()
        .then(({ data }) => {
          if (active) setPseudo(data?.nom_utilisateur || null);
        })
        .catch((e) => console.error("Erreur lecture du pseudo:", e.message));
    } catch (e) {
      console.error("Erreur lecture du pseudo:", e.message);
    }
    return () => {
      active = false;
    };
  }, [userId]);

  const displayName = pseudo || session?.user?.email;

  // "Se déconnecter" (voir PROMPT) renvoie explicitement vers /connexion — sans
  // attendre le mécanisme réactif de lib/useRequireAuth.js (qui redirigerait de toute
  // façon dès que la session disparaît), pour un comportement immédiat et prévisible.
  const logout = async () => {
    await supabase.auth.signOut();
    router.push("/connexion");
  };

  return (
    <header style={st.header}>
      <div style={st.top}>
        <span style={st.logo}>Blume</span>
        {session && (
          <div style={st.headerRight}>
            <span style={st.userEmail}>{displayName}</span>
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
