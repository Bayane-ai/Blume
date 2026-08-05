/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Verrouillage "propriétaire unique" (2026) — en-têtes de sécurité appliqués à
  // TOUTES les réponses : empêche l'intégration du site dans un <iframe> tiers
  // (clickjacking) et quelques durcissements standards sans effet sur le
  // fonctionnement normal du site.
  // L'onglet "Matchs du jour" a été fusionné dans "Matchs à venir" : l'ancienne URL
  // reste valide et redirige définitivement, pour ne laisser aucun lien mort (favori,
  // lien partagé, résultat de moteur de recherche).
  async redirects() {
    return [{ source: "/matchs-du-jour", destination: "/a-venir", permanent: true }];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Bloque totalement l'intégration en iframe (aucun site n'a besoin
          // d'englober Blume dans un cadre) — X-Frame-Options pour les navigateurs
          // plus anciens, frame-ancestors (CSP) pour les navigateurs modernes.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
