// Worker: runs the R7RS interpreter (Cumalis Lisp) off the main page,
// so the Stop button can kill an infinite loop.
import { Buffer } from 'buffer';
self.Buffer = Buffer;
self.process = self.process || { env: {}, argv: [] };

import { Interpreter, create, isSuspendEnvelope, suspendValueFromEnvelope, writeObject } from 'cumalis-lisp';
import { blankLangLine, normalizeBrackets } from './reader.js';

let itrp = null;
let susp = null;
let files = {};

// ---------- Standard output (display, write, newline...) ----------
let outBuf = '';
let lastFlush = 0;
function flushOut() {
  if (outBuf) { postMessage({ type: 'out', text: outBuf }); outBuf = ''; }
  lastFlush = Date.now();
}
function writeOut(s) {
  outBuf += typeof s === 'string' ? s : Buffer.from(s).toString('utf8');
  if (outBuf.length > 8192 || Date.now() - lastFlush > 60) flushOut();
}

// ---------- Fake file system: the open tabs are the files ----------
function resolve(path) {
  if (Object.prototype.hasOwnProperty.call(files, path)) return path;
  const base = String(path).split(/[\\/]/).pop();
  if (Object.prototype.hasOwnProperty.call(files, base)) return base;
  return null;
}
const fds = new Map();
let nextFd = 10;
const fakeFs = {
  existsSync: (p) => resolve(p) !== null,
  // used by include and load: strip the #lang line and convert brackets
  readFileSync: (p) => {
    const k = resolve(p);
    if (k === null) throw new Error(`file not found: ${p} (open it in a tab first)`);
    return normalizeBrackets(blankLangLine(files[k]));
  },
  openSync: (p, mode) => {
    const fd = nextFd++;
    if (String(mode).startsWith('r')) {
      const k = resolve(p);
      if (k === null) throw new Error(`file not found: ${p} (open it in a tab first)`);
      fds.set(fd, { data: Buffer.from(files[k], 'utf8'), pos: 0 });
    } else {
      fds.set(fd, { name: String(p).split(/[\\/]/).pop(), chunks: [] });
    }
    return fd;
  },
  readSync: (fd, buf, opts) => {
    const f = fds.get(fd);
    if (!f || !f.data) return 0;
    const len = (opts && opts.length) || buf.length;
    const off = (opts && opts.offset) || 0;
    let k = 0;
    while (k < len && f.pos < f.data.length) { buf[off + k] = f.data[f.pos++]; k++; }
    return k;
  },
  writeSync: (fd, c) => {
    const f = fds.get(fd);
    if (f && f.chunks) f.chunks.push(typeof c === 'string' ? c : Buffer.from(c).toString('utf8'));
  },
  closeSync: (fd) => {
    const f = fds.get(fd);
    if (f && f.chunks) {
      files[f.name] = f.chunks.join('');
      postMessage({ type: 'file', name: f.name, content: files[f.name] });
    }
    fds.delete(fd);
  },
  fsyncSync: () => {},
  unlinkSync: (p) => {
    const k = resolve(p);
    if (k === null) throw new Error(`file not found: ${p}`);
    delete files[k];
  },
};

// ---------- Persistent evaluation loop ----------
// The Scheme program below runs forever: it pauses (suspend) waiting for an
// expression, evaluates it in the interaction environment and returns the result.
// Definitions therefore stay available in the interactions window.
const BOOT = `
(import (scheme base) (scheme eval) (scheme repl) (scheme write) (scheme read))
(define %env (interaction-environment))
(let loop ((msg (suspend "ready")))
  (loop
   (suspend
    (call/cc
     (lambda (k)
       (with-exception-handler
        (lambda (e) (k (list "error" e)))
        (lambda ()
          (let ((p (open-input-string msg)))
            (let rd ((x (read p)) (last (if #f #f)))
              (if (eof-object? x)
                  (list "ok" last)
                  (rd (read p) (eval x %env))))))))))))
`;

