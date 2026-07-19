import { createClient } from '@supabase/supabase-js';

// Une barre oblique finale ou un espace superflu dans NEXT_PUBLIC_SUPABASE_URL (ex :
// copié-collé depuis le dashboard Supabase) produit des requêtes vers un chemin
// mal formé ("https://xxx.supabase.co//auth/v1/signup") — Supabase répond alors
// "Invalid path specified in request URL", un message qui n'a rien à voir avec le
// formulaire lui-même. On normalise l'URL pour éviter cette classe de bug.
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
