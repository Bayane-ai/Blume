// Cache PERSISTANT partagé par TOUS les sports (table api_football_cache, voir
// supabase/migrations/0015_api_football_cache.sql — nom historique du football,
// premier sport à en avoir eu besoin, mais le schéma (cache_key/payload/fetched_at)
// est déjà générique : réutilisé tel quel ici, une clé préfixée par sport
// ("basketball:live_all", "football:upcoming:2026-08-02"...) suffit à les isoler,
// jamais besoin d'une table par sport).
//
// Raison d'être (signalement réel, football d'abord) : le cache en mémoire de chaque
// provider (Map/variable de module) ne survit QUE le temps d'une instance Vercel
// "chaude" — sous trafic réel, chaque instance froide qui redémarre refait TOUS les
// appels API depuis le début, ce qui épuise un quota journalier en quelques
// chargements de page. Ce module laisse une instance froide réutiliser la dernière
// réponse encore fraîche plutôt que de rappeler l'API, partagée entre toutes les
// instances ET tous les sports — jamais bloquant : toute erreur (table absente car
// migration pas encore exécutée, Supabase indisponible...) est avalée ici et traitée
// exactement comme "pas de cache", pour ne jamais casser le comportement déjà en
// place (cache en mémoire + appel réseau direct, propre à chaque provider).
import { getSupabaseAdmin } from "./supabaseAdmin";

export async function readPersistentCache(key) {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("api_football_cache")
      .select("payload, fetched_at")
      .eq("cache_key", key)
      .maybeSingle();
    if (error || !data) return null;
    return { payload: data.payload, fetchedAt: new Date(data.fetched_at).getTime() };
  } catch {
    return null;
  }
}

export function writePersistentCache(key, payload) {
  // Volontairement non attendue par l'appelant (fire-and-forget) : écrire ce cache ne
  // doit jamais ralentir la réponse déjà prête à partir, seulement profiter à un futur
  // appel (potentiellement sur une tout autre instance serverless, ou un autre sport).
  (async () => {
    try {
      const supabase = getSupabaseAdmin();
      await supabase
        .from("api_football_cache")
        .upsert({ cache_key: key, payload, fetched_at: new Date().toISOString() });
    } catch {
      // Best effort — voir commentaire ci-dessus.
    }
  })();
}
