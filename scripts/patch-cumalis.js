// Fixes a Cumalis Lisp 0.6.1 bug: (define (f . args) ...) failed with
// "A <pair> or <null> is expected." (define checked its parameters too strictly,
// while lambda accepts (lambda args ...)).
const fs = require('fs');
const path = require('path');
const dir = path.dirname(require.resolve('cumalis-lisp/package.json'));
const RE = /([\w$]\.Symbol\([\w$]\)),[\w$]\.List\([\w$]\),(![\w$]&&![\w$]\.Undefined\(null!=\([\w$]=[\w$]\([\w$]\([\w$]\)\.env\.static\))/;
for (const f of ['dist/index.esm.js', 'dist/index.cjs.js', 'dist/index.umd.js']) {
  const p = path.join(dir, f);
  const src = fs.readFileSync(p, 'utf8');
  if (RE.test(src)) { fs.writeFileSync(p, src.replace(RE, '$1,$2')); console.log('patched:', f); }
}

// Print records with their type name, like DrRacket: #<positional-list>
// instead of #<record>.
const RE2 = /default:return ([\w$])\?([\w$]):`#\$\{([\w$])\[0\]\}`/;
for (const f of ['dist/index.esm.js', 'dist/index.cjs.js', 'dist/index.umd.js']) {
  const p = path.join(dir, f);
  const src = fs.readFileSync(p, 'utf8');
  if (RE2.test(src)) {
    fs.writeFileSync(p, src.replace(RE2, (all, t, e, e2) =>
      `default:return ${t}?${e}:("<record>"===${e2}[0]&&${e2}[1]&&"string"==typeof ${e2}[1][1]?\`#<\${${e2}[1][1]}>\`:\`#\${${e2}[0]}\`)`));
    console.log('records patched:', f);
  }
}

// (/ x 0) returned an error object as a value instead of raising an error.
const RE3 = /return ([\w$])\.includes\(0\)\?([\w$]+)\.Error\("division-by-zero",null\):/;
for (const f of ['dist/index.esm.js', 'dist/index.cjs.js', 'dist/index.umd.js']) {
  const p = path.join(dir, f);
  const src = fs.readFileSync(p, 'utf8');
  if (RE3.test(src)) {
    fs.writeFileSync(p, src.replace(RE3, 'if($1.includes(0))throw $2.Error("division-by-zero",null);return '));
    console.log('division patched:', f);
  }
}
