// Corrige un bug de Cumalis Lisp 0.6.1 : (define (f . args) ...) plantait
// avec « A <pair> or <null> is expected. » (vérification de liste trop stricte
// sur les paramètres de define, alors que lambda accepte (lambda args ...)).
const fs = require('fs');
const path = require('path');
const dir = path.dirname(require.resolve('cumalis-lisp/package.json'));
const RE = /([\w$]\.Symbol\([\w$]\)),[\w$]\.List\([\w$]\),(![\w$]&&![\w$]\.Undefined\(null!=\([\w$]=[\w$]\([\w$]\([\w$]\)\.env\.static\))/;
for (const f of ['dist/index.esm.js', 'dist/index.cjs.js', 'dist/index.umd.js']) {
  const p = path.join(dir, f);
  const src = fs.readFileSync(p, 'utf8');
  if (RE.test(src)) { fs.writeFileSync(p, src.replace(RE, '$1,$2')); console.log('patché :', f); }
}

// Affiche les records avec le nom de leur type, comme DrRacket : #<positional-list>
// au lieu de #<record>.
const RE2 = /default:return ([\w$])\?([\w$]):`#\$\{([\w$])\[0\]\}`/;
for (const f of ['dist/index.esm.js', 'dist/index.cjs.js', 'dist/index.umd.js']) {
  const p = path.join(dir, f);
  const src = fs.readFileSync(p, 'utf8');
  if (RE2.test(src)) {
    fs.writeFileSync(p, src.replace(RE2, (all, t, e, e2) =>
      `default:return ${t}?${e}:("<record>"===${e2}[0]&&${e2}[1]&&"string"==typeof ${e2}[1][1]?\`#<\${${e2}[1][1]}>\`:\`#\${${e2}[0]}\`)`));
    console.log('records patchés :', f);
  }
}

// (/ x 0) renvoyait un objet erreur comme valeur au lieu de lever une erreur.
const RE3 = /return ([\w$])\.includes\(0\)\?([\w$]+)\.Error\("division-by-zero",null\):/;
for (const f of ['dist/index.esm.js', 'dist/index.cjs.js', 'dist/index.umd.js']) {
  const p = path.join(dir, f);
  const src = fs.readFileSync(p, 'utf8');
  if (RE3.test(src)) {
    fs.writeFileSync(p, src.replace(RE3, 'if($1.includes(0))throw $2.Error("division-by-zero",null);return '));
    console.log('division patchée :', f);
  }
}
