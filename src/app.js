import CodeMirror from 'codemirror';
import 'codemirror/mode/scheme/scheme.js';
import 'codemirror/addon/edit/matchbrackets.js';
import 'codemirror/addon/search/search.js';
import 'codemirror/addon/search/searchcursor.js';
import 'codemirror/addon/search/jump-to-line.js';
import 'codemirror/addon/dialog/dialog.js';
import 'codemirror/addon/comment/comment.js';
import 'codemirror/addon/selection/active-line.js';
import { readAll, ReadError, detectLang, normalizeBrackets, blankLangLine, headOf, importedLibraries, libraryName } from './reader.js';

const VERSION = '1.0';
const KEY = 'drscheme-web:v1';
const $ = (sel) => document.querySelector(sel);
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? 'Cmd' : 'Ctrl';
const modLabel = (k) => (isMac ? '⌘' : 'Ctrl+') + k;

const DEFAULT_PROGRAM = `#lang r7rs
;; Welcome to DrScheme Web!
;; Write your program here, then click "Run" (${modLabel('R')}).
;; You can then try out your functions in the interactions window.

(define (square x)
  (* x x))

(define (factorial n)
  (if (= n 0)
      1
      (* n (factorial (- n 1)))))

(display "Hello!")
(newline)
(square 12)
(factorial 10)
`;

// ======================================================================
// State (saved in the browser)
// ======================================================================
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.tabs) && s.tabs.length) return s;
  } catch { /* corrupted state: start from scratch */ }
  return null;
}
const saved = loadState();
const prefs = Object.assign({
  theme: 'dark', langMode: 'auto', dock: 'right', lineNumbers: true, fontSize: 14, splitH: 0.56, splitV: 0.6,
  showDefs: true, showInter: true,
}, saved ? saved.prefs : {});

const tabs = (saved ? saved.tabs : [{ name: 'untitled.rkt', content: DEFAULT_PROGRAM }]).map((t) => ({
  name: t.name,
  doc: CodeMirror.Doc(t.content, 'scheme'),
  marks: [],
}));
let active = Math.min(saved ? saved.active || 0 : 0, tabs.length - 1);

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        tabs: tabs.map((t) => ({ name: t.name, content: t.doc.getValue() })),
        active, prefs,
      }));
    } catch { /* storage full or disabled */ }
  }, 300);
}

// ======================================================================
// Definitions editor
// ======================================================================
const defs = CodeMirror($('#defs'), {
  value: tabs[active].doc,
  mode: 'scheme',
  lineNumbers: prefs.lineNumbers,
  matchBrackets: true,
  indentUnit: 2,
  tabSize: 2,
  smartIndent: true,
  styleActiveLine: false,
  extraKeys: {
    Tab: (cm) => { cm.somethingSelected() ? cm.indentSelection('smart') : cm.indentLine(cm.getCursor().line, 'smart'); },
    'Ctrl-\\': (cm) => cm.replaceSelection('λ'),
    'Cmd-\\': (cm) => cm.replaceSelection('λ'),
    'Ctrl-;': (cm) => cm.toggleComment(),
    'Cmd-;': (cm) => cm.toggleComment(),
  },
});
defs.swapDoc(tabs[active].doc);

// Shades the whole expression between matching parentheses (like DrRacket).
function installSexpHighlight(cm) {
  let mark = null;
  cm.on('cursorActivity', () => {
    if (mark) { mark.clear(); mark = null; }
    if (cm.somethingSelected()) return;
    const m = cm.findMatchingBracket(cm.getCursor());
    if (!m || !m.match) return;
    const a = m.forward ? m.from : m.to;
    const b = m.forward ? m.to : m.from;
    mark = cm.markText(a, { line: b.line, ch: b.ch + 1 }, { className: 'cm-sexp' });
  });
}
installSexpHighlight(defs);

defs.on('change', () => {
  clearErrorMarks();
  updateTabs();
  persist();
});
defs.on('cursorActivity', () => {
  const c = defs.getCursor();
  $('#pos').textContent = `${c.line + 1}:${c.ch}`;
});

// ======================================================================
// Interactions window
// ======================================================================
const log = $('#log');
const MAX_LOG = 300000;
let lastOut = null;

function appendLog(text, cls) {
  if (!text) return;
  if (cls === 'out' && lastOut && lastOut.parentNode === log && log.lastChild === lastOut) {
    lastOut.textContent += text;
  } else {
    const span = document.createElement('span');
    span.className = cls;
    span.textContent = text;
    log.appendChild(span);
    lastOut = cls === 'out' ? span : null;
  }
  trimLog();
  scrollInteractions();
}
function appendLine(text, cls) {
  ensureNewline();
  appendLog(text + '\n', cls);
}
function ensureNewline() {
  const t = log.textContent;
  if (t.length && !t.endsWith('\n')) appendLog('\n', 'out');
}
function trimLog() {
  let total = log.textContent.length;
  while (total > MAX_LOG && log.firstChild) {
    total -= log.firstChild.textContent.length;
    log.removeChild(log.firstChild);
  }
}
function scrollInteractions() {
  const inter = $('#inter');
  inter.scrollTop = inter.scrollHeight;
}
function appendError(msg) {
  ensureNewline();
  const div = document.createElement('span');
  div.className = 'err';
  div.innerHTML = '<svg class="bug" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="9" r="4.2"/><circle cx="8" cy="4.2" r="2.2"/><path d="M2 6l3 2M14 6l-3 2M2 13l3-2M14 13l-3-2" stroke="currentColor" stroke-width="1.3"/></svg>';
  div.appendChild(document.createTextNode(msg + '\n'));
  log.appendChild(div);
  lastOut = null;
  scrollInteractions();
}

