import { createClient } from "@supabase/supabase-js";

// Client Supabase côté serveur, utilisé uniquement pour vérifier le token de l'utilisateur
// et lire/écrire sa ligne dans la table "coupons" protégée par Row Level Security.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Non connecté" });

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user) return res.status(401).json({ error: "Session invalide" });

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("coupons")
      .select("selections")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ selections: data?.selections || [] });
  }

  if (req.method === "POST") {
    const { selections } = req.body || {};
    const { error } = await supabase
      .from("coupons")
      .upsert({ user_id: user.id, selections, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Méthode non autorisée" });
}
