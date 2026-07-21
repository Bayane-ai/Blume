import { useState, useEffect, useMemo, useCallback } from "react";
import { useRequireAuth } from "../lib/useRequireAuth";
import { generateCombos, RISK_LABELS } from "../lib/combinedVision";
import SiteHeader from "../components/SiteHeader";
import CombinedVisionTicket from "../components/CombinedVisionTicket";

const RISK_ORDER = ["faible", "moyen", "eleve"];

// Les combinés changent de composition à chaque actualisation (tirage aléatoire parmi
// les lignes éligibles, voir lib/combinedVision.js) — un intervalle modéré suffit,
// aligné sur le cache serveur de /api/matches (s-maxage=60) pour ne jamais dépasser le
// quota football-data.org.
const REFRESH_MS = 45000;

// Page "Combiné Vision" (voir PROMPT) : L'APP GÉNÈRE AUTOMATIQUEMENT les combinés,
// l'utilisateur ne sélectionne rien. Construits à partir des VRAIS matchs à venir et
// en direct déjà chargés par /api/matches et /api/live-matches — ces deux routes
// calculent déjà un pronostic réel par match (lib/pronostic.js), donc aucun appel
// supplémentaire à l'API n'est nécessaire ici.
export default function CombineVision() {
  const { session, sessionChecked, authorized } = useRequireAuth();

  const [upcomingData, setUpcomingData] = useState(null);
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [combos, setCombos] = useState([]);
  // BLOC 4.B / BLOC 5 "Suivi dans le temps" — taux de réussite par niveau de risque,
  // et progression (statut global + résultat de chaque sélection) des combinés
  // actuellement affichés (voir lib/comboHistory.js / pages/api/combo-history.js).
  const [successRates, setSuccessRates] = useState({});
  const [progress, setProgress] = useState({});
  // BLOC 5 — "propositions dynamiques" : horodatage de la dernière actualisation
  // réussie, affiché près du bouton "Actualiser" pour que la personne comprenne que
  // cette liste n'est pas figée (voir PROMPT).
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    return Promise.all([
      fetch("/api/matches").then((r) => r.json()).catch((e) => {
        console.error("Erreur /api/matches:", e);
        return null;
      }),
      fetch("/api/live-matches").then((r) => r.json()).catch((e) => {
        console.error("Erreur /api/live-matches:", e);
        return null;
      }),
    ]).then(([upcoming, live]) => {
      setUpcomingData(upcoming);
      setLiveData(live);
      setLastUpdatedAt(new Date());
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!authorized) return;
    load();
  }, [authorized, load]);

  // Actualisation automatique : de nouveaux combinés apparaissent régulièrement, sans
  // que la personne ait besoin de recharger la page (voir PROMPT).
  useEffect(() => {
    if (!authorized) return;
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [authorized, load]);

  // Toutes les compétitions confondues, à venir ET en direct — un match qui vient de
  // démarrer doit pouvoir alimenter un combiné "En live" sans attendre le prochain
  // cycle de /api/matches (mis à jour moins souvent que /api/live-matches).
  const allMatches = useMemo(() => {
    const upcoming = (upcomingData?.competitions || []).flatMap((c) => c.matches || []);
    const live = liveData?.matches || [];
    return [...live, ...upcoming];
  }, [upcomingData, liveData]);

  // Une nouvelle génération (tirage aléatoire) à chaque chargement de données réussi —
  // pas seulement au premier rendu — pour que l'actualisation change réellement la
  // composition des combinés proposés.
  useEffect(() => {
    if (allMatches.length === 0) {
      setCombos([]);
      return;
    }
    setCombos(generateCombos(allMatches));
  }, [allMatches]);

  // BLOC 4.B / BLOC 5 — enregistre les combinés fraîchement générés ("pending", voir
  // lib/comboHistory.js) et relit le taux de réussite par niveau de risque + la
  // progression (statut global + résultat de chaque sélection, pour cocher au fil des
  // matchs) des combinés actuellement affichés. Best-effort : une erreur ici
  // (Supabase indisponible, migration pas encore exécutée) ne doit jamais empêcher
  // l'affichage des combinés eux-mêmes.
  useEffect(() => {
    if (combos.length === 0) return;
    fetch("/api/combo-history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ combos }),
    }).catch((e) => console.error("Erreur sauvegarde historique combinés:", e));

    const ids = combos.map((c) => c.id).join(",");
    fetch(`/api/combo-history?ids=${encodeURIComponent(ids)}`)
      .then((r) => r.json())
      .then((data) => {
        setSuccessRates(data.successRates || {});
        setProgress(data.progress || {});
      })
      .catch((e) => console.error("Erreur lecture historique combinés:", e));
  }, [combos]);

  const hasError = (upcomingData?.error && liveData?.error) || (!upcomingData && !liveData);

  if (!sessionChecked) {
    return (
      <div style={st.page}>
        <p style={st.hint}>Chargement…</p>
      </div>
    );
  }
  if (!authorized) return null;

  return (
    <div style={st.page}>
      <SiteHeader session={session} />

      <main style={st.main}>
        <section style={st.hero}>
          <h1 style={st.heroTitle}>Combiné Vision</h1>
          <p style={st.heroSubtitle}>
            L'app assemble automatiquement des pronostics assez sûrs sur plusieurs matchs pour
            proposer des combinés à différents niveaux de risque — jamais de cote chiffrée,
            seulement les sélections détaillées et un niveau de confiance.
          </p>
        </section>

        <div style={st.refreshRow}>
          <button type="button" style={st.refreshBtn} onClick={() => load(false)} disabled={loading}>
            {loading ? "Actualisation…" : "Actualiser"}
          </button>
          {/* BLOC 5 — "propositions dynamiques" : indicateur visuel clair que la liste
              n'est pas figée, se renouvelle automatiquement (voir PROMPT). */}
          <p style={st.freshnessHint} data-testid="combined-vision-freshness">
            <span style={st.freshnessDot} aria-hidden="true" />
            {lastUpdatedAt
              ? `Mis à jour à ${lastUpdatedAt.toLocaleTimeString("fr-FR")} · se renouvelle automatiquement`
              : "Se renouvelle automatiquement"}
          </p>
        </div>

        {loading && !upcomingData && !liveData && <p style={st.hint}>Chargement des combinés…</p>}
        {!loading && hasError && (
          <p style={st.hint}>Les combinés ne sont pas disponibles pour le moment. Réessaie dans quelques minutes.</p>
        )}
        {/* BLOC 4.D — "aucun combiné fiable disponible : ne rien forcer" : jamais un
            combiné rempli avec des lignes en dessous du seuil de confiance, juste un
            message clair invitant à revenir plus tard. */}
        {!loading && !hasError && combos.length === 0 && (
          <p style={st.hint} data-testid="combined-vision-empty">
            Aucun combiné fiable disponible pour le moment — reviens plus tard.
          </p>
        )}

        {/* BLOC 4.B — taux de réussite par niveau de risque (autorisé, ce n'est pas
            une cote — voir PROMPT) : n'apparaît que pour les niveaux ayant déjà au
            moins un combiné classé Gagné/Perdu. */}
        {RISK_ORDER.some((level) => successRates[level]) && (
          <section style={st.statsBox} data-testid="combo-success-rates">
            {RISK_ORDER.filter((level) => successRates[level]).map((level) => (
              <div key={level} style={st.statsRow} data-testid={`success-rate-${level}`}>
                {RISK_LABELS[level]} : {successRates[level].pct} % réussis ({successRates[level].total} combiné{successRates[level].total > 1 ? "s" : ""})
              </div>
            ))}
          </section>
        )}

        <div style={st.list} data-testid="combined-vision-list">
          {combos.map((combo) => (
            <CombinedVisionTicket key={combo.id} combo={combo} progress={progress[combo.id]} />
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
  refreshRow: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6 },
  refreshBtn: {
    alignSelf: "center", background: "var(--accent)", border: "none", color: "var(--on-accent)", fontWeight: 800,
    borderRadius: 999, padding: "10px 24px", fontSize: 13, cursor: "pointer",
  },
  freshnessHint: {
    display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)", margin: 0,
  },
  freshnessDot: {
    width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", flexShrink: 0,
  },
  list: { display: "flex", flexDirection: "column", gap: 10 },
  statsBox: {
    background: "var(--card-bg)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 14px",
    display: "flex", flexDirection: "column", gap: 4,
  },
  statsRow: { fontSize: 12, fontWeight: 700, color: "var(--text-primary)" },
};
