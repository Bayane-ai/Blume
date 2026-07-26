// Page publique "/cookies" (voir PROMPT Partie 3, lien "En savoir plus" du bandeau) —
// accessible SANS connexion (contrairement à presque toutes les autres pages du
// site, qui passent par lib/useRequireAuth.js) : quelqu'un doit pouvoir lire cette
// page depuis le bandeau de consentement AVANT même de se connecter.
export default function CookiesPage() {
  return (
    <div style={st.page}>
      <main style={st.main}>
        <h1 style={st.h1}>Les cookies utilisés par Blume</h1>
        <p style={st.intro}>
          Blume utilise trois cookies, listés ci-dessous avec leur rôle exact et leur durée. Aucun cookie de mesure
          d'audience ni de publicité n'est utilisé sur ce site.
        </p>

        <section style={st.card}>
          <h2 style={st.cardTitle}>Cookies strictement nécessaires</h2>
          <p style={st.cardText}>
            Indispensables au fonctionnement du site : ils ne sont jamais soumis à ton consentement et restent actifs
            même si tu refuses les cookies non essentiels.
          </p>
          <ul style={st.list}>
            <li style={st.listItem}>
              <strong>blume_session</strong> — te garde connecté entre deux visites. Ne contient qu'un jeton signé,
              illisible par le JavaScript du site (httpOnly), envoyé uniquement en connexion sécurisée (secure).
              Durée : 30 jours.
            </li>
            <li style={st.listItem}>
              <strong>blume_prefs</strong> — mémorise ton thème (clair/sombre), le dernier onglet consulté et tes
              compétitions favorites, pour éviter tout clignotement au chargement de la page. Durée : 1 an.
            </li>
            <li style={st.listItem}>
              <strong>blume_consent</strong> — mémorise ton choix sur ce bandeau lui-même ("Tout accepter" ou
              "Refuser les cookies non essentiels"), pour ne plus te le redemander à chaque visite. Durée : 6 mois.
            </li>
          </ul>
        </section>

        <section style={st.card}>
          <h2 style={st.cardTitle}>Cookies de mesure et de publicité</h2>
          <p style={st.cardText}>
            Blume n'utilise aujourd'hui aucun cookie de mesure d'audience ni de publicité. Si cela change un jour,
            ces cookies ne seront déposés qu'avec ton accord explicite ("Tout accepter").
          </p>
        </section>

        <a href="/" style={st.back}>← Retour à l'accueil</a>
      </main>
    </div>
  );
}

const st = {
  page: { minHeight: "100vh", padding: "20px 16px 60px" },
  main: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  h1: { fontSize: 21, fontWeight: 800, margin: 0, lineHeight: 1.25 },
  intro: { fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.6 },
  card: {
    background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 16,
    padding: 20, display: "flex", flexDirection: "column", gap: 10,
  },
  cardTitle: { fontSize: 15, fontWeight: 800, margin: 0 },
  cardText: { fontSize: 12.5, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 },
  list: { margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: 10 },
  listItem: { fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 },
  back: { fontSize: 13, color: "var(--accent)", fontWeight: 700, textDecoration: "none" },
};
