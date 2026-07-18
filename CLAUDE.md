# Blume — instructions pour Claude

Site Next.js (Pages Router) de matchs de foot en direct/à venir avec pronostics automatiques
(modèle de Poisson basé sur les classements football-data.org). Déployé sur Vercel, branché
sur la branche `main` du repo GitHub `Bayane-ai/Blume`.

## Workflow de mise à jour (important)

L'utilisateur a demandé (18/07/2026) d'automatiser les mises à jour : après chaque
modification demandée, ne pas attendre de confirmation supplémentaire avant de déployer.
Concrètement, pour chaque changement :

1. Faire la modification.
2. Vérifier avec `npm run build` (utiliser des variables d'env factices si besoin :
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
3. Tester le rendu réel si le changement touche l'UI (dev server + captures), en mockant
   temporairement `pages/api/matches.js` / `pages/api/analyze.js` si besoin (pas de clé
   `FOOTBALL_DATA_TOKEN` disponible dans cet environnement), puis restaurer les fichiers réels.
4. Committer et pousser directement sur `main` (fast-forward depuis la branche de travail,
   via `git push origin <branche>:main`) pour que Vercel redéploie automatiquement —
   sans redemander la permission à chaque fois.

Ne pas demander "veux-tu que je pousse sur main ?" à chaque fois : le faire directement,
sauf si le changement est risqué/destructif (ex : suppression de données, migration DB).
