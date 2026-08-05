// Diagnostic autonome de la couche SportScore : appelle RÉELLEMENT l'API pour les 3
// sports et logue le code HTTP, le corps brut de l'erreur et le nombre de matchs.
//
//   node scripts/diagnose-sportscore.mjs
//
// Inclut deux témoins de contrôle indispensables pour ne pas se tromper de coupable :
//   - un hôte connu pour répondre (example.com) : si LUI échoue aussi, c'est le réseau
//     de la machine qui exécute ce script, pas SportScore ;
//   - la racine sportscore.com : distingue "le domaine est injoignable" de "le domaine
//     répond mais l'endpoint /api/widget/matches/ est faux".
const SPORTS = ["football", "tennis", "basketball"];
const BASE = "https://sportscore.com";

function line() {
  console.log("-".repeat(72));
}

async function probe(label, url) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const ms = Date.now() - started;
    const raw = await res.text();
    const cors = res.headers.get("access-control-allow-origin");
    console.log(`${label}`);
    console.log(`  URL           : ${url}`);
    console.log(`  HTTP          : ${res.status} ${res.statusText}`);
    console.log(`  Durée         : ${ms} ms`);
    console.log(`  Content-Type  : ${res.headers.get("content-type") || "(absent)"}`);
    console.log(`  CORS (ACAO)   : ${cors || "(absent — bloquerait un appel navigateur)"}`);
    console.log(`  Taille corps  : ${raw.length} octets`);

    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      console.log(`  JSON          : NON — réponse non-JSON`);
      console.log(`  Corps (300c)  : ${raw.slice(0, 300).replace(/\s+/g, " ")}`);
      return { ok: false, status: res.status, count: null };
    }

    // Mêmes enveloppes que lib/sportScore.js#unwrapMatches.
    let list = null;
    if (Array.isArray(payload)) list = payload;
    else for (const k of ["matches", "data", "results", "items", "response"]) {
      if (Array.isArray(payload?.[k])) { list = payload[k]; break; }
    }
    if (!list) for (const k of ["data", "response"]) {
      const inner = payload?.[k];
      if (inner && typeof inner === "object") {
        for (const k2 of ["matches", "results", "items"]) {
          if (Array.isArray(inner[k2])) { list = inner[k2]; break; }
        }
      }
    }

    console.log(`  Clés racine   : ${Object.keys(payload || {}).slice(0, 12).join(", ") || "(tableau nu)"}`);
    console.log(`  Matchs trouvés: ${list ? list.length : "AUCUNE liste reconnue dans la réponse"}`);
    if (list && list.length > 0) {
      console.log(`  1er match brut: ${JSON.stringify(list[0]).slice(0, 400)}`);
    } else if (!list) {
      console.log(`  Corps (400c)  : ${raw.slice(0, 400).replace(/\s+/g, " ")}`);
    }
    return { ok: res.ok, status: res.status, count: list ? list.length : null };
  } catch (e) {
    console.log(`${label}`);
    console.log(`  URL           : ${url}`);
    console.log(`  ÉCHEC RÉSEAU  : ${e.name}: ${e.message}`);
    if (e.cause) console.log(`  Cause         : ${e.cause.code || e.cause.message || e.cause}`);
    return { ok: false, status: null, count: null, networkError: e.message };
  }
}

console.log(`Diagnostic SportScore — ${new Date().toISOString()}`);
console.log(`Date du jour (UTC) : ${new Date().toISOString().slice(0, 10)}`);
line();

const control = await probe("[TÉMOIN] hôte externe connu", "https://example.com");
line();
const root = await probe("[TÉMOIN] racine du domaine SportScore", BASE);
line();

const results = {};
for (const sport of SPORTS) {
  results[sport] = await probe(`[${sport.toUpperCase()}]`, `${BASE}/api/widget/matches/?sport=${sport}&limit=50`);
  line();
}

console.log("VERDICT");
if (!control.ok) {
  console.log("  Le témoin externe échoue AUSSI → c'est le réseau de CETTE machine qui bloque,");
  console.log("  pas SportScore. Ce diagnostic doit être rejoué depuis l'hébergeur (Vercel).");
} else if (!root.ok && root.networkError) {
  console.log("  Le témoin externe passe mais sportscore.com est injoignable → domaine mort ou bloqué.");
} else {
  for (const sport of SPORTS) {
    const r = results[sport];
    console.log(`  ${sport.padEnd(11)} : HTTP ${r.status ?? "—"} | ${r.count ?? "?"} match(s)${r.networkError ? ` | ${r.networkError}` : ""}`);
  }
}
