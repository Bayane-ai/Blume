// Garde-fou écrit après un incident réel : vercel.json programmait le cron de
// règlement des pronostics toutes les 10 minutes (expression à pas de 10 sur le champ
// minute), incompatible avec un plan Vercel Hobby (gratuit), qui n'autorise qu'UNE
// exécution par jour maximum pour un cron. Résultat : Vercel refusait silencieusement
// tout nouveau déploiement pendant des jours (l'app continuait de tourner sur l'ancien
// code déployé avant l'introduction de ce cron), ce qui a fait croire à tort à un
// problème d'intégration Git. Ce fichier échoue si un cron plus fréquent qu'une fois
// par jour revient dans vercel.json, quel que soit le chemin ou l'expression exacte.
const fs = require("fs");
const path = require("path");

// Champs d'une expression cron à 5 parties : minute heure jour-du-mois mois jour-de-semaine.
function runsMoreThanOncePerDay(schedule) {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return true; // forme inattendue : jamais supposée sûre par défaut
  const [minute, hour] = parts;
  // Plus d'une exécution par jour dès que la minute ou l'heure contient un pas ("*/N"),
  // une liste ("a,b") ou un intervalle ("a-b") — seule une minute ET une heure fixes
  // (chacune un seul nombre) garantissent une unique exécution quotidienne.
  const isFixedSingleValue = (field) => /^\d+$/.test(field);
  return !(isFixedSingleValue(minute) && isFixedSingleValue(hour));
}

test("aucun cron de vercel.json ne s'exécute plus d'une fois par jour (limite du plan Vercel Hobby)", () => {
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "../vercel.json"), "utf8"));
  const crons = vercelConfig.crons || [];
  expect(crons.length).toBeGreaterThan(0); // le cron de règlement doit toujours exister

  for (const cron of crons) {
    expect(runsMoreThanOncePerDay(cron.schedule)).toBe(false);
  }
});

test("runsMoreThanOncePerDay reconnaît correctement les cas limites (documentation du garde-fou)", () => {
  expect(runsMoreThanOncePerDay("*/10 * * * *")).toBe(true); // la régression réelle
  expect(runsMoreThanOncePerDay("0 */4 * * *")).toBe(true); // toutes les 4h : toujours plus d'une fois/jour
  expect(runsMoreThanOncePerDay("0,30 3 * * *")).toBe(true); // deux fois/jour
  expect(runsMoreThanOncePerDay("0 3 * * *")).toBe(false); // une fois par jour à 3h : autorisé sur Hobby
  expect(runsMoreThanOncePerDay("15 9 * * *")).toBe(false);
});