const STD_LIBS = ['(scheme base)', '(scheme write)', '(scheme read)', '(scheme char)', '(scheme cxr)',
  '(scheme inexact)', '(scheme case-lambda)', '(scheme lazy)', '(scheme eval)', '(scheme repl)',
  '(scheme file)', '(scheme time)', '(scheme load)'];

// A few Racket functions, only when the file starts with #lang racket.
const RACKET_COMPAT = `
(define (add1 n) (+ n 1))
(define (sub1 n) (- n 1))
(define first car) (define rest cdr)
(define (second l) (cadr l)) (define (third l) (caddr l))
(define (last l) (if (null? (cdr l)) (car l) (last (cdr l))))
(define empty '()) (define null '()) (define (empty? x) (null? x))
(define true #t) (define false #f)
(define pi 3.141592653589793)
(define (sqr x) (* x x))
(define (void . args) (if #f #f))
(define (identity x) x)
(define (displayln x . port) (apply display x port) (apply newline port))
(define (filter keep? l) (cond ((null? l) '()) ((keep? (car l)) (cons (car l) (filter keep? (cdr l)))) (else (filter keep? (cdr l)))))
(define (remove x l) (cond ((null? l) '()) ((equal? x (car l)) (cdr l)) (else (cons (car l) (remove x (cdr l))))))
(define (foldl f acc l) (if (null? l) acc (foldl f (f (car l) acc) (cdr l))))
(define (foldr f acc l) (if (null? l) acc (f (car l) (foldr f acc (cdr l)))))
(define (andmap f l) (or (null? l) (and (f (car l)) (andmap f (cdr l)))))
(define (ormap f l) (and (pair? l) (or (f (car l)) (ormap f (cdr l)))))
(define (count f l) (let loop ((l l) (n 0)) (if (null? l) n (loop (cdr l) (if (f (car l)) (+ n 1) n)))))
(define (build-list n f) (let loop ((i (- n 1)) (acc '())) (if (< i 0) acc (loop (- i 1) (cons (f i) acc)))))
(define (range a . more)
  (let* ((start (if (null? more) 0 a)) (end (if (null? more) a (car more)))
         (step (if (or (null? more) (null? (cdr more))) 1 (cadr more))))
    (let loop ((i start) (acc '()))
      (if (if (> step 0) (>= i end) (<= i end)) (reverse acc) (loop (+ i step) (cons i acc))))))
(define (string-join l . sep)
  (let ((s (if (null? sep) " " (car sep))))
    (if (null? l) "" (let loop ((l (cdr l)) (acc (car l))) (if (null? l) acc (loop (cdr l) (string-append acc s (car l))))))))
(define (format fmt . args)
  (let ((out (open-output-string)) (n (string-length fmt)))
    (let loop ((i 0) (args args))
      (cond ((>= i n) (get-output-string out))
            ((and (char=? (string-ref fmt i) #\\~) (< (+ i 1) n))
             (let ((c (char-downcase (string-ref fmt (+ i 1)))))
               (cond ((or (char=? c #\\n) (char=? c #\\%)) (newline out) (loop (+ i 2) args))
                     ((char=? c #\\~) (write-char #\\~ out) (loop (+ i 2) args))
                     ((char=? c #\\a) (display (car args) out) (loop (+ i 2) (cdr args)))
                     (else (write (car args) out) (loop (+ i 2) (cdr args))))))
            (else (write-char (string-ref fmt i) out) (loop (+ i 1) args))))))
(define (printf fmt . args) (display (apply format fmt args)))
`;

function step(fn) {
  try {
    fn();
    return { done: true };
  } catch (e) {
    if (isSuspendEnvelope(e)) {
      susp = e;
      return { value: suspendValueFromEnvelope(e) };
    }
    throw e;
  }
}

