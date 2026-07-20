import { useState, useEffect, useCallback } from "react";
import { useRequireAuth } from "../lib/useRequireAuth";
import SiteHeader from "../components/SiteHeader";
import NewsCard from "../components/NewsCard";

// Actualisation automatique régulière (l'onglet "News" doit toujours montrer les
// actualités les plus récentes) — /api/news est lui-même mis en cache côté serveur
// (5 minutes), donc ce rythme côté client ne multiplie pas les appels aux flux RSS.
const NEWS_REFRESH_MS = 60000;

export default function News() {
  const { session, sessionChecked, authorized } = useRequireAuth();

  const [newsData, setNewsData] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadNews = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    return fetch("/api/news")
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

  useEffect(() => {
    if (!authorized) return;
    loadNews();
  }, [authorized, loadNews]);

  useEffect(() => {
    if (!authorized) return;
    const id = setInterval(() => loadNews(true), NEWS_REFRESH_MS);
    return () => clearInterval(id);
  }, [authorized, loadNews]);

  if (!sessionChecked) {
    return (
      <div style={st.page}>
        <p style={st.hint}>Chargement…</p>
      </div>
    );
  }
  if (!authorized) return null;

  const articles = newsData?.articles || [];

  return (
    <div style={st.page}>
      <SiteHeader session={session} />

      <main style={st.main}>
        <section style={st.hero}>
          <h1 style={st.heroTitle}>Actualités football</h1>
          <p style={st.heroSubtitle}>
            Les dernières actualités football, des transferts majeurs aux grandes compétitions.
          </p>
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
  heroSubtitle: { fontSize: 12, color: "#5C7A6A", margin: 0, lineHeight: 1.5 },
  hint: { fontSize: 12.5, color: "#5C7A6A" },
  list: { display: "flex", flexDirection: "column", gap: 10 },
};
