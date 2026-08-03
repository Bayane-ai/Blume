import { useState } from "react";
import { getSession } from "../lib/session";
import { isAdmin } from "../lib/auth/admin";
import { getAllQuotaSnapshots, getLastError } from "../lib/apiQuota";
import { formatMinutesAgo } from "../lib/formatRelativeTime";
import SiteHeader from "../components/SiteHeader";

// Sports suivis par lib/apiQuota.js — voir PROMPT (item 3) : "compteur de quota
// indépendant par sport... page d'administration... par sport". Architecture pensée
// multi-sports (voir lib/apiFootball.js et lib/sports/basketball/provider.js, tous
// deux déjà instrumentés) : ajouter un sport ici suffit à l'afficher, aucun autre
// changement nécessaire.
const TRACKED_SPORTS = [
  { sport: "football", label: "⚽ API-Football (complément petites fédérations)" },
  { sport: "basketball", label: "🏀 Basket" },
];

// football-data.org (FOOTBALL_DATA_TOKEN) : source PRINCIPALE des 12 grandes ligues
// (voir pages/api/matches.js, pages/api/live-matches.js) — pas suivie par
// lib/apiQuota.js (pas de compteur de quota, cette API n'expose pas les mêmes
// en-têtes x-ratelimit-* qu'API-SPORTS) mais sa dernière erreur réelle EST persistée
// (voir lib/liveListCache.js, pages/api/matches.js) : sa panne vide la quasi-totalité
// du site, c'est la première chose à vérifier ici en cas d'écran vide généralisé.
const EXTERNAL_SOURCE_KEY = "football-data";

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

  const sports = TRACKED_SPORTS.map((s) => s.sport);
  const errorKeys = [...sports, EXTERNAL_SOURCE_KEY];
  const [quotaSnapshots, lastErrorsList] = await Promise.all([
    getAllQuotaSnapshots(sports),
    Promise.all(errorKeys.map((key) => getLastError(key))),
  ]);

  return {
    props: {
      adminEmail: session.email,
      quotaSnapshots,
      lastErrors: errorKeys.reduce((acc, key, i) => ({ ...acc, [key]: lastErrorsList[i] }), {}),
      // Lu ICI, côté serveur EN PRODUCTION (jamais depuis le sandbox de développement,
      // qui n'a jamais ces variables) : la seule façon fiable de confirmer qu'une clé
      // est bien configurée sur Vercel — jamais la valeur elle-même, uniquement sa
      // présence.
      envStatus: {
        footballDataToken: Boolean(process.env.FOOTBALL_DATA_TOKEN),
        apiFootballKey: Boolean(process.env.API_FOOTBALL_KEY || process.env.API_BASKETBALL_KEY),
      },
    },
  };
}

export default function Admin({ adminEmail, quotaSnapshots, lastErrors, envStatus }) {
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
          <h2 style={st.h2}>Variables d'environnement (production)</h2>
          <p style={st.desc}>
            Présence réelle des clés API sur CE serveur (jamais leur valeur) — lu directement
            depuis l'environnement Vercel qui sert cette page, jamais depuis un fichier local.
          </p>
          <div style={st.quotaGrid}>
            <div style={st.quotaCard} data-testid="admin-env-football-data-token">
              <div style={st.quotaLabel}>FOOTBALL_DATA_TOKEN (source principale des matchs)</div>
              <div style={envStatus?.footballDataToken ? st.envOk : st.envMissing}>
                {envStatus?.footballDataToken ? "Configurée" : "MANQUANTE — aucun match ne peut s'afficher sans elle"}
              </div>
            </div>
            <div style={st.quotaCard} data-testid="admin-env-api-football-key">
              <div style={st.quotaLabel}>API_FOOTBALL_KEY / API_BASKETBALL_KEY (complément + basket)</div>
              <div style={envStatus?.apiFootballKey ? st.envOk : st.envMissing}>
                {envStatus?.apiFootballKey ? "Configurée" : "MANQUANTE — petites fédérations et basket indisponibles"}
              </div>
            </div>
          </div>
          {lastErrors?.[EXTERNAL_SOURCE_KEY] && (
            <div style={st.quotaError} data-testid="admin-last-error-football-data">
              Dernière erreur football-data.org ({formatMinutesAgo(lastErrors[EXTERNAL_SOURCE_KEY].at)}) :{" "}
              {lastErrors[EXTERNAL_SOURCE_KEY].message}
            </div>
          )}
        </section>

        <section style={st.panel}>
          <h2 style={st.h2}>Consommation API du jour, par sport</h2>
          <p style={st.desc}>
            Nombre de requêtes réellement envoyées aujourd'hui à chaque API (compteur interne),
            et la dernière valeur connue de x-ratelimit-requests-remaining renvoyée par l'API
            elle-même — jamais déduite, toujours lue depuis l'en-tête réel de la dernière réponse.
          </p>
          <div style={st.quotaGrid} data-testid="admin-quota-grid">
            {(quotaSnapshots || []).map((snap) => (
              <div key={snap.sport} style={st.quotaCard} data-testid={`admin-quota-${snap.sport}`}>
                <div style={st.quotaLabel}>
                  {TRACKED_SPORTS.find((s) => s.sport === snap.sport)?.label || snap.sport}
                </div>
                <div style={st.quotaNumbers}>
                  <span>
                    {snap.requestsUsed ?? "–"} requête{snap.requestsUsed === 1 ? "" : "s"} utilisée
                    {snap.requestsUsed === 1 ? "" : "s"} aujourd'hui
                  </span>
                  <span>
                    {snap.requestsRemaining != null
                      ? `${snap.requestsRemaining} restante${snap.requestsRemaining === 1 ? "" : "s"}${
                          snap.requestsLimit != null ? ` / ${snap.requestsLimit}` : ""
                        }`
                      : "Quota restant : indisponible (aucun en-tête reçu pour l'instant)"}
                  </span>
                </div>
                <div style={st.quotaMeta}>
                  {snap.updatedAt ? `Dernière requête ${formatMinutesAgo(snap.updatedAt)}` : "Aucune requête effectuée aujourd'hui"}
                </div>
                {lastErrors?.[snap.sport] && (
                  <div style={st.quotaError} data-testid={`admin-last-error-${snap.sport}`}>
                    Dernière erreur ({formatMinutesAgo(lastErrors[snap.sport].at)}) : {lastErrors[snap.sport].message}
                  </div>
                )}
              </div>
            ))}
          </div>
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
  quotaGrid: { display: "flex", flexDirection: "column", gap: 10 },
  quotaCard: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 14 },
  quotaLabel: { fontSize: 13.5, fontWeight: 800, marginBottom: 6 },
  quotaNumbers: { display: "flex", flexDirection: "column", gap: 2, fontSize: 12.5 },
  quotaMeta: { fontSize: 11.5, color: "var(--text-secondary)", marginTop: 6, fontStyle: "italic" },
  quotaError: { fontSize: 11.5, color: "var(--negative)", marginTop: 6, wordBreak: "break-word" },
  envOk: { fontSize: 12.5, color: "var(--accent)", fontWeight: 700 },
  envMissing: { fontSize: 12.5, color: "var(--negative)", fontWeight: 700 },
  btn: {
    background: "var(--accent)", border: "none", color: "var(--on-accent)", fontWeight: 800,
    borderRadius: 999, padding: "11px 22px", fontSize: 13.5, cursor: "pointer",
  },
  error: { color: "var(--negative)", fontSize: 12.5, marginTop: 10 },
  result: { color: "var(--accent)", fontSize: 12.5, marginTop: 10 },
};
