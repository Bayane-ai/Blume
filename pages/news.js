import { useState, useEffect, useCallback } from "react";
import { useRequireAuth } from "../lib/useRequireAuth";
import { useSport } from "../lib/useSport";
import SiteHeader from "../components/SiteHeader";
import NewsCard from "../components/NewsCard";

// Actualisation automatique régulière (l'onglet "News" doit toujours montrer les
// actualités les plus récentes) — /api/news est lui-même mis en cache côté serveur
// (5 minutes), donc ce rythme côté client ne multiplie pas les appels aux flux RSS.
const NEWS_REFRESH_MS = 60000;

// Bloc 9 (multi-sport) — l'onglet News s'adapte désormais au sport sélectionné (voir
// pages/api/news.js, un jeu de flux RSS et de mots-clés d'importance par sport) :
// plus de "bientôt disponible" pour Basket/Tennis.
const HERO_BY_SPORT = {
  football: { title: "Actualités football", subtitle: "Les dernières actualités football, des transferts majeurs aux grandes compétitions." },
  basketball: { title: "Actualités basket", subtitle: "Les dernières actualités NBA, des trades majeurs aux résultats des playoffs." },
  tennis: { title: "Actualités tennis", subtitle: "Les dernières actualités tennis, des Grands Chelems aux classements ATP/WTA." },
};

export default function News() {
  const { session, sessionChecked, authorized } = useRequireAuth();
  const { sport, setSport, sportReady } = useSport();

  const [newsData, setNewsData] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadNews = useCallback((currentSport, silent = false) => {
    if (!silent) setLoading(true);
    return fetch(`/api/news?sport=${currentSport}`)
      .then((r) => r.json())
      .then((d) => {
        if (d?.error && silent) return;
        setNewsData(d);
      })
      .catch((e) => {
        console.error("Erreur /api/news:", e);
        if (!silent) setNewsData({ error: true, articles: [] });
      })
      .finally(() => setLoading(false));
  }, []);

  // Nouveau chargement (non silencieux, pour montrer l'état "Chargement…") à chaque
  // changement de sport — les actualités précédentes ne doivent jamais rester
  // affichées pour le mauvais sport pendant la transition.
  useEffect(() => {
    if (!authorized || !sportReady) return;
    loadNews(sport, false);
  }, [authorized, sportReady, sport, loadNews]);

  useEffect(() => {
    if (!authorized || !sportReady) return;
    const id = setInterval(() => loadNews(sport, true), NEWS_REFRESH_MS);
    return () => clearInterval(id);
  }, [authorized, sportReady, sport, loadNews]);

  if (!sessionChecked || !sportReady) {
    return (
      <div style={st.page}>
        <p style={st.hint}>Chargement…</p>
      </div>
    );
  }
  if (!authorized) return null;

  const articles = newsData?.articles || [];
  const hero = HERO_BY_SPORT[sport] || HERO_BY_SPORT.football;

  return (
    <div style={st.page}>
      <SiteHeader session={session} sport={sport} onSportChange={setSport} />

      <main style={st.main}>
        <section style={st.hero}>
          <h1 style={st.heroTitle} data-testid="news-hero-title">{hero.title}</h1>
          <p style={st.heroSubtitle}>{hero.subtitle}</p>
        </section>

        {loading && <p style={st.hint}>Chargement des actualités…</p>}
        {!loading && (!newsData || newsData.error) && (
          <p style={st.hint}>Les actualités ne sont pas disponibles pour le moment. Réessaie dans quelques minutes.</p>
        )}
        {!loading && newsData && !newsData.error && articles.length === 0 && (
          <p style={st.hint}>Aucune actualité disponible pour le moment.</p>
        )}

        <div style={st.list} data-testid="news-list">
          {articles.map((article) => (
            <NewsCard key={article.link} article={article} />
          ))}
        </div>
      </main>
    </div>
  );
}

const st = {
  page: { minHeight: "100vh", padding: "20px 16px 60px" },
  main: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  hero: { textAlign: "center", padding: "8px 4px" },
  heroTitle: { fontSize: 21, fontWeight: 800, margin: "0 0 8px", lineHeight: 1.25 },
  heroSubtitle: { fontSize: 12, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 },
  hint: { fontSize: 12.5, color: "var(--text-secondary)" },
  list: { display: "flex", flexDirection: "column", gap: 10 },
};