const input = CodeMirror($('#input'), {
  mode: 'scheme',
  matchBrackets: true,
  indentUnit: 2,
  lineWrapping: true,
  viewportMargin: Infinity,
  extraKeys: {
    Enter: (cm) => submitInteraction(cm),
    'Shift-Enter': (cm) => cm.execCommand('newlineAndIndent'),
    'Ctrl-Up': () => historyMove(-1),
    'Ctrl-Down': () => historyMove(1),
    'Alt-P': () => historyMove(-1),
    'Alt-N': () => historyMove(1),
    Tab: (cm) => cm.indentLine(cm.getCursor().line, 'smart'),
  },
});
installSexpHighlight(input);
$('#inter').addEventListener('mousedown', (e) => {
  if (e.target.closest('#log') && window.getSelection().toString()) return;
  if (!e.target.closest('.CodeMirror')) setTimeout(() => input.focus(), 0);
});

const history = [];
let histPos = 0;
function historyMove(d) {
  if (!history.length) return;
  histPos = Math.max(0, Math.min(history.length, histPos + d));
  input.setValue(history[histPos] ?? '');
  input.setCursor(input.lineCount(), 0);
}

function isIncomplete(text) {
  try { readAll(text); return false; } catch (e) {
    return e instanceof ReadError && /unclosed|unterminated|must be followed/.test(e.message);
  }
}

async function submitInteraction(cm) {
  const text = cm.getValue();
  const cur = cm.getCursor();
  const atEnd = cur.line === cm.lastLine() && cur.ch === cm.getLine(cur.line).length;
  if (isIncomplete(text) || !atEnd) { cm.execCommand('newlineAndIndent'); return; }
  if (busy) return;
  cm.setValue('');
  ensureNewline();
  appendLog('> ', 'prompt-echo');
  appendLog(text + '\n', 'echo');
  if (!text.trim()) return;
  history.push(text);
  histPos = history.length;
  await runInteraction(text);
}

// ======================================================================
// Execution session (worker)
// ======================================================================
class Session {
  constructor(lang) {
    this.lang = lang;
    this.worker = new Worker('dist/worker.js');
    this.pending = new Map();
    this.nextId = 1;
    this.dead = false;
    this.worker.onmessage = (ev) => this.onMessage(ev.data);
    this.worker.onerror = (ev) => {
      appendError('Internal engine error: ' + (ev.message || 'unknown'));
      this.failAll();
    };
  }
  onMessage(m) {
    if (m.type === 'out') { appendLog(m.text, 'out'); return; }
    if (m.type === 'file') { receiveFileFromProgram(m.name, m.content); return; }
    const p = this.pending.get(m.id);
    if (p) { this.pending.delete(m.id); p(m); }
  }
  call(msg) {
    if (this.dead) return Promise.resolve({ ok: false, error: 'session stopped', stopped: true });
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage(Object.assign({ id }, msg));
    });
  }
  init(files) { return this.call({ type: 'init', lang: this.lang, files }); }
  eval(src, files) { return this.call({ type: 'eval', src, files }); }
  failAll() {
    for (const p of this.pending.values()) p({ ok: false, error: 'session stopped', stopped: true });
    this.pending.clear();
  }
  kill() {
    this.dead = true;
    this.worker.terminate();
    this.failAll();
  }
}

let session = null;
let busy = false;
let runToken = 0;

function filesSnapshot() {
  const f = {};
  for (const t of tabs) f[t.name] = t.doc.getValue();
  return f;
}

function effectiveLang(text) {
  if (prefs.langMode === 'r7rs') return 'r7rs';
  if (prefs.langMode === 'racket') return 'racket';
  const l = detectLang(text);
  return l && /^racket|^typed\/racket/.test(l) ? 'racket' : 'r7rs';
}
function langLabel(lang) {
  return lang === 'racket' ? 'racket (partial compatibility, R7RS engine)' : 'r7rs';
}

function setBusy(b) {
  busy = b;
  document.body.classList.toggle('running', b);
  $('#run-indicator').title = b ? 'Program running' : 'Idle';
  $('#status-msg').textContent = b ? 'Running…' : '';
  input.setOption('readOnly', b ? 'nocursor' : false);
}

async function newSession(lang) {
  if (session) session.kill();
  session = new Session(lang);
  await session.init(filesSnapshot());
  return session;
}

function printBanner(lang) {
  log.textContent = '';
  lastOut = null;
  appendLog(`Welcome to DrScheme Web, version ${VERSION} [cumalis].\n`, 'banner');
  const span = document.createElement('span');
  span.className = 'banner';
  span.innerHTML = `Language: <b>${langLabel(lang)}</b>; memory: your browser's.\n`;
  log.appendChild(span);
}

// ---------- Running a top-level form ----------
function tabByName(name) {
  const base = String(name).split(/[\\/]/).pop();
  return tabs.find((t) => t.name === name) || tabs.find((t) => t.name === base) || null;
}

function libraryIndex() {
  const idx = {};
  for (const t of tabs) {
    let forms;
    try { forms = readAll(t.doc.getValue()); } catch { continue; }
    for (const f of forms) {
      if (headOf(f) === 'define-library') {
        const n = libraryName(f);
        if (n) idx[n] = t;
      }
    }
  }
  return idx;
}

