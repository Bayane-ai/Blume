#!/usr/bin/env node
// npm run test:matches — mêmes vérifications que le contrôle quotidien, en local
// (bloc 2, point 4d). Sort en code 1 dès qu'UN sport échoue, pour pouvoir être branché
// sur une CI sans autre glue.
//
// Cible par défaut : http://localhost:3000. Surchargeable :
//   BLUME_BASE_URL=https://blume.vercel.app npm run test:matches
//
// Le contrôle lui-même vit dans lib/healthMatches.mjs et n'est PAS réécrit ici :
// le script local et le cron doivent mesurer exactement la même chose, sinon l'un des
// deux ment tôt ou tard.
import { controlerTous } from "../lib/healthMatches.mjs";

const base = process.env.BLUME_BASE_URL || "http://localhost:3000";

const LARGEUR = 13;
const pad = (s) => String(s).padEnd(LARGEUR);

async function main() {
  console.log(`\nContrôle des matchs — ${base}\n`);

  let rapport;
  try {
    rapport = await controlerTous({ base });
  } catch (e) {
    console.error(`Contrôle impossible : ${e.message}`);
    process.exit(1);
  }

  console.log(`${pad("SPORT")}${pad("VERDICT")}${pad("MATCHS")}${pad("COMPÉT.")}${pad("HTTP")}${pad("DURÉE")}RAISON`);
  for (const [sport, r] of Object.entries(rapport.sports)) {
    console.log(
      `${pad(sport)}${pad(r.verdict)}${pad(r.matchs)}${pad(r.competitions ?? 0)}${pad(r.httpCode ?? "—")}${pad(`${r.dureeMs} ms`)}${r.raison || ""}`
    );
    for (const s of r.sources || []) {
      const detail = s.erreur ? `échec — ${s.erreur}` : `${s.statut}, ${s.recus ?? 0} reçu(s)`;
      console.log(`  · ${s.nom} : ${detail}`);
    }
  }

  console.log(`\nVerdict global : ${rapport.verdict}`);
  if (rapport.echecs.length) {
    console.error(`Sports en échec : ${rapport.echecs.join(", ")}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