function send(src) {
  const saved = susp;
  let r;
  try {
    r = step(() => itrp.resume(susp, create.String(src)));
  } catch (e) {
    // JavaScript error (e.g. stack too deep): go back to the previous state.
    susp = saved;
    let msg = (e && e.message) || String(e);
    if (/stack/i.test(msg)) msg = 'stack overflow: recursion too deep (or infinite?)';
    return { ok: false, error: msg };
  }
  if (r.done) return { ok: false, error: 'the session ended (exit?). Click Run.' };
  const parts = listItems(r.value);
  const tag = parts[0] && parts[0][1];
  if (tag === 'ok') return { ok: true, value: show(parts[1]) };
  if (tag === 'error') return { ok: false, error: errorMessage(parts[1]) };
  return { ok: false, error: 'unexpected response from the interpreter' };
}

function listItems(obj) {
  const out = [];
  while (Array.isArray(obj) && obj[0] === '<pair>') { out.push(obj[1]); obj = obj[2]; }
  return out;
}
function show(obj) {
  try { return writeObject(obj); } catch { return '#<?>'; }
}

// Engine error messages, rewritten to read more like DrRacket's.
const TRANSLATIONS = [
  [/^(.+) is not defined\.$/, (m) => `${m[1]}: undefined;\n cannot reference an identifier before its definition`],
  [/^A <([\w-]+)> or <([\w-]+)> is expected\.$/, (m) => `contract violation\n  expected: ${m[1]}? or ${m[2]}?`],
  [/^A <([\w-]+)> is expected\.$/, (m) => `contract violation\n  expected: ${m[1]}?`],
  [/^An array of <([\w-]+)> is expected\.$/, (m) => `contract violation\n  expected: all arguments to be ${m[1]}?`],
  [/^Length of arguments does not match the length of parameters\.$/, () => 'arity mismatch: wrong number of arguments (or a badly formed special form)'],
  [/^Operator is not a valid procedure\.$/, () => 'application: not a procedure;\n expected a procedure that can be applied to arguments'],
  [/^Index is out of range\.$/, () => 'index is out of range'],
  [/^The specified string doesn't have character with index (\d+)\.$/, (m) => `string-ref: index is out of range\n  index: ${m[1]}`],
  [/^Specified list is shorter than specified number (\d+)$/, (m) => `list-ref: index too large for list\n  index: ${m[1]}`],
];
function translate(msg) {
  for (const [re, f] of TRANSLATIONS) { const m = re.exec(msg); if (m) return f(m); }
  return msg;
}
function errorMessage(e) {
  if (Array.isArray(e) && e[0] === '<error>') {
    const [, type, message, irritants] = e;
    const irr = (irritants || []).map(show).join(' ');
    if (type === 'division-by-zero') return '/: division by zero';
    if (type === 'redefine-variable') return 'define: cannot redefine this variable here';
    let msg = message == null ? String(type).replace(/-/g, ' ') : String(message);
    if (type !== 'error') msg = translate(msg);
    return irr ? `${msg} ${irr}` : msg;
  }
  return `uncaught exception: ${show(e)}`;
}

function init(opts) {
  files = Object.assign({}, opts.files || {});
  itrp = new Interpreter({ stack: 1000000, fs: fakeFs });
  itrp.builtins.port['//output'].write = writeOut;
  itrp.builtins.port['//error'].write = writeOut;
  step(() => itrp.eval(BOOT));
  for (const lib of STD_LIBS) send(`(import ${lib})`);
  // R5RS names still widely used in courses (available in DrRacket and Gauche).
  send('(define (exact->inexact x) (inexact x)) (define (inexact->exact x) (exact x))');
  if (opts.lang === 'racket') send(RACKET_COMPAT);
}

self.onmessage = (ev) => {
  const m = ev.data;
  try {
    if (m.type === 'init') {
      init(m);
      postMessage({ type: 'ready', id: m.id });
    } else if (m.type === 'eval') {
      if (m.files) Object.assign(files, m.files);
      const res = send(m.src);
      flushOut();
      postMessage(Object.assign({ type: 'result', id: m.id }, res));
    }
  } catch (e) {
    flushOut();
    postMessage({ type: 'result', id: m.id, ok: false, error: (e && e.message) || String(e) });
  }
};
