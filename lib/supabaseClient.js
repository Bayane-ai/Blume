import { createBrowserClient } from '@supabase/ssr';

// Client Supabase NAVIGATEUR (composants React : pages/login.js, lib/useRequireAuth.js,
// components/SiteHeader.js, lib/personalization.js — jamais une route API, voir
// lib/supabaseAnon.js pour ça). Utilise @supabase/ssr plutôt que le createClient() brut
// de @supabase/supabase-js : la session est stockée dans des COOKIES (pas seulement le
// localStorage), lisibles aussi côté serveur via lib/supabaseServer.js — nécessaire
// pour qu'une future page protégée en SSR (Bloc 4) puisse reconnaître la personne
// connectée dès le premier rendu serveur, sans attendre l'hydratation.
//
// Une barre oblique finale ou un espace superflu dans NEXT_PUBLIC_SUPABASE_URL (ex :
// copié-collé depuis le dashboard Supabase) produit des requêtes vers un chemin
// mal formé ("https://xxx.supabase.co//auth/v1/signup") — Supabase répond alors
// "Invalid path specified in request URL", un message qui n'a rien à voir avec le
// formulaire lui-même. On normalise l'URL pour éviter cette classe de bug.
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
