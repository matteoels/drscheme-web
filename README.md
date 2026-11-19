# DrScheme Web

A Scheme environment in your browser, inspired by DrRacket: a **definitions** window on top, an **interactions** window below, and a **Run** button. Dark mode is on by default, with a light theme one click away.

**Live:** https://matteoels.github.io/drscheme-web/

Everything runs in the browser: there is no server and nothing to install. Your files are saved automatically in the browser.

## Features

- **R7RS**: `define-library`, `import`, `define-record-type`, `call/cc`, `guard`, `syntax-rules`, `parameterize`, proper tail calls…
- **DrRacket-style interactions**: after Run, your definitions stay available to try out. History with `Ctrl+↑` / `Ctrl+↓`.
- **Clear error messages**, with the offending expression highlighted in the editor.
- **Stop button** that kills infinite loops (the program runs in a Web Worker).
- **Tabs / multiple files** for your ADTs:
  - `(import (prefix (my-lib) m:))` automatically loads the tab that contains `(define-library (my-lib) ...)`;
  - `(include "stack.rkt")`, and in `#lang racket`, `(require "stack.rkt")`;
  - JDoodle-style paths (`/uploads/stack.rkt`) work too, since only the file name matters.
- **`#lang racket`** (partial compatibility): `[ ]` brackets, `first`, `rest`, `add1`, `filter`, `foldl`, `range`, `printf`, `displayln`…
- DrRacket-like syntax colouring and indentation, matching-expression shading, the `(define ...)` menu, find/replace, reindent (`Ctrl+I`) and λ (`Ctrl+\`).
- Dark / light themes, and a layout that works on phones.
- Open and download `.rkt` / `.scm` files.

## Limitations

- No exact fractions (`(/ 1 3)` gives `0.333…`) and no big integers.
- Slower than DrRacket: roughly 30,000 function calls per second.
- No debugger or macro stepper.

## Development

```sh
npm install      # also applies the engine patches (scripts/patch-cumalis.js)
npm run build    # builds dist/
python3 -m http.server   # then open http://localhost:8000
```

`dist/` is committed so GitHub Pages can serve the site without a build step.

Engine: [Cumalis Lisp](https://github.com/trb-a/cumalis-lisp) (R7RS-small), with three small fixes applied by `scripts/patch-cumalis.js`. Editor: [CodeMirror 5](https://codemirror.net/5/).

Independent project, not affiliated with Racket or DrRacket.
