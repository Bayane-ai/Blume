import { Html, Head, Main, NextScript } from "next/document";
import { THEME_NO_FLASH_SCRIPT } from "../lib/prefsCookie";

// Document custom SANS getInitialProps (volontairement — un getInitialProps ici
// désactiverait l'optimisation statique automatique de TOUTES les pages du site,
// voir la documentation Next.js) : seul un <script> synchrone, exécuté par le
// navigateur avant la première peinture de la page, pose data-theme sur <html> à
// partir du cookie blume_prefs (voir PROMPT Partie 2, "applique ces préférences
// avant le premier rendu pour éviter tout clignotement"). Sans thème choisi
// (cookie absent ou navigateur sans JavaScript), le site reste sombre par défaut —
// exactement le comportement actuel, inchangé.
export default function Document() {
  return (
    <Html>
      <Head>
        <script dangerouslySetInnerHTML={{ __html: THEME_NO_FLASH_SCRIPT }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