// ctx : { token, loading:Set, libIdx, autoLoaded:Set }
async function runForm(node, text, tab, ctx) {
  if (ctx.token !== runToken) return false;
  const head = headOf(node);
  const src = normalizeBrackets(text.slice(node.start, node.end));

  if (head === 'provide') return true;
  if (head === 'module+') return true;
  if (head === 'require') {
    for (const arg of node.items.slice(1)) {
      if (arg.type === 'str') {
        if (!(await loadFile(arg.value, ctx, 'require'))) return false;
      }
      // (require racket/list) etc.: ignored, those functions come from the Racket compatibility layer
    }
    return true;
  }

  let res = await session.eval(src, ctx.interactive ? filesSnapshot() : undefined);
  if (res.stopped || ctx.token !== runToken) return false;

  if (!res.ok && head === 'import') {
    // Library not found? If a tab defines it, load that tab and try again.
    const missing = importedLibraries(node).filter((n) => ctx.libIdx[n] && !ctx.autoLoaded.has(n));
    if (missing.length) {
      for (const n of missing) {
        ctx.autoLoaded.add(n);
        if (!(await loadFile(ctx.libIdx[n].name, ctx, 'import'))) return false;
      }
      res = await session.eval(src);
      if (res.stopped || ctx.token !== runToken) return false;
    }
  }

  if (res.ok) {
    if (res.value !== '#<undefined>' && !/^#<undefined>/.test(res.value)) {
      ensureNewline();
      appendLog(res.value + '\n', 'value');
    }
    return true;
  }
  appendError(res.error);
  if (tab) markError(tab, node.start, node.end);
  return false;
}

async function loadFile(name, ctx, who) {
  const tab = tabByName(name);
  if (!tab) {
    appendError(`${who}: cannot find file "${name}". Open it in a tab first (File > Open…).`);
    return false;
  }
  if (ctx.loading.has(tab.name)) return true;
  ctx.loading.add(tab.name);
  const text = tab.doc.getValue();
  let forms;
  try { forms = readAll(text); } catch (e) {
    appendError(`${tab.name} : ${e.message}`);
    markError(tab, e.pos, e.end);
    return false;
  }
  for (const f of forms) {
    if (!(await runForm(f, text, tab, ctx))) return false;
  }
  return true;
}

async function run() {
  const token = ++runToken;
  const tab = tabs[active];
  const text = tab.doc.getValue();
  clearErrorMarks();
  persist();
  const lang = effectiveLang(text);
  printBanner(lang);
  setBusy(true);
  let forms;
  try {
    forms = readAll(text);
  } catch (e) {
    appendError(`${tab.name}:${posLabel(tab, e.pos)} : ${e.message}`);
    markError(tab, e.pos, e.end);
    await newSession(lang);
    if (token === runToken) setBusy(false);
    return;
  }
  await newSession(lang);
  if (token !== runToken) return;
  const ctx = { token, loading: new Set([tab.name]), libIdx: libraryIndex(), autoLoaded: new Set() };
  for (const f of forms) {
    if (!(await runForm(f, text, tab, ctx))) break;
  }
  if (token === runToken) { setBusy(false); input.focus(); }
}

async function runInteraction(text) {
  if (!session) await newSession(effectiveLang(tabs[active].doc.getValue()));
  const token = ++runToken;
  setBusy(true);
  let forms;
  try { forms = readAll(text); } catch (e) {
    appendError(e.message);
    setBusy(false);
    return;
  }
  const ctx = { token, interactive: true, loading: new Set(), libIdx: libraryIndex(), autoLoaded: new Set() };
  for (const f of forms) {
    if (!(await runForm(f, text, null, ctx))) break;
  }
  if (token === runToken) { setBusy(false); input.focus(); }
}

function stop() {
  if (!busy) return;
  runToken++;
  const lang = session ? session.lang : 'r7rs';
  if (session) session.kill();
  session = null;
  appendError('user break. The environment was reset: click "Run" to reload your definitions.');
  setBusy(false);
  newSession(lang);
}

function receiveFileFromProgram(name, content) {
  const t = tabByName(name);
  if (t) t.doc.setValue(content);
  else tabs.push({ name, doc: CodeMirror.Doc(content, 'scheme'), marks: [] });
  updateTabs();
  persist();
}

// ---------- Marking errors in the editor ----------
function posLabel(tab, offset) {
  const p = tab.doc.posFromIndex(offset);
  return `${p.line + 1}:${p.ch}`;
}
function markError(tab, start, end) {
  const idx = tabs.indexOf(tab);
  if (idx !== active) switchTab(idx);
  const from = tab.doc.posFromIndex(start);
  const to = tab.doc.posFromIndex(end);
  tab.marks.push(tab.doc.markText(from, to, { className: 'cm-error-mark' }));
  defs.scrollIntoView({ from, to }, 60);
}
function clearErrorMarks() {
  for (const t of tabs) { t.marks.forEach((m) => m.clear()); t.marks = []; }
}

