// Cascade de sources — demandé explicitement : « si la source principale renvoie 0
// pour un sport, interroge automatiquement la source secondaire AVANT tout affichage ».
//
// Règle appliquée ici, et c'est tout l'intérêt du module : on ne s'arrête PAS à la
// première source qui répond, on s'arrête à la première source qui RAMÈNE quelque
// chose. Un 200 avec 0 résultat n'est pas une réponse satisfaisante tant qu'une autre
// source n'a pas été essayée — c'est exactement le cas qui affichait « Aucun match »
// alors que des matchs existaient réellement.
//
// Chaque tentative est conservée intégralement (nom, code HTTP amont, nombre reçu,
// erreur exacte), pour que la route puisse renvoyer un diagnostic honnête et que
// l'interface distingue les deux situations qui n'ont rien à voir :
//   - toutes les sources ont répondu correctement et n'avaient rien  -> vide légitime
//   - au moins une source est en panne                               -> problème de
//     connexion, message dédié + nouvelle tentative (voir composant d'affichage)

// sources : [{ name, run: async () => ({ matches, httpStatus }) | matches[] }]
// L'ordre du tableau EST l'ordre de la cascade.
export async function runCascade(sources) {
  const attempts = [];
  let matches = [];

  for (const source of sources) {
    if (source?.skip) {
      // Source volontairement non interrogée (clé absente, quota épuisé...). Elle est
      // signalée telle quelle : ce n'est ni un succès à 0, ni une panne réseau.
      attempts.push({
        name: source.name,
        httpStatus: null,
        received: 0,
        error: source.skip,
        skipped: true,
      });
      continue;
    }

    try {
      const out = await source.run();
      const list = Array.isArray(out) ? out : out?.matches || [];
      attempts.push({
        name: source.name,
        httpStatus: Array.isArray(out) ? 200 : out?.httpStatus ?? 200,
        received: list.length,
        error: Array.isArray(out) ? null : out?.error || null,
        // Échecs PARTIELS (ex : 1 journée sur 8 en timeout) : la source a bien répondu,
        // donc ce n'est pas une panne — mais l'information ne doit pas disparaître.
        ...(!Array.isArray(out) && out?.partialFailures?.length
          ? { partialFailures: out.partialFailures.slice(0, 3) }
          : {}),
      });
      if (list.length) {
        matches = list;
        break; // Première source RÉELLEMENT productive : inutile d'épuiser le quota des suivantes.
      }
    } catch (e) {
      attempts.push({
        name: source.name,
        httpStatus: e?.httpStatus ?? null,
        received: 0,
        error: e?.message || String(e),
      });
    }
  }

  // Une source « en échec » est une source qui n'a pas pu répondre (réseau, HTTP non
  // 2xx, clé absente). Une source qui répond 0 n'est PAS en échec.
  const failed = attempts.filter((a) => a.error);
  return {
    matches,
    attempts,
    // Vrai seulement si AUCUNE source n'a pu répondre correctement : c'est la condition
    // qui autorise l'interface à afficher « problème de connexion » plutôt que « aucun
    // match ».
    allSourcesFailed: attempts.length > 0 && failed.length === attempts.length,
    anySourceFailed: failed.length > 0,
    // Erreur à remonter en priorité : celle de la source principale si elle a échoué,
    // sinon la première rencontrée.
    error: failed.length ? failed[0].error : null,
  };
}
