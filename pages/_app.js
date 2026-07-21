import React from 'react';
import '../styles/globals.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error(error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={s.page}>
          <div style={s.card}>
            <h1 style={s.h1}>Oups, une erreur est survenue</h1>
            <p style={s.text}>Réessaie dans quelques instants.</p>
            <a href="/" style={s.btn}>← Retour à l'accueil</a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App({ Component, pageProps }) {
  return (
    <ErrorBoundary>
      <Component {...pageProps} />
    </ErrorBoundary>
  );
}

const s = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
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