// ======================================================================
// Tabs
// ======================================================================
function updateTabs() {
  const bar = $('#tabs');
  bar.innerHTML = '';
  tabs.forEach((t, i) => {
    const b = document.createElement('div');
    b.className = 'tab' + (i === active ? ' active' : '');
    b.title = 'Double-click to rename';
    b.insertAdjacentHTML('beforeend', '<svg class="file-icon" viewBox="0 0 16 16"><path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13"/></svg>');
    const label = document.createElement('span');
    label.textContent = t.name;
    b.appendChild(label);
    if (tabs.length > 1) {
      const x = document.createElement('button');
      x.className = 'tab-close';
      x.textContent = '×';
      x.title = 'Close tab';
      x.onclick = (e) => { e.stopPropagation(); closeTab(i); };
      b.appendChild(x);
    }
    b.onclick = () => switchTab(i);
    b.ondblclick = () => renameTab(i);
    bar.appendChild(b);
  });
  const plus = document.createElement('button');
  plus.className = 'tab-new';
  plus.textContent = '+';
  plus.title = `New tab (${modLabel('T')})`;
  plus.onclick = () => newTab();
  bar.appendChild(plus);
  document.title = `${tabs[active].name} - DrScheme Web`;
}

function switchTab(i) {
  if (i < 0 || i >= tabs.length) return;
  active = i;
  defs.swapDoc(tabs[i].doc);
  updateTabs();
  persist();
  defs.focus();
}

function uniqueName(base) {
  if (!tabs.some((t) => t.name === base)) return base;
  const m = /^(.*?)(\.[^.]*)?$/.exec(base);
  for (let k = 2; ; k++) {
    const n = `${m[1]}-${k}${m[2] || ''}`;
    if (!tabs.some((t) => t.name === n)) return n;
  }
}

function newTab(name, content) {
  tabs.push({ name: uniqueName(name || 'untitled.rkt'), doc: CodeMirror.Doc(content ?? '#lang r7rs\n', 'scheme'), marks: [] });
  switchTab(tabs.length - 1);
  defs.setCursor(defs.lineCount(), 0);
}

function closeTab(i) {
  if (tabs.length <= 1) return;
  const t = tabs[i];
  if (t.doc.getValue().trim() && !confirm(`Close "${t.name}"? Its contents will be lost (save it first if you need it).`)) return;
  tabs.splice(i, 1);
  if (active >= tabs.length) active = tabs.length - 1;
  else if (i < active) active--;
  switchTab(active);
}

async function renameTab(i) {
  const t = tabs[i];
  const name = await promptModal('Rename file', 'New name (e.g. stack.rkt):', t.name);
  if (!name || name === t.name) return;
  if (tabs.some((x) => x.name === name)) { await alertModal('Rename', `A tab named "${name}" already exists.`); return; }
  t.name = name.trim();
  updateTabs();
  persist();
}

// ======================================================================
// Files: open / save
// ======================================================================
$('#open-file').addEventListener('change', async (e) => {
  const list = Array.from(e.target.files || []);
  for (const f of list) {
    const content = await f.text();
    const existing = tabs.findIndex((t) => t.name === f.name);
    if (existing >= 0) { tabs[existing].doc.setValue(content); switchTab(existing); }
    else newTab(f.name, content);
  }
  e.target.value = '';
  defs.setCursor(0, 0);
});
function openFile() { $('#open-file').click(); }
function saveFile() {
  const t = tabs[active];
  const blob = new Blob([t.doc.getValue()], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = t.name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  t.doc.markClean();
  flash(`Downloaded "${t.name}".`);
}

// ======================================================================
// Syntax check
// ======================================================================
function checkSyntax() {
  const tab = tabs[active];
  clearErrorMarks();
  try {
    const forms = readAll(tab.doc.getValue());
    flash(`Check Syntax: OK (${forms.length} top-level expression${forms.length === 1 ? '' : 's'}).`);
  } catch (e) {
    markError(tab, e.pos, e.end);
    flash(`Syntax error at ${posLabel(tab, e.pos)}: ${e.message}`, true);
  }
}

function flash(msg, isErr) {
  const el = $('#status-msg');
  el.textContent = msg;
  el.classList.toggle('status-err', !!isErr);
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { if (!busy) { el.textContent = ''; el.classList.remove('status-err'); } }, 6000);
}

function reindentAll() {
  defs.operation(() => { for (let l = 0; l < defs.lineCount(); l++) defs.indentLine(l, 'smart'); });
}

// ======================================================================
// Menu (define ...)
// ======================================================================
function definitionsList() {
  const text = tabs[active].doc.getValue();
  let forms;
  try { forms = readAll(text); } catch { return null; }
  const out = [];
  for (const f of forms) {
    const h = headOf(f);
    if (!h || !/^define/.test(h) || !f.items[1]) continue;
    const target = f.items[1];
    let name = null;
    if (target.type === 'sym') name = target.value;
    else if (target.type === 'list' && target.items[0]) name = target.items[0].type === 'sym' ? target.items[0].value : text.slice(target.start, target.end);
    if (name) out.push({ name, start: f.start, kind: h });
  }
  return out;
}

