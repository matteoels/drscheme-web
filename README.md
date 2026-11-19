# DrScheme Web

Un environnement Scheme dans le navigateur, inspiré de DrRacket : une fenêtre de **définitions** en haut, une fenêtre d'**interactions** en bas, et un bouton **Exécuter**.

Le site fonctionne entièrement dans le navigateur. Il n'y a ni serveur ni installation, et tes fichiers sont sauvegardés automatiquement dans le navigateur.

## Fonctionnalités

- **R7RS** : `define-library`, `import`, `define-record-type`, `call/cc`, `guard`, `syntax-rules`, `parameterize`, récursion terminale…
- **Fenêtre d'interactions** façon DrRacket : après « Exécuter », tes définitions restent disponibles pour les tester. Historique avec `Ctrl+↑` / `Ctrl+↓`.
- **Erreurs en français**, avec l'expression fautive surlignée en rose dans le code.
- **Bouton Arrêter** pour couper une boucle infinie (le programme tourne dans un Web Worker).
- **Onglets / plusieurs fichiers** pour tes ADT :
  - `(import (prefix (ma-lib) m:))` charge automatiquement l'onglet qui contient `(define-library (ma-lib) ...)` ;
  - `(include "pile.rkt")` et, en `#lang racket`, `(require "pile.rkt")` ;
  - les chemins façon JDoodle (`/uploads/pile.rkt`) marchent aussi, seul le nom du fichier compte.
- **`#lang racket`** (compatibilité partielle) : crochets `[ ]`, `first`, `rest`, `add1`, `filter`, `foldl`, `range`, `printf`, `displayln`…
- Coloration et indentation comme dans DrRacket, mise en évidence de l'expression entre parenthèses correspondantes, menu `(define ...)`, recherche/remplacement, réindentation (`Ctrl+I`), λ (`Ctrl+\`).
- Ouvrir / télécharger des fichiers `.rkt`, `.scm`.

## Limites

- Pas de fractions exactes (`(/ 1 3)` donne `0.333…`) ni de très grands entiers.
- Plus lent que DrRacket : environ 30 000 appels de fonction par seconde.
- Pas de débogueur ni de pas-à-pas des macros.

## Développement

```sh
npm install      # installe aussi le correctif du moteur (scripts/patch-cumalis.js)
npm run build    # génère dist/
python3 -m http.server   # puis ouvre http://localhost:8000
```

Le dossier `dist/` est versionné pour que GitHub Pages serve le site sans étape de build.

Moteur : [Cumalis Lisp](https://github.com/trb-a/cumalis-lisp) (R7RS-small), avec trois petits correctifs appliqués par `scripts/patch-cumalis.js`. Éditeur : [CodeMirror 5](https://codemirror.net/5/).

Projet indépendant, non affilié à Racket ni à DrRacket.
