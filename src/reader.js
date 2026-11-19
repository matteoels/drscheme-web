// Petit lecteur Scheme : sert à découper le programme en formes de haut niveau,
// à vérifier les parenthèses et à analyser (import ...), (require ...), etc.
// Il ne fait pas l'évaluation : c'est l'interpréteur (dans le worker) qui s'en charge.

const OPEN = { '(': ')', '[': ']', '{': '}' };
const CLOSE = { ')': '(', ']': '[', '}': '{' };
const DELIM = /[\s()\[\]{}";]/;

export class ReadError extends Error {
  constructor(message, pos, end) {
    super(message);
    this.pos = pos;
    this.end = end ?? pos + 1;
  }
}

// Remplace la ligne #lang (ou #!) par des espaces : la taille du texte ne change pas,
// donc les positions restent valables pour surligner les erreurs dans l'éditeur.
export function detectLang(text) {
  const m = /^[ \t\r\n]*(?:;[^\n]*\n[ \t\r\n]*)*#lang[ \t]+([^\s]+)/.exec(text);
  return m ? m[1] : null;
}

export function blankLangLine(text) {
  return text.replace(/^([ \t\r\n]*(?:;[^\n]*\n[ \t\r\n]*)*)(#lang[^\n]*|#!(?!fold-case|no-fold-case)[^\n]*)/, (all, pre, line) => pre + ' '.repeat(line.length));
}

// Transforme [ ] { } en ( ) en dehors des chaînes, caractères et commentaires
// (Racket accepte les crochets, l'interpréteur R7RS non). Même longueur de texte.
export function normalizeBrackets(text) {
  const out = text.split('');
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === ';') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '"') {
      i++;
      while (i < n && text[i] !== '"') { if (text[i] === '\\') i++; i++; }
      i++; continue;
    }
    if (c === '|') { i++; while (i < n && text[i] !== '|') i++; i++; continue; }
    if (c === '#' && text[i + 1] === '|') {
      let depth = 1; i += 2;
      while (i < n && depth > 0) {
        if (text[i] === '|' && text[i + 1] === '#') { depth--; i += 2; }
        else if (text[i] === '#' && text[i + 1] === '|') { depth++; i += 2; }
        else i++;
      }
      continue;
    }
    if (c === '#' && text[i + 1] === '\\') { i += 3; while (i < n && !DELIM.test(text[i])) i++; continue; }
    if (c === '[' || c === '{') out[i] = '(';
    else if (c === ']' || c === '}') out[i] = ')';
    i++;
  }
  return out.join('');
}

// Lit tout le texte et renvoie la liste des formes de haut niveau.
// Chaque nœud : { type: 'list'|'vector'|'sym'|'str'|'num'|'other', start, end, items?, value? }
export function readAll(text) {
  const src = blankLangLine(text);
  const n = src.length;
  let i = 0;

  function skipWS() {
    for (;;) {
      while (i < n && /\s/.test(src[i])) i++;
      if (i >= n) return;
      if (src[i] === ';') { while (i < n && src[i] !== '\n') i++; continue; }
      if (src[i] === '#' && src[i + 1] === '|') {
        const start = i;
        let depth = 1; i += 2;
        while (i < n && depth > 0) {
          if (src[i] === '|' && src[i + 1] === '#') { depth--; i += 2; }
          else if (src[i] === '#' && src[i + 1] === '|') { depth++; i += 2; }
          else i++;
        }
        if (depth > 0) throw new ReadError('commentaire #| ... |# non fermé', start, start + 2);
        continue;
      }
      if (src[i] === '#' && src[i + 1] === ';') {
        const start = i;
        i += 2; skipWS();
        if (i >= n) throw new ReadError('#; doit être suivi d\'une expression', start, start + 2);
        readDatum();
        continue;
      }
      return;
    }
  }

  function readSeq(start, openCh, type) {
    const items = [];
    for (;;) {
      skipWS();
      if (i >= n) throw new ReadError(`parenthèse « ${openCh} » jamais fermée`, start, start + 1);
      const c = src[i];
      if (CLOSE[c]) {
        if (CLOSE[c] !== openCh) {
          throw new ReadError(`« ${c} » ne correspond pas à « ${openCh} » ouvert plus tôt`, i, i + 1);
        }
        i++;
        return { type, start, end: i, items };
      }
      items.push(readDatum());
    }
  }

  function readDatum() {
    const start = i;
    const c = src[i];
    if (c === "'" || c === '`' || c === ',') {
      i += (c === ',' && src[i + 1] === '@') ? 2 : 1;
      skipWS();
      if (i >= n) throw new ReadError(`« ${c} » doit être suivi d'une expression`, start, start + 1);
      const d = readDatum();
      return { type: 'quote', start, end: d.end, items: [d] };
    }
    if (OPEN[c]) { i++; return readSeq(start, c, 'list'); }
    if (CLOSE[c]) throw new ReadError(`« ${c} » en trop (aucune parenthèse ouverte ne lui correspond)`, i, i + 1);
    if (c === '"') {
      i++;
      let value = '';
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\') { value += src[i + 1] ?? ''; i += 2; } else { value += src[i]; i++; }
      }
      if (i >= n) throw new ReadError('chaîne de caractères jamais fermée (il manque un ")', start, start + 1);
      i++;
      return { type: 'str', start, end: i, value };
    }
    if (c === '#') {
      if (src[i + 1] === '(') { i += 2; return readSeq(start, '(', 'vector'); }
      if (src.startsWith('#u8(', i)) { i += 4; return readSeq(start, '(', 'vector'); }
      if (src[i + 1] === '\\') { i += 3; while (i < n && !DELIM.test(src[i])) i++; return { type: 'other', start, end: i }; }
    }
    if (c === '|') {
      i++;
      while (i < n && src[i] !== '|') i++;
      if (i >= n) throw new ReadError('symbole |...| jamais fermé', start, start + 1);
      i++;
      return { type: 'sym', start, end: i, value: src.slice(start + 1, i - 1) };
    }
    while (i < n && !DELIM.test(src[i])) i++;
    const tok = src.slice(start, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(tok) || /^[+-]?\d+\/\d+$/.test(tok)) return { type: 'num', start, end: i, value: tok };
    if (tok[0] === '#') return { type: 'other', start, end: i, value: tok };
    return { type: 'sym', start, end: i, value: tok };
  }

  const forms = [];
  for (;;) {
    skipWS();
    if (i >= n) break;
    forms.push(readDatum());
  }
  return forms;
}

export function headOf(node) {
  if (node && node.type === 'list' && node.items.length && node.items[0].type === 'sym') return node.items[0].value;
  return null;
}

// (import (prefix (foo bar) p:) (only (baz) x)) -> ["foo bar", "baz"]
export function importedLibraries(importNode) {
  const names = [];
  const visit = (set) => {
    if (!set || set.type !== 'list' || !set.items.length) return;
    const h = headOf(set);
    if (['only', 'except', 'prefix', 'rename'].includes(h) && set.items[1] && set.items[1].type === 'list') {
      visit(set.items[1]);
      return;
    }
    if (set.items.every(x => x.type === 'sym' || x.type === 'num')) names.push(set.items.map(x => x.value).join(' '));
  };
  importNode.items.slice(1).forEach(visit);
  return names;
}

export function libraryName(defLibNode) {
  const spec = defLibNode.items[1];
  if (!spec || spec.type !== 'list') return null;
  return spec.items.map(x => x.value).join(' ');
}