// ======================================================================
// Drop-down menus
// ======================================================================
const MENUS = [
  { label: 'File', items: [
    { label: 'New Tab', key: modLabel('T'), action: () => newTab() },
    { label: 'Open…', key: modLabel('O'), action: openFile },
    { label: 'Save (download)', key: modLabel('S'), action: saveFile },
    { label: 'Rename…', action: () => renameTab(active) },
    { sep: true },
    { label: 'Close Tab', key: modLabel('W'), action: () => closeTab(active), disabled: () => tabs.length <= 1 },
    { sep: true },
    { label: 'Reset Everything…', action: resetAll },
  ] },
  { label: 'Edit', items: [
    { label: 'Undo', key: modLabel('Z'), action: () => defs.undo() },
    { label: 'Redo', key: modLabel('Y'), action: () => defs.redo() },
    { sep: true },
    { label: 'Cut', key: modLabel('X'), action: () => clip('cut') },
    { label: 'Copy', key: modLabel('C'), action: () => clip('copy') },
    { label: 'Paste', key: modLabel('V'), action: () => clip('paste') },
    { label: 'Select All', key: modLabel('A'), action: () => { defs.focus(); defs.execCommand('selectAll'); } },
    { sep: true },
    { label: 'Find…', key: modLabel('F'), action: () => { defs.focus(); defs.execCommand('find'); } },
    { label: 'Replace…', key: isMac ? '⌥⌘F' : 'Shift+Ctrl+F', action: () => { defs.focus(); defs.execCommand('replace'); } },
    { label: 'Go to Line…', key: modLabel('G'), action: () => { defs.focus(); defs.execCommand('jumpToLine'); } },
  ] },
  { label: 'View', items: [
    { label: 'Dark Mode', check: () => prefs.theme === 'dark', action: toggleTheme },
    { sep: true },
    { label: 'Definitions Window', key: modLabel('D'), check: () => prefs.showDefs, action: () => togglePane('defs') },
    { label: 'Interactions Window', key: modLabel('E'), check: () => prefs.showInter, action: () => togglePane('inter') },
    { sep: true },
    { label: 'Interactions on the Right', check: () => prefs.dock === 'right', action: () => setDock('right') },
    { label: 'Interactions on the Left', check: () => prefs.dock === 'left', action: () => setDock('left') },
    { label: 'Interactions Below', check: () => prefs.dock === 'bottom', action: () => setDock('bottom') },
    { label: 'Interactions Above', check: () => prefs.dock === 'top', action: () => setDock('top') },
    { sep: true },
    { label: 'Line Numbers', check: () => prefs.lineNumbers, action: toggleLineNumbers },
    { label: 'Bigger Text', key: modLabel('+'), action: () => setFont(prefs.fontSize + 1) },
    { label: 'Smaller Text', key: modLabel('-'), action: () => setFont(prefs.fontSize - 1) },
  ] },
  { label: 'Language', items: [
    { label: 'Choose Language…', key: modLabel('L'), action: chooseLanguage },
    { sep: true },
    { label: 'Insert #lang r7rs', action: () => insertAtTop('#lang r7rs\n') },
    { label: 'Insert #lang racket', action: () => insertAtTop('#lang racket\n') },
  ] },
  { label: 'Scheme', items: [
    { label: 'Run', key: modLabel('R'), action: run },
    { label: 'Stop', key: modLabel('B'), action: stop, disabled: () => !busy },
    { sep: true },
    { label: 'Check Syntax', key: isMac ? '⇧⌘K' : 'Shift+Ctrl+K', action: checkSyntax },
    { label: 'Reindent All', key: modLabel('I'), action: reindentAll },
    { label: 'Comment / Uncomment', key: modLabel(';'), action: () => { defs.focus(); defs.toggleComment(); } },
    { sep: true },
    { label: 'Clear Interactions', action: clearInteractions },
  ] },
  { label: 'Insert', items: [
    { label: 'Insert λ', key: modLabel('\\'), action: () => { defs.focus(); defs.replaceSelection('λ'); } },
    { label: 'Insert define-library Template', action: insertLibraryTemplate },
    { label: 'Insert define-record-type Template', action: insertRecordTemplate },
  ] },
  { label: 'Tabs', items: () => [
    { label: 'Next Tab', key: modLabel('PgDn'), action: () => switchTab((active + 1) % tabs.length) },
    { label: 'Previous Tab', key: modLabel('PgUp'), action: () => switchTab((active - 1 + tabs.length) % tabs.length) },
    { sep: true },
    ...tabs.map((t, i) => ({ label: t.name, check: () => i === active, action: () => switchTab(i) })),
  ] },
  { label: 'Help', items: [
    { label: 'Keyboard Shortcuts', action: showShortcuts },
    { label: 'Using an ADT from Another File', action: showAdtHelp },
    { sep: true },
    { label: 'About DrScheme Web', action: showAbout },
  ] },
];

const popup = $('#menu-popup');
let openMenuEl = null;

function buildMenubar() {
  const bar = $('#menubar');
  MENUS.forEach((m) => {
    const b = document.createElement('button');
    b.className = 'menu-title';
    b.textContent = m.label;
    b.onmousedown = (e) => { e.preventDefault(); openMenuEl === b ? closeMenu() : openMenu(b, typeof m.items === 'function' ? m.items() : m.items); };
    b.onmouseenter = () => { if (openMenuEl && openMenuEl !== b) openMenu(b, typeof m.items === 'function' ? m.items() : m.items); };
    bar.appendChild(b);
  });
}

