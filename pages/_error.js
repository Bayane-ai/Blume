function ErrorPage({ statusCode }) {
  return (
    <div style={s.page}>
      <div style={s.card}>
        <h1 style={s.h1}>Oups, une erreur est survenue</h1>
        <p style={s.text}>
          {statusCode ? `Erreur ${statusCode}. ` : ""}Réessaie dans quelques instants.
        </p>
        <a href="/" style={s.btn}>← Retour à l'accueil</a>
      </div>
    </div>
  );
}

ErrorPage.getInitialProps = ({ res, err }) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default ErrorPage;

const s = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "var(--surface)", color: "var(--text-primary)" },
  card: {
    width: "100%", maxWidth: 360, background: "var(--card-bg)", border: "1px solid var(--border)",
    borderRadius: 16, padding: 24, textAlign: "center",
  },
  h1: { fontSize: 18, margin: "0 0 8px" },
  text: { fontSize: 13, color: "var(--text-secondary)", margin: "0 0 16px" },
  btn: {
    display: "inline-block", background: "var(--accent)", border: "none", color: "var(--on-accent)", fontWeight: 700,
    borderRadius: 999, padding: "10px 20px", fontSize: 13, textDecoration: "none",
  },
};
