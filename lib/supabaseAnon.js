import { createClient } from '@supabase/supabase-js';

// Client Supabase "anonyme" pour le code qui tourne UNIQUEMENT côté serveur (routes
// API Next.js, jamais un composant React) et qui n'a besoin d'aucune identité
// utilisateur : lib/pronosticHistory.js et lib/comboHistory.js, tous deux réservés
// aux tables "ouvertes" (RLS using(true) — voir supabase/migrations/0002 et 0004),
// jamais aux données personnelles d'un compte. Un simple createClient() suffit : pas
// de session à gérer (les données personnelles, elles, passent par
// lib/supabaseAdmin.js — clé service_role, filtrage par profile_id côté serveur, voir
// supabase/migrations/0008_custom_auth.sql).
//
// Une barre oblique finale ou un espace superflu dans NEXT_PUBLIC_SUPABASE_URL (ex :
// copié-collé depuis le dashboard Supabase) produit des requêtes vers un chemin
// mal formé ("https://xxx.supabase.co//auth/v1/signup") — Supabase répond alors
// "Invalid path specified in request URL", un message qui n'a rien à voir avec le
// formulaire lui-même. On normalise l'URL pour éviter cette classe de bug.
const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

export const supabaseAnon = createClient(supabaseUrl, supabaseAnonKey);