function openMenu(anchor, items) {
  closeMenu();
  openMenuEl = anchor;
  anchor.classList.add('open');
  popup.innerHTML = '';
  for (const it of items) {
    if (it.sep) { const hr = document.createElement('div'); hr.className = 'menu-sep'; popup.appendChild(hr); continue; }
    const row = document.createElement('button');
    row.className = 'menu-item';
    const dis = it.disabled && it.disabled();
    if (dis) row.disabled = true;
    row.innerHTML = `<span class="menu-check">${it.check && it.check() ? '✓' : ''}</span><span class="menu-label"></span><span class="menu-key">${it.key || ''}</span>`;
    row.querySelector('.menu-label').textContent = it.label;
    row.onmouseup = (e) => { e.preventDefault(); if (dis) return; closeMenu(); it.action(); };
    row.onclick = (e) => e.preventDefault();
    popup.appendChild(row);
  }
  const r = anchor.getBoundingClientRect();
  popup.hidden = false;
  const w = popup.offsetWidth;
  popup.style.left = Math.max(4, Math.min(r.left, window.innerWidth - w - 4)) + 'px';
  popup.style.top = r.bottom + 'px';
}
function closeMenu() {
  popup.hidden = true;
  if (openMenuEl) openMenuEl.classList.remove('open');
  openMenuEl = null;
}
document.addEventListener('mousedown', (e) => {
  if (openMenuEl && !e.target.closest('#menu-popup') && !e.target.closest('.menu-title') && !e.target.closest('.chip')) closeMenu();
});

async function clip(kind) {
  defs.focus();
  try {
    if (kind === 'paste') { defs.replaceSelection(await navigator.clipboard.readText()); return; }
    const sel = defs.getSelection();
    if (!sel) return;
    await navigator.clipboard.writeText(sel);
    if (kind === 'cut') defs.replaceSelection('');
  } catch {
    flash(`The browser blocked the clipboard: use ${modLabel(kind === 'paste' ? 'V' : kind === 'cut' ? 'X' : 'C')} instead.`, true);
  }
}

// ======================================================================
// View
// ======================================================================
// Where the interactions window sits. On narrow screens, left/right become top/bottom.
const DOCKS = ['right', 'left', 'bottom', 'top'];
const narrow = () => window.innerWidth < 700;
function currentDock() {
  const d = DOCKS.includes(prefs.dock) ? prefs.dock : 'right';
  if (narrow()) return d === 'left' || d === 'top' ? 'top' : 'bottom';
  return d;
}
const isHorizontal = (d) => d === 'left' || d === 'right';
function splitKey() { return isHorizontal(currentDock()) ? 'splitH' : 'splitV'; }

function applyLayout() {
  const dock = currentDock();
  const panes = $('#panes');
  panes.className = `dock-${dock}`;
  $('#defs-wrap').hidden = !prefs.showDefs;
  $('#inter-wrap').hidden = !prefs.showInter;
  $('#splitter').hidden = !(prefs.showDefs && prefs.showInter);
  $('#defs-wrap').style.flex = prefs.showInter ? `0 0 ${prefs[splitKey()] * 100}%` : '1 1 auto';
  document.querySelectorAll('#dock-btns button').forEach((b) => b.classList.toggle('active', b.dataset.dock === dock));
  document.documentElement.dataset.theme = prefs.theme;
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = prefs.theme === 'dark' ? '#14161b' : '#ffffff';
  document.documentElement.style.setProperty('--code-size', prefs.fontSize + 'px');
  defs.refresh();
  input.refresh();
}
function togglePane(which) {
  if (which === 'defs') prefs.showDefs = !prefs.showDefs;
  else prefs.showInter = !prefs.showInter;
  if (!prefs.showDefs && !prefs.showInter) { if (which === 'defs') prefs.showInter = true; else prefs.showDefs = true; }
  applyLayout();
  persist();
}
function toggleTheme() { prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark'; applyLayout(); persist(); }
function clearInteractions() { log.textContent = ''; lastOut = null; input.focus(); }
function setDock(d) { prefs.dock = d; prefs.showInter = true; applyLayout(); persist(); }
function toggleLineNumbers() { prefs.lineNumbers = !prefs.lineNumbers; defs.setOption('lineNumbers', prefs.lineNumbers); persist(); }
function setFont(px) { prefs.fontSize = Math.max(9, Math.min(28, px)); applyLayout(); persist(); }

// Draggable splitter between definitions and interactions
(function splitter() {
  const sp = $('#splitter');
  let dragging = false;
  sp.addEventListener('pointerdown', (e) => { dragging = true; sp.setPointerCapture(e.pointerId); document.body.classList.add('dragging'); });
  sp.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const r = $('#panes').getBoundingClientRect();
    const dock = currentDock();
    let f = isHorizontal(dock) ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
    if (dock === 'left' || dock === 'top') f = 1 - f; // the definitions are on the other side
    prefs[splitKey()] = Math.max(0.15, Math.min(0.85, f));
    $('#defs-wrap').style.flex = `0 0 ${prefs[splitKey()] * 100}%`;
    defs.refresh();
  });
  const end = () => { if (dragging) { dragging = false; document.body.classList.remove('dragging'); persist(); defs.refresh(); input.refresh(); } };
  sp.addEventListener('pointerup', end);
  sp.addEventListener('pointercancel', end);
})();

// Drag the interactions header to an edge of the window to move it there.
(function dockDrag() {
  const head = $('#inter-head');
  const overlay = $('#dock-overlay');
  let start = null;
  let target = null;
  let dragging = false;
  function zoneAt(x, y) {
    const r = $('#panes').getBoundingClientRect();
    const dist = { left: x - r.left, right: r.right - x, top: y - r.top, bottom: r.bottom - y };
    const allowed = narrow() ? ['top', 'bottom'] : DOCKS;
    return allowed.reduce((best, d) => (dist[d] / (isHorizontal(d) ? r.width : r.height) < dist[best] / (isHorizontal(best) ? r.width : r.height) ? d : best), allowed[0]);
  }
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 8) return;
      dragging = true;
      overlay.hidden = false;
      document.body.classList.add('docking');
    }
    target = zoneAt(e.clientX, e.clientY);
    overlay.dataset.zone = target;
  });
  const end = () => {
    if (dragging && target) setDock(target);
    start = null; target = null; dragging = false;
    overlay.hidden = true;
    document.body.classList.remove('docking');
  };
  head.addEventListener('pointerup', end);
  head.addEventListener('pointercancel', end);
  document.querySelectorAll('#dock-btns button').forEach((b) => { b.onclick = () => setDock(b.dataset.dock); });
})();

