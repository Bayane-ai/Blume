import { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

const SPORTS = ["Football", "Tennis", "Basket", "Rugby", "Hockey", "Autre"];
const uid = () => Math.random().toString(36).slice(2, 9);

function impliedProb(odds) {
  const o = parseFloat(odds);
  if (!o || o <= 1) return null;
  return 1 / o;
}
function pct(x, digits = 1) {
  if (x === null || x === undefined || isNaN(x)) return "—";
  return (x * 100).toFixed(digits) + " %";
}
function evOf(estProb, odds) {
  const p = estProb, o = parseFloat(odds);
  if (p === null || p === undefined || isNaN(p) || !o) return null;
  return p * (o - 1) - (1 - p);
}

export default function Home() {
  const [session, setSession] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  const [selections, setSelections] = useState([
    { id: uid(), sport: "Football", label: "Équipe A gagne", odds: "1.85", estProb: "" },
  ]);
  const [marketOdds, setMarketOdds] = useState(["2.10", "3.40", "3.60"]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionChecked(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const res = await fetch("/api/coupon", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const data = await res.json();
      if (data.selections && data.selections.length > 0) setSelections(data.selections);
    })();
  }, [session]);

  const addSelection = () =>
    setSelections((sArr) => [...sArr, { id: uid(), sport: "Football", label: "", odds: "", estProb: "" }]);
  const removeSelection = (id) => setSelections((sArr) => sArr.filter((x) => x.id !== id));
  const updateSelection = (id, field, value) =>
    setSelections((sArr) => sArr.map((x) => (x.id === id ? { ...x, [field]: value } : x)));

  const rows = selections.map((r) => {
    const imp = impliedProb(r.odds);
    const est = r.estProb !== "" && !isNaN(parseFloat(r.estProb)) ? parseFloat(r.estProb) / 100 : null;
    const edge = est !== null && imp !== null ? est - imp : null;
    return { ...r, imp, est, edge };
  });
  const validRows = rows.filter((r) => r.imp !== null);
  const combinedOdds = validRows.reduce((acc, r) => acc * parseFloat(r.odds), 1);
  const combinedImplied = validRows.reduce((acc, r) => acc * r.imp, 1);
  const allHaveEst = validRows.length > 0 && validRows.every((r) => r.est !== null);
  const combinedEst = allHaveEst ? validRows.reduce((acc, r) => acc * r.est, 1) : null;
  const combinedEv = allHaveEst ? evOf(combinedEst, combinedOdds) : null;

  const overround = marketOdds.map(impliedProb).filter((p) => p !== null).reduce((a, p) => a + p, 0);

  const saveCoupon = async () => {
    if (!session) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ selections }),
      });
      if (!res.ok) throw new Error("Échec de la sauvegarde");
      setSaveMsg("Coupon sauvegardé ✓");
    } catch (e) {
      setSaveMsg("Erreur : " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => supabase.auth.signOut();

  return (
    <div style={s.page}>
      <header style={s.header}>
        <h1 style={s.h1}>Table de cotes</h1><a href="/matches" style={s.smallBtn}>Matchs</a>
        {sessionChecked && (
          session ? (
            <div style={s.headerRight}>
              <span style={s.emailTag}>{session.user.email}</span>
              <button onClick={logout} style={s.smallBtn}>Déconnexion</button>
            </div>
          ) : (
            <a href="/login" style={s.smallBtn}>Se connecter</a>
          )
        )}
      </header>

      <main style={s.main}>
        <section style={s.panel}>
          <div style={s.panelHead}>
            <h2 style={s.h2}>Sélections</h2>
            <button style={s.addBtn} onClick={addSelection}>+ Ajouter</button>
          </div>
          {rows.map((r) => (
            <div key={r.id} style={s.selRow}>
              <select
                value={r.sport}
                onChange={(e) => updateSelection(r.id, "sport", e.target.value)}
                style={s.select}
              >
                {SPORTS.map((sp) => <option key={sp} value={sp}>{sp}</option>)}
              </select>
              <input
                placeholder="ex : Équipe A gagne"
                value={r.label}
                onChange={(e) => updateSelection(r.id, "label", e.target.value)}
                style={s.textInput}
              />
              <input
                placeholder="cote"
                value={r.odds}
                onChange={(e) => updateSelection(r.id, "odds", e.target.value)}
                style={s.numInput}
              />
              <input
                placeholder="ton %"
                value={r.estProb}
                onChange={(e) => updateSelection(r.id, "estProb", e.target.value)}
                style={s.numInput}
              />
              <button style={s.removeBtn} onClick={() => removeSelection(r.id)}>✕</button>
            </div>
          ))}
          {rows.map((r) =>
            r.imp === null ? null : (
              <div key={r.id + "-bar"} style={s.barRow}>
                <span style={s.barLabel}>{r.label || "Sélection"}</span>
                <span style={s.barValue}>
                  {pct(r.imp)}
                  {r.edge !== null && (
                    <span style={{ color: r.edge >= 0 ? "#39B577" : "#D8685E", marginLeft: 8 }}>
                      {r.edge >= 0 ? "+" : ""}{pct(r.edge)}
                    </span>
                  )}
                </span>
              </div>
            )
          )}
        </section>

        <section style={s.panel}>
          <h2 style={s.h2}>Résumé du coupon</h2>
          <div style={s.summaryGrid}>
            <div style={s.summaryCell}>
              <span style={s.summaryLabel}>Cote combinée</span>
              <span style={s.summaryValue}>{validRows.length ? combinedOdds.toFixed(2) : "—"}</span>
            </div>
            <div style={s.summaryCell}>
              <span style={s.summaryLabel}>Probabilité implicite</span>
              <span style={s.summaryValue}>{validRows.length ? pct(combinedImplied) : "—"}</span>
            </div>
            <div style={s.summaryCell}>
              <span style={s.summaryLabel}>Ta probabilité</span>
              <span style={s.summaryValue}>{combinedEst !== null ? pct(combinedEst) : "à renseigner"}</span>
            </div>
            <div style={s.summaryCell}>
              <span style={s.summaryLabel}>Valeur espérée (EV)</span>
              <span style={{ ...s.summaryValue, color: combinedEv === null ? "#E9F1EC" : combinedEv >= 0 ? "#39B577" : "#D8685E" }}>
                {combinedEv !== null ? (combinedEv >= 0 ? "+" : "") + pct(combinedEv) : "—"}
              </span>
            </div>
          </div>
          {session ? (
            <>
              <button style={s.saveBtn} onClick={saveCoupon} disabled={saving}>
                {saving ? "Sauvegarde…" : "Sauvegarder mon coupon"}
              </button>
              {saveMsg && <p style={s.hint}>{saveMsg}</p>}
            </>
          ) : (
            <p style={s.hint}><a href="/login" style={{ color: "#39B577" }}>Connecte-toi</a> pour sauvegarder ton coupon.</p>
          )}
        </section>

        <section style={s.panel}>
          <h2 style={s.h2}>Marge du bookmaker</h2>
          <p style={s.hint}>Entre les cotes des issues d'un même marché (2 ou 3 issues).</p>
          <div style={s.selRow}>
            {marketOdds.map((o, i) => (
              <input
                key={i}
                value={o}
                onChange={(e) => {
                  const next = [...marketOdds];
                  next[i] = e.target.value;
                  setMarketOdds(next);
                }}
                style={s.numInput}
              />
            ))}
          </div>
          <div style={s.summaryGrid}>
            <div style={s.summaryCell}>
              <span style={s.summaryLabel}>Somme des probabilités</span>
              <span style={s.summaryValue}>{pct(overround)}</span>
            </div>
            <div style={s.summaryCell}>
              <span style={s.summaryLabel}>Marge bookmaker</span>
              <span style={s.summaryValue}>{overround ? pct(overround - 1) : "—"}</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

const s = {
  page: { minHeight: "100vh", padding: "20px 16px 60px" },
  header: { maxWidth: 640, margin: "0 auto 20px", display: "flex", justifyContent: "space-between", alignItems: "center" },
  h1: { fontSize: 20, fontWeight: 800, margin: 0 },
  headerRight: { display: "flex", alignItems: "center", gap: 10 },
  emailTag: { fontSize: 11, color: "#7EA694" },
  smallBtn: {
    background: "transparent", border: "1px solid #1E3D2C", color: "#E9F1EC",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, textDecoration: "none", cursor: "pointer",
  },
  main: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  panel: { background: "#12291E", border: "1px solid #1E3D2C", borderRadius: 14, padding: 18 },
  panelHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  h2: { fontSize: 15, margin: 0 },
  hint: { fontSize: 12.5, color: "#7EA694" },
  addBtn: {
    background: "transparent", border: "1px solid #39B57766", color: "#39B577",
    borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
  },
  selRow: { display: "flex", gap: 8, marginBottom: 8, alignItems: "center" },
  select: { flex: "0 0 92px", background: "#0B1F16", border: "1px solid #1E3D2C", color: "#E9F1EC", borderRadius: 8, padding: "8px 6px", fontSize: 12.5 },
  textInput: { flex: 1, background: "#0B1F16", border: "1px solid #1E3D2C", color: "#E9F1EC", borderRadius: 8, padding: "8px 10px", fontSize: 13, minWidth: 0 },
  numInput: { flex: "0 0 70px", background: "#0B1F16", border: "1px solid #1E3D2C", color: "#39B577", borderRadius: 8, padding: "8px 6px", fontSize: 13, textAlign: "center" },
  removeBtn: { flex: "0 0 24px", background: "transparent", border: "none", color: "#D8685E", cursor: "pointer" },
  barRow: { display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 6, color: "#7EA694" },
  barLabel: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  barValue: { flexShrink: 0 },
  summaryGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 6 },
  summaryCell: { background: "#0B1F16", border: "1px solid #1E3D2C", borderRadius: 8, padding: "10px 12px" },
  summaryLabel: { display: "block", fontSize: 10, color: "#7EA694", textTransform: "uppercase", marginBottom: 4 },
  summaryValue: { fontSize: 16, fontWeight: 600 },
  saveBtn: {
    background: "#39B577", border: "none", color: "#06121F", fontWeight: 700,
    borderRadius: 999, padding: "11px 0", width: "100%", fontSize: 14, cursor: "pointer", marginTop: 8,
  },
};
