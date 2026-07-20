import "@testing-library/jest-dom";

// lib/supabaseClient.js appelle createClient(url, key) au chargement du module, qui
// lève une exception si l'URL est vide — ce qui casserait TOUT test import(ant),
// même transitivement, ce module sans le mocker explicitement (ex : pages/api/analyze.js
// via lib/pronosticHistory.js). Des valeurs factices suffisent : aucun test ne doit
// réellement atteindre le réseau Supabase (les fonctions qui écrivent/lisent des
// données avalent déjà toute erreur réseau sans jamais faire planter l'appelant).
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "test-anon-key";