// ======================================================================
// Language
// ======================================================================
function updateLangButton() {
  const labels = { auto: 'Determine language from source', r7rs: 'R7RS', racket: 'Racket (partial compatibility)' };
  $('#lang-btn-label').textContent = labels[prefs.langMode];
}
async function chooseLanguage() {
  const body = document.createElement('div');
  body.innerHTML = `
    <label class="radio"><input type="radio" name="lang" value="auto"><span><b>Determine language from source</b>
      <small>Uses the <code>#lang</code> line at the top of the file (<code>#lang r7rs</code> or <code>#lang racket</code>). Without <code>#lang</code>: R7RS.</small></span></label>
    <label class="radio"><input type="radio" name="lang" value="r7rs"><span><b>R7RS</b>
      <small>Standard Scheme: <code>define-library</code>, <code>import</code>, <code>define-record-type</code>… <code>(scheme base)</code>, <code>(scheme write)</code>, etc. are imported automatically.</small></span></label>
    <label class="radio"><input type="radio" name="lang" value="racket"><span><b>Racket (partial compatibility)</b>
      <small>Adds <code>first</code>, <code>rest</code>, <code>add1</code>, <code>filter</code>, <code>foldl</code>, <code>printf</code>, <code>displayln</code>… and ignores <code>provide</code>. The engine is still R7RS, so not all of Racket is available.</small></span></label>`;
  body.querySelector(`input[value="${prefs.langMode}"]`).checked = true;
  const ok = await modal('Choose Language', body, [{ label: 'Cancel', value: false }, { label: 'OK', value: true, primary: true }]);
  if (!ok) return;
  prefs.langMode = body.querySelector('input[name=lang]:checked').value;
  updateLangButton();
  persist();
  flash('Language changed: click "Run" to apply it.');
}
function insertAtTop(line) {
  const d = tabs[active].doc;
  if (/^#lang/.test(d.getLine(0))) d.replaceRange(line.replace(/\n$/, ''), { line: 0, ch: 0 }, { line: 0, ch: d.getLine(0).length });
  else d.replaceRange(line, { line: 0, ch: 0 });
  defs.focus();
}
function insertLibraryTemplate() {
  defs.focus();
  defs.replaceSelection(`(define-library (my-library)
  (export my-function)
  (import (scheme base))
  (begin
    (define (my-function x)
      x)))
`);
}
function insertRecordTemplate() {
  defs.focus();
  defs.replaceSelection(`(define-record-type point
  (make-point x y)
  point?
  (x point-x point-x!)
  (y point-y point-y!))
`);
}

// ======================================================================
// Modal dialogs
// ======================================================================
function modal(title, body, buttons) {
  return new Promise((resolve) => {
    const m = $('#modal');
    m.querySelector('.modal-title').textContent = title;
    const b = m.querySelector('.modal-body');
    b.innerHTML = '';
    if (typeof body === 'string') b.innerHTML = body; else b.appendChild(body);
    const f = m.querySelector('.modal-buttons');
    f.innerHTML = '';
    const close = (v) => { m.hidden = true; document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      if (e.key === 'Enter' && !e.shiftKey) { const p = buttons.find((x) => x.primary); if (p) { e.preventDefault(); close(p.value); } }
    };
    for (const btn of buttons) {
      const el = document.createElement('button');
      el.textContent = btn.label;
      if (btn.primary) el.className = 'primary';
      el.onclick = () => close(btn.value);
      f.appendChild(el);
    }
    m.hidden = false;
    document.addEventListener('keydown', onKey, true);
    const first = b.querySelector('input:not([type=radio])') || f.querySelector('.primary');
    if (first) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 0);
  });
}
function alertModal(title, text) {
  const p = document.createElement('p');
  p.textContent = text;
  return modal(title, p, [{ label: 'OK', value: true, primary: true }]);
}
async function promptModal(title, label, value) {
  const div = document.createElement('div');
  div.innerHTML = '<label class="field"><span></span><input type="text" spellcheck="false"></label>';
  div.querySelector('span').textContent = label;
  const inp = div.querySelector('input');
  inp.value = value || '';
  const ok = await modal(title, div, [{ label: 'Cancel', value: false }, { label: 'OK', value: true, primary: true }]);
  return ok ? inp.value : null;
}
function featureNotAvailable(name) {
  alertModal(name, `${name} is not available in the web version yet. Use Run and the interactions window to test your code step by step.`);
}
async function resetAll() {
  const ok = await modal('Reset Everything', '<p>Delete all tabs and preferences saved in this browser? Download any files you want to keep first.</p>',
    [{ label: 'Cancel', value: false }, { label: 'Delete Everything', value: true, primary: true }]);
  if (!ok) return;
  localStorage.removeItem(KEY);
  clearTimeout(saveTimer);
  window.onbeforeunload = null;
  location.reload();
}
function showShortcuts() {
  const rows = [
    ['Run', modLabel('R')], ['Stop', modLabel('B')], ['Check Syntax', isMac ? '⇧⌘K' : 'Shift+Ctrl+K'],
    ['New tab', modLabel('T')], ['Open', modLabel('O')], ['Save (download)', modLabel('S')], ['Close tab', modLabel('W')],
    ['Next / previous tab', `${modLabel('PgDn')} / ${modLabel('PgUp')}`],
    ['Reindent line / selection', 'Tab'], ['Reindent all', modLabel('I')], ['Comment / uncomment', modLabel(';')],
    ['Insert λ', modLabel('\\')], ['Show/hide definitions', modLabel('D')], ['Show/hide interactions', modLabel('E')],
    ['Interactions: evaluate', 'Enter'], ['Interactions: new line', 'Shift+Enter'],
    ['Interactions: history', `${modLabel('↑')} / ${modLabel('↓')}`],
  ];
  modal('Keyboard Shortcuts', `<table class="keys">${rows.map(([a, b]) => `<tr><td>${a}</td><td><kbd>${b}</kbd></td></tr>`).join('')}</table>`,
    [{ label: 'Close', value: true, primary: true }]);
}
function showAdtHelp() {
  modal('Using an ADT from Another File', `
    <p>Open or create your ADT's file in <b>another tab</b> (e.g. <code>stack.rkt</code>), then in your program:</p>
    <p><b>If the ADT is a <code>define-library</code></b>, just import it by name: the tab that defines it is loaded automatically.</p>
    <pre>(import (prefix (stack) s:))</pre>
    <p><b>If it is plain <code>define</code>s:</b></p>
    <pre>(include "stack.rkt")</pre>
    <p>In <code>#lang racket</code>, <code>(require "stack.rkt")</code> works too. Paths like <code>/uploads/stack.rkt</code> (JDoodle) are accepted: only the file name matters.</p>`,
  [{ label: 'Close', value: true, primary: true }]);
}
function showAbout() {
  modal('About', `
    <div class="about"><div class="logo big">λ</div>
    <p><b>DrScheme Web ${VERSION}</b><br>A Scheme environment in your browser, inspired by DrRacket.</p>
    <p>Engine: <a href="https://github.com/trb-a/cumalis-lisp" target="_blank" rel="noopener">Cumalis Lisp</a> (R7RS-small).<br>
    Editor: <a href="https://codemirror.net/5/" target="_blank" rel="noopener">CodeMirror 5</a>.</p>
    <p class="muted">Independent project, not affiliated with Racket or DrRacket.<br>
    Limitations: no exact fractions (1/3 → 0.333…), no big integers, and code runs slower than in DrRacket.</p></div>`,
  [{ label: 'Close', value: true, primary: true }]);
}

