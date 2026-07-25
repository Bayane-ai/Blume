import { useState } from "react";
import { getSession } from "../lib/session";
import { isAdmin } from "../lib/auth/admin";
import SiteHeader from "../components/SiteHeader";

// Zone "propriétaire unique" (voir PROMPT) : le contrôle d'accès a lieu ENTIÈREMENT
// côté serveur, avant même que la moindre ligne de cette page n'atteigne le
// navigateur — un visiteur qui n'est pas l'administrateur (session absente, invalide,
// ou simplement un autre compte) reçoit un vrai 403 HTTP, jamais le HTML/JS de cette
// page. C'est délibérément DIFFÉRENT du reste du site (protégé côté client via
// lib/useRequireAuth.js) : ici, la protection ne doit jamais dépendre de JavaScript
// qui s'exécute dans le navigateur de l'appelant — un script qui interroge /admin
// directement (curl, Postman) doit recevoir exactement la même réponse 403.
export async function getServerSideProps({ req, res }) {
  const session = getSession(req);

  if (!isAdmin(session)) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Non autorisé");
    return { props: {} };
  }

  return { props: { adminEmail: session.email } };
}

export default function Admin({ adminEmail }) {
  const [recomputeState, setRecomputeState] = useState({ loading: false, result: null, error: null });

  const runRecompute = async () => {
    setRecomputeState({ loading: true, result: null, error: null });
    try {
      const r = await fetch("/api/admin/recompute", { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "Échec du recalcul.");
      setRecomputeState({ loading: false, result: data, error: null });
    } catch (e) {
      setRecomputeState({ loading: false, result: null, error: e.message });
    }
  };

  return (
    <div style={st.page}>
      <SiteHeader session={{ id: null, email: adminEmail }} />

      <main style={st.main}>
        <section style={st.hero}>
          <h1 style={st.heroTitle}>Administration</h1>
          <p style={st.heroSubtitle}>
            Zone réservée au propriétaire du site — connecté en tant que {adminEmail || "administrateur"}.
          </p>
        </section>

        <section style={st.panel}>
          <h2 style={st.h2}>Recalcul manuel</h2>
          <p style={st.desc}>
            Nettoie les entrées expirées et revérifie les pronostics/combinés encore en attente
            (normalement automatique à chaque chargement des pages concernées).
          </p>
          <button type="button" style={st.btn} onClick={runRecompute} disabled={recomputeState.loading}>
            {recomputeState.loading ? "Recalcul en cours…" : "Déclencher le recalcul"}
          </button>
          {recomputeState.error && <p style={st.error}>{recomputeState.error}</p>}
          {recomputeState.result && (
            <p style={st.result} data-testid="admin-recompute-result">
              Terminé : {recomputeState.result.comboSuccessRates ? "combinés et pronostics" : ""} mis à jour.
            </p>
          )}
        </section>
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
  panel: { background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 },
  h2: { fontSize: 15, margin: "0 0 8px" },
  desc: { fontSize: 12, color: "var(--text-secondary)", margin: "0 0 14px", lineHeight: 1.5 },
  btn: {
    background: "var(--accent)", border: "none", color: "var(--on-accent)", fontWeight: 800,
    borderRadius: 999, padding: "11px 22px", fontSize: 13.5, cursor: "pointer",
  },
  error: { color: "var(--negative)", fontSize: 12.5, marginTop: 10 },
  result: { color: "var(--accent)", fontSize: 12.5, marginTop: 10 },
};
