// Carte "News" : image (si disponible), titre, court résumé, source + date. Toute la
// carte est cliquable et ouvre l'article réel dans un nouvel onglet (target="_blank").
export default function NewsCard({ article }) {
  if (!article?.title || !article?.link) return null;

  return (
    <a
      href={article.link}
      target="_blank"
      rel="noopener noreferrer"
      style={st.card}
      data-testid="news-card"
    >
      {article.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={article.image} alt="" style={st.image} />
      )}
      <div style={st.body}>
        <h3 style={st.title}>{article.title}</h3>
        {article.summary && <p style={st.summary}>{article.summary}</p>}
        <div style={st.meta}>
          {article.source && <span>{article.source}</span>}
          {article.source && article.publishedAt && <span> · </span>}
          {article.publishedAt && <span>{formatDate(article.publishedAt)}</span>}
        </div>
      </div>
    </a>
  );
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const st = {
  card: {
    display: "flex", gap: 12, background: "#12291E", border: "1px solid #1E3D2C",
    borderRadius: 14, padding: 12, textDecoration: "none", color: "#E9F1EC",
  },
  image: {
    width: 92, height: 92, objectFit: "cover", borderRadius: 10, flexShrink: 0,
    background: "#0B1B13",
  },
  body: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 },
  title: { fontSize: 14.5, fontWeight: 800, margin: 0, lineHeight: 1.3, color: "#E9F1EC" },
  summary: {
    fontSize: 12.5, color: "#B7CEC2", margin: 0, lineHeight: 1.4,
    display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
  },
  meta: { fontSize: 11, color: "#7EA694", marginTop: 2 },
};