// ======================================================================
// Toolbar, shortcuts, startup
// ======================================================================
$('#run-btn').onclick = run;
$('#stop-btn').onclick = stop;
$('#check-btn').onclick = checkSyntax;
$('#debug-btn').onclick = () => featureNotAvailable('Debug');
$('#macro-btn').onclick = () => featureNotAvailable('Macro Stepper');
$('#lang-btn').onclick = chooseLanguage;
$('#theme-btn').onclick = toggleTheme;
$('#clear-btn').onclick = clearInteractions;
$('#define-btn').onmousedown = (e) => {
  e.preventDefault();
  const b = e.currentTarget;
  if (openMenuEl === b) return closeMenu();
  const list = definitionsList();
  let items;
  if (list === null) items = [{ label: 'Syntax error in this file', action: checkSyntax }];
  else if (!list.length) items = [{ label: '(no definitions)', action: () => {}, disabled: () => true }];
  else items = list.map((d) => ({ label: d.name, key: d.kind === 'define' ? '' : d.kind, action: () => {
    const p = tabs[active].doc.posFromIndex(d.start);
    defs.focus();
    defs.setCursor(p);
    defs.scrollIntoView(p, 80);
  } }));
  openMenu(b, items);
};

window.addEventListener('keydown', (e) => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod || e.altKey) return;
  const k = e.key.toLowerCase();
  const map = {
    r: run, b: stop, s: saveFile, o: openFile, t: () => newTab(), w: () => closeTab(active),
    d: () => togglePane('defs'), e: () => togglePane('inter'), i: reindentAll, l: chooseLanguage,
    '=': () => setFont(prefs.fontSize + 1), '+': () => setFont(prefs.fontSize + 1), '-': () => setFont(prefs.fontSize - 1),
    pagedown: () => switchTab((active + 1) % tabs.length), pageup: () => switchTab((active - 1 + tabs.length) % tabs.length),
  };
  if (e.shiftKey && k === 'k') { e.preventDefault(); checkSyntax(); return; }
  if (e.shiftKey) return;
  if (map[k]) { e.preventDefault(); e.stopPropagation(); map[k](); }
}, true);

window.addEventListener('beforeunload', () => {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(KEY, JSON.stringify({ tabs: tabs.map((t) => ({ name: t.name, content: t.doc.getValue() })), active, prefs }));
  } catch { /* rien */ }
});
window.addEventListener('resize', () => { closeMenu(); applyLayout(); });

// Exposed for automated tests
window.drscheme = { run, stop, tabs, defs, input, newTab, switchTab, runInteraction, get busy() { return busy; } };

buildMenubar();
updateTabs();
updateLangButton();
applyLayout();
printBanner(effectiveLang(tabs[active].doc.getValue()));
newSession(effectiveLang(tabs[active].doc.getValue()));
defs.focus();
