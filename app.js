'use strict';
/* global tokenize, spokenTokens, ScriptMatcher */

const $ = (id) => document.getElementById(id);

// ============================================================
// Speicher & Einstellungen
// ============================================================
const LS = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* voll oder gesperrt */ }
  },
};

const DEFAULTS = {
  fontSize: 40, lineSpacing: 0.25, readingLine: 0.33, centered: false,
  mirror: false, flipV: false,
  leftMargin: 0.07, rightMargin: 0.07, linkMargins: true,
  reaction: 7, leadLines: 0, pauseDelay: 0.6, lang: 'de-DE',
  mode: 'voice', autoSpeed: 50, panelLeft: false,
};
let settings = { ...DEFAULTS, ...LS.get('tp.settings', {}) };
const saveSettings = () => LS.set('tp.settings', settings);

const SAMPLE = `Hallo und herzlich willkommen! Das ist ein Beispielskript für deinen Teleprompter.

Tippe unten auf das Mikrofon und lies diesen Text einfach laut vor. Der Teleprompter hört dir zu und scrollt in deinem Tempo mit.

[Kurze Pause – Text in eckigen Klammern ist eine Regieanweisung und wird nicht mitgelesen.]

Wenn du stockst oder eine Pause machst, bleibt der Text stehen. Sobald du weitersprichst, läuft er wieder an.

Wenn du dich versprichst und einen Satz noch einmal von vorne beginnst, springt der Teleprompter automatisch zurück.

Du kannst außerdem auf ein beliebiges Wort tippen, um dorthin zu springen, oder den Text mit dem Finger verschieben.

Viel Erfolg bei deiner Aufnahme!`;

let scripts = LS.get('tp.scripts', null);
if (!Array.isArray(scripts)) {
  scripts = [{ id: uid(), title: 'Beispiel – So funktioniert’s', text: SAMPLE, updated: Date.now() }];
  saveScripts();
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function saveScripts() { LS.set('tp.scripts', scripts); }
function wordCount(t) { return (t.match(/\S+/g) || []).length; }
function titleFromText(t) {
  const line = (t.split('\n').find((l) => l.trim()) || '').trim();
  return line ? line.slice(0, 40) : 'Neues Skript';
}

// ============================================================
// Import (Markdown, RTF)
// ============================================================
function cleanMarkdown(t) {
  return t.split('\n').map((line) => {
    let l = line.trim().replace(/^#+\s*/, '').replace(/^([-*>])\s+/, '');
    return l.replace(/\*\*|__/g, '');
  }).join('\n');
}

function rtfToText(rtf) {
  const skipWords = new Set(['fonttbl', 'colortbl', 'expandedcolortbl', 'stylesheet', 'info', 'pict',
    'header', 'footer', 'listtable', 'listoverridetable', 'generator', 'themedata', 'latentstyles']);
  let out = '', i = 0, skip = false;
  const stack = [];
  while (i < rtf.length) {
    const c = rtf[i];
    if (c === '{') { stack.push(skip); i++; continue; }
    if (c === '}') { skip = stack.length ? stack.pop() : false; i++; continue; }
    if (c === '\\') {
      const n = rtf[i + 1];
      if (n === '\\' || n === '{' || n === '}') { if (!skip) out += n; i += 2; continue; }
      if (n === '*') { skip = true; i += 2; continue; }
      if (n === "'") { if (!skip) out += String.fromCharCode(parseInt(rtf.substr(i + 2, 2), 16)); i += 4; continue; }
      if (n === '\n' || n === '\r') { if (!skip) out += '\n'; i += 2; continue; }
      const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i + 1, i + 40));
      if (!m) { i += 2; continue; }
      i += 1 + m[0].length;
      const word = m[1];
      if (skipWords.has(word)) { skip = true; continue; }
      if (skip) continue;
      if (word === 'par' || word === 'line') out += '\n';
      else if (word === 'tab') out += '\t';
      else if (word === 'u' && m[2]) {
        out += String.fromCharCode((Number(m[2]) + 65536) % 65536);
        if (rtf[i] === '?') i++;
        else if (rtf[i] === '\\' && rtf[i + 1] === "'") i += 4;
      }
      continue;
    }
    if (c !== '\n' && c !== '\r' && !skip) out += c;
    i++;
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function cleanImported(text, filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (ext === 'rtf' || text.startsWith('{\\rtf')) return rtfToText(text);
  if (ext === 'md' || ext === 'markdown') return cleanMarkdown(text);
  return text;
}

// ============================================================
// Bibliothek
// ============================================================
function addScript(title, text) {
  const s = { id: uid(), title: title.trim() || titleFromText(text), text, updated: Date.now() };
  scripts.unshift(s);
  saveScripts();
  renderLibrary();
  return s;
}

function renderLibrary() {
  const list = $('scriptList');
  list.innerHTML = '';
  scripts.sort((a, b) => b.updated - a.updated);
  for (const s of scripts) {
    const li = document.createElement('li');
    li.className = 'item';

    const main = document.createElement('button');
    main.className = 'item-main';
    const words = wordCount(s.text);
    main.innerHTML = '<div class="item-title"></div><div class="item-preview"></div><div class="item-meta"></div>';
    main.children[0].textContent = s.title;
    main.children[1].textContent = s.text.replace(/\s+/g, ' ').slice(0, 160);
    main.children[2].textContent = `${words} Wörter · ca. ${Math.max(1, Math.round(words / 140))} Min.`;
    main.onclick = () => openPrompter(s.id);

    const edit = document.createElement('button');
    edit.className = 'item-btn';
    edit.textContent = '✎';
    edit.setAttribute('aria-label', 'Bearbeiten');
    edit.onclick = () => openEditor(s.id);

    const del = document.createElement('button');
    del.className = 'item-btn del';
    del.textContent = '🗑';
    del.setAttribute('aria-label', 'Löschen');
    del.onclick = () => {
      if (!confirm(`„${s.title}“ löschen?`)) return;
      scripts = scripts.filter((x) => x.id !== s.id);
      saveScripts();
      renderLibrary();
    };

    li.append(main, edit, del);
    list.append(li);
  }
}

$('btnPaste').onclick = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text && text.trim()) { addScript(titleFromText(text), text); return; }
  } catch { /* nicht erlaubt → Editor */ }
  openEditor(null);
};
$('btnNew').onclick = () => openEditor(null);
$('btnFile').onclick = () => $('fileInput').click();
$('fileInput').onchange = async (e) => {
  for (const file of e.target.files) {
    const text = cleanImported(await file.text(), file.name);
    if (text.trim()) addScript(file.name.replace(/\.[^.]+$/, ''), text);
  }
  e.target.value = '';
};

// Editor
let editingId = null;
function openEditor(id) {
  editingId = id;
  const s = scripts.find((x) => x.id === id);
  $('editorTitle').textContent = s ? 'Bearbeiten' : 'Neues Skript';
  $('editTitle').value = s ? s.title : '';
  $('editText').value = s ? s.text : '';
  $('editor').showModal();
  if (!s) $('editText').focus();
}
$('editor').addEventListener('close', () => {
  if ($('editor').returnValue !== 'save') return;
  const text = $('editText').value;
  if (!text.trim()) return;
  const title = $('editTitle').value.trim() || titleFromText(text);
  const s = scripts.find((x) => x.id === editingId);
  if (s) {
    Object.assign(s, { title, text, updated: Date.now() });
    saveScripts();
    renderLibrary();
  } else {
    addScript(title, text);
  }
});

const isStandalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
$('installHint').hidden = !(isIOS && !isStandalone);
navigator.storage?.persist?.();

// ============================================================
// Skripte aus dem GitHub-Repo (Ordner scripts/)
// ============================================================
// Owner/Repo aus der Pages-Adresse ableiten (joanabayraktar.github.io/teleprompter/).
const REPO = (() => {
  const owner = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : 'JoanaBayraktar';
  const repo = location.hostname.endsWith('.github.io') ? (location.pathname.split('/')[1] || 'teleprompter') : 'teleprompter';
  return `${owner}/${repo}`;
})();
let repoScripts = LS.get('tp.repoScripts', []); // Cache, damit sie auch offline da sind

async function loadRepoScripts() {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/scripts`, { cache: 'no-store' });
    if (!res.ok) return; // Ordner fehlt oder Limit erreicht → Cache behalten
    const files = (await res.json()).filter((f) => f.type === 'file' && /\.(txt|md|markdown|rtf|text)$/i.test(f.name));
    const cached = new Map(repoScripts.map((r) => [r.id, r]));
    const next = [];
    for (const f of files) {
      const id = 'gh:' + f.path;
      const old = cached.get(id);
      if (old && old.sha === f.sha) { next.push(old); continue; }
      const text = await (await fetch(f.download_url, { cache: 'no-store' })).text();
      next.push({ id, sha: f.sha, title: f.name.replace(/\.[^.]+$/, ''), text: cleanImported(text, f.name), updated: 0 });
    }
    next.sort((a, b) => a.title.localeCompare(b.title, 'de'));
    repoScripts = next;
    LS.set('tp.repoScripts', repoScripts);
    renderRepoList();
  } catch { /* offline → Cache */ }
}

function renderRepoList() {
  const list = $('repoList');
  list.innerHTML = '';
  $('repoSection').hidden = repoScripts.length === 0;
  for (const s of repoScripts) {
    const li = document.createElement('li');
    li.className = 'item';
    const main = document.createElement('button');
    main.className = 'item-main';
    const words = wordCount(s.text);
    main.innerHTML = '<div class="item-title"></div><div class="item-preview"></div><div class="item-meta"></div>';
    main.children[0].textContent = s.title;
    main.children[1].textContent = s.text.replace(/\s+/g, ' ').slice(0, 160);
    main.children[2].textContent = `${words} Wörter · ca. ${Math.max(1, Math.round(words / 140))} Min.`;
    main.onclick = () => openPrompter(s.id);
    // Kopie anlegen, um sie auf dem Handy zu bearbeiten
    const copy = document.createElement('button');
    copy.className = 'item-btn';
    copy.textContent = '✎';
    copy.setAttribute('aria-label', 'Als eigene Kopie bearbeiten');
    copy.onclick = () => { const c = addScript(s.title, s.text); openEditor(c.id); };
    li.append(main, copy);
    list.append(li);
  }
}

// ============================================================
// Sprachverfolgung
// ============================================================
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;

class Follower {
  constructor(words, onEvent) {
    this.matcher = new ScriptMatcher(words);
    this.count = words.length;
    this.onEvent = onEvent;
    this.position = -1;
    this.focus = 0; // Wort, dessen Zeile am Pfeil steht
    this.listening = false;
    this.status = 'idle';
    this.error = '';
    this.wpm = 0;
    this.history = [];
    this.lastVoice = 0;
    this.lastChange = 0;
    this.quickFails = 0;
    // Wörter im laufenden Transkript, die nach einem manuellen Sprung ignoriert werden.
    // (Kein Neustart der Erkennung – der würde auf iOS jedes Mal einen Ton abspielen.)
    this.baseline = 0;
    this.tokenCount = 0;
  }

  get speaking() {
    return this.listening && performance.now() - this.lastVoice < settings.pauseDelay * 1000 + 100;
  }

  start() {
    if (this.listening) return;
    this.listening = true;
    this.status = 'starting';
    this.error = '';
    this.quickFails = 0;
    this.onEvent('status');
    this._session();
  }

  stop() {
    this.listening = false;
    const rec = this.rec;
    this.rec = null;
    if (rec) { try { rec.abort(); } catch { /* egal */ } }
    if (this.status !== 'error') this.status = 'idle';
    this.onEvent('status');
  }

  _fail(message) {
    this.stop();
    this.status = 'error';
    this.error = message;
    this.onEvent('status');
  }

  _session() {
    const rec = new SpeechRec();
    rec.lang = settings.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    this.rec = rec;
    this.baseline = 0;
    this.tokenCount = 0;
    const started = performance.now();
    let gotResult = false;
    let lastTranscript = '';

    rec.onstart = () => {
      if (this.rec !== rec) return;
      this.status = 'listening';
      this.onEvent('status');
    };
    rec.onresult = (e) => {
      if (this.rec !== rec) return;
      let t = '';
      for (let k = 0; k < e.results.length; k++) t += e.results[k][0].transcript + ' ';
      if (t === lastTranscript) return;
      lastTranscript = t;
      gotResult = true;
      this.quickFails = 0;
      this.lastVoice = performance.now();
      this._process(t);
    };
    rec.onerror = (e) => {
      if (this.rec !== rec) return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this._fail('Kein Zugriff auf Mikrofon/Spracherkennung. Erlaube das Mikrofon für diese Seite und aktiviere in den iOS-Einstellungen „Siri“ bzw. „Diktieren“.');
      } else if (e.error === 'network') {
        this.netError = true;
      } else if (e.error === 'language-not-supported') {
        this._fail('Diese Sprache wird von der Spracherkennung nicht unterstützt.');
      }
    };
    rec.onend = () => {
      if (this.rec !== rec || !this.listening) return;
      // Sitzungen enden bei Stille von selbst → nahtlos neu starten.
      // Nur wiederholte Sofort-Abbrüche zählen als Fehler.
      if (!gotResult && performance.now() - started < 1500) this.quickFails++;
      if (this.quickFails > 6) {
        this._fail(this.netError
          ? 'Spracherkennung braucht eine Internetverbindung.'
          : 'Spracherkennung wurde unterbrochen. Tippe erneut auf das Mikrofon.');
        return;
      }
      setTimeout(() => { if (this.listening && this.rec === rec) this._session(); }, this.quickFails > 1 ? 500 : 30);
    };
    try {
      rec.start();
    } catch {
      this._fail('Spracherkennung konnte nicht gestartet werden.');
    }
  }

  _process(transcript) {
    const tokens = spokenTokens(transcript);
    this.tokenCount = tokens.length;
    if (P.interacting) return; // während du den Text verschiebst, nichts übernehmen
    const fresh = tokens.slice(this.baseline);
    if (!fresh.length) return;
    const cmd = findCommand(fresh);
    if (cmd) {
      this.baseline += cmd.end; // Befehl „verbraucht“
      this.onEvent('command', cmd.command);
      return;
    }
    const r = this.matcher.locate(fresh, this.position, false);
    if (!r || r.match.index === this.position) return;
    const now = performance.now();
    const idx = r.match.index;
    if (r.isJump || idx > this.position + 25) {
      this.onEvent('notice', 'Weitergesprungen');
      this.history = [];
    }
    this.position = idx;
    this.focus = idx;
    this.lastChange = now;
    this.history.push({ t: now, i: idx });
    this.history = this.history.filter((h) => now - h.t <= 8000);
    const first = this.history[0], last = this.history[this.history.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt > 1.5 && last.i > first.i) {
      const wpm = (last.i - first.i) / dt * 60;
      this.wpm = this.wpm ? this.wpm * 0.7 + wpm * 0.3 : wpm;
    }
    this.onEvent('position');
  }

  setPosition(i) {
    this.position = Math.min(Math.max(i, -1), this.count - 1);
    // Angetipptes/angesteuertes Wort (= nächstes zu lesendes) steht am Pfeil.
    this.focus = Math.min(this.position + 1, Math.max(this.count - 1, 0));
    this.history = [];
    this.lastChange = performance.now();
    // Bisher Gesprochenes ab jetzt ignorieren, damit es nicht zurückzieht.
    this.baseline = this.tokenCount;
    this.onEvent('position');
  }
}

// ============================================================
// Teleprompter
// ============================================================
const P = {
  active: false,
  script: null,
  wordEls: [],
  cueEls: [],
  wordMid: [],
  offset: 0,
  readingY: 0,
  highlighted: -1,
  follower: null,
  autoRunning: false,
  interacting: false,
  lastFrame: 0,
  wakeLock: null,
};

const prompterEl = $('prompter');
const stageEl = $('stage');
const textEl = $('text');

const ICONS = {
  mic: '<svg viewBox="0 0 24 24"><path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 1 0-7 0v6A3.5 3.5 0 0 0 12 15Zm6-3.6a.9.9 0 0 0-1.8 0 4.2 4.2 0 0 1-8.4 0 .9.9 0 0 0-1.8 0 6 6 0 0 0 5.1 5.9V20H8.6a.9.9 0 0 0 0 1.8h6.8a.9.9 0 0 0 0-1.8h-2.5v-2.7a6 6 0 0 0 5.1-5.9Z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.1v13.8a1 1 0 0 0 1.5.9l11-6.9a1 1 0 0 0 0-1.8l-11-6.9A1 1 0 0 0 8 5.1Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z"/></svg>',
};

function openPrompter(id) {
  const s = scripts.find((x) => x.id === id) || repoScripts.find((x) => x.id === id);
  if (!s) return;
  P.script = s;
  const { parts, words } = tokenize(s.text);

  const frag = document.createDocumentFragment();
  P.wordEls = [];
  P.cueEls = [];
  P.punctEls = []; // Satzzeichen nach Wort i, damit sie mit ausgegraut werden
  P.paraStarts = [0]; // Wortindex, mit dem ein Absatz beginnt
  const paraBreak = /\n\s*\n/.test(s.text) ? /\n\s*\n/ : /\n/;
  let pendingBreak = false;
  let lastWord = -1;
  for (const part of parts) {
    if (part.type !== 'word' && paraBreak.test(part.text)) pendingBreak = true;
    if (part.type === 'word') {
      if (pendingBreak && part.index > 0) P.paraStarts.push(part.index);
      pendingBreak = false;
    }
    if (part.type === 'space') {
      if (/^\s*$/.test(part.text) || lastWord < 0) {
        frag.append(document.createTextNode(part.text));
      } else {
        const span = document.createElement('span');
        span.className = 'p';
        span.textContent = part.text;
        (P.punctEls[lastWord] ||= []).push(span);
        frag.append(span);
      }
    } else {
      const span = document.createElement('span');
      span.textContent = part.text;
      if (part.type === 'word') {
        span.className = 'w';
        span.dataset.i = part.index;
        P.wordEls.push(span);
        lastWord = part.index;
      } else {
        span.className = 'cue';
        span.dataset.after = part.after;
        P.cueEls.push(span);
      }
      frag.append(span);
    }
  }
  textEl.replaceChildren(frag);

  P.follower = new Follower(words, onFollowerEvent);
  P.highlighted = -1;
  P.autoRunning = false;
  P.active = true;

  $('library').hidden = true;
  prompterEl.hidden = false;
  closePanel();
  applyLayout();
  P.offset = (P.wordMid[0] ?? 0) - P.readingY;
  renderOffset();
  updateControls();
  lockScreen();
  if (!SpeechRec && settings.mode === 'voice') {
    setMode('auto');
    showNotice('Dieser Browser unterstützt keine Spracherkennung – Auto-Modus aktiv.');
  }
}

function closePrompter() {
  P.follower?.stop();
  P.active = false;
  P.autoRunning = false;
  prompterEl.hidden = true;
  $('library').hidden = false;
  releaseScreen();
}

function onFollowerEvent(type, payload) {
  if (type === 'notice') showNotice(payload);
  if (type === 'command') runCommand(payload);
  if (type === 'position' && settings.mode === 'voice') setHighlight(P.follower.position);
  updateControls();
}

// ---------- Sprachbefehle ----------
function runCommand(command) {
  const f = P.follower;
  const starts = P.paraStarts;
  const next = f.position + 1; // Wort, das als Nächstes gelesen wird
  let current = 0;
  for (let k = 0; k < starts.length; k++) if (starts[k] <= next) current = k;
  if (command === 'start') {
    f.setPosition(-1);
    showNotice('⏮ Zum Anfang');
  } else if (command === 'back') {
    // Gerade erst angefangen? Dann einen Absatz weiter zurück.
    const target = next - starts[current] <= 3 && current > 0 ? current - 1 : current;
    f.setPosition(starts[target] - 1);
    showNotice('↺ Absatz nochmal');
  } else if (command === 'next') {
    if (current + 1 < starts.length) {
      f.setPosition(starts[current + 1] - 1);
      showNotice('⏭ Nächster Absatz');
    } else {
      showNotice('Letzter Absatz');
    }
  }
}

// ---------- Layout ----------
function applyLayout() {
  if (!P.active) return;
  const W = stageEl.clientWidth, H = stageEl.clientHeight;
  const keepIdx = settings.mode === 'auto' ? wordAtReadingLine() : null;

  let left = Math.max(16, W * settings.leftMargin);
  let right = Math.max(16, W * settings.rightMargin);
  const overflow = left + right + 120 - W;
  if (overflow > 0) { left -= overflow / 2; right -= overflow / 2; }

  textEl.style.fontSize = settings.fontSize + 'px';
  textEl.style.lineHeight = String(1.2 + settings.lineSpacing);
  textEl.style.padding = `0 ${right}px 0 ${left}px`;
  textEl.style.textAlign = settings.centered ? 'center' : 'left';

  P.readingY = H * settings.readingLine;
  const marker = $('marker');
  marker.style.left = Math.max(2, left - 22) + 'px';
  marker.style.top = (P.readingY - 9) + 'px';
  $('guideL').style.left = (left - 1) + 'px';
  $('guideR').style.left = (W - right - 1) + 'px';
  stageEl.style.setProperty('--fade', Math.max(5, (settings.readingLine - 0.04) * 100) + '%');
  stageEl.style.transform = `scale(${settings.mirror ? -1 : 1}, ${settings.flipV ? -1 : 1})`;

  prompterEl.classList.toggle('landscape', window.innerWidth > window.innerHeight);
  prompterEl.classList.toggle('panel-left', settings.panelLeft);

  P.wordMid = P.wordEls.map((el) => el.offsetTop + el.offsetHeight / 2);

  if (keepIdx !== null && P.wordMid.length) {
    P.offset = P.wordMid[keepIdx] - P.readingY;
    renderOffset();
  }
}

/** Mitte der Zeile, in der Wort i steht (alle Wörter einer Zeile haben dieselbe Höhe). */
function yForWord(i) {
  const m = P.wordMid;
  if (!m.length) return 0;
  return m[Math.min(Math.max(i, 0), m.length - 1)];
}

function wordAtReadingLine() {
  const m = P.wordMid, y = P.offset + P.readingY;
  if (!m.length) return 0;
  let lo = 0, hi = m.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (m[mid] < y - 2) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function clampOffset(o) {
  const m = P.wordMid;
  if (!m.length) return o;
  return Math.min(Math.max(o, m[0] - P.readingY - stageEl.clientHeight * 0.25), m[m.length - 1] - P.readingY);
}

let renderedOffset = null;
function renderOffset() {
  if (renderedOffset === P.offset) return;
  renderedOffset = P.offset;
  textEl.style.transform = `translate3d(0, ${-P.offset}px, 0)`;
}

function setHighlight(k) {
  if (k === P.highlighted) return;
  const lo = Math.min(k, P.highlighted) + 1, hi = Math.max(k, P.highlighted);
  const read = k > P.highlighted;
  for (let i = Math.max(lo, 0); i <= hi && i < P.wordEls.length; i++) {
    P.wordEls[i].classList.toggle('read', read);
    for (const el of P.punctEls[i] || []) el.classList.toggle('read', read);
  }
  P.highlighted = k;
  for (const c of P.cueEls) c.classList.toggle('read', Number(c.dataset.after) < k);
}

// ---------- Animation ----------
function frame(now) {
  const dt = P.lastFrame ? Math.min((now - P.lastFrame) / 1000, 0.1) : 1 / 60;
  P.lastFrame = now;
  if (P.active && !P.interacting && P.wordMid.length) {
    if (settings.mode === 'voice') {
      // Zeilenweise: die Zeile des zuletzt gesprochenen Wortes steht am Pfeil (+ optionaler Vorlauf).
      const lineHeight = settings.fontSize * (1.2 + settings.lineSpacing);
      const target = clampOffset(yForWord(P.follower.focus) - P.readingY + settings.leadLines * lineHeight);
      const diff = target - P.offset;
      if (Math.abs(diff) > 0.25) {
        P.offset = Math.abs(diff) > stageEl.clientHeight * 2
          ? target
          : P.offset + diff * (1 - Math.exp(-dt * settings.reaction));
      }
    } else if (P.autoRunning) {
      const next = clampOffset(P.offset + settings.autoSpeed * dt);
      if (next === P.offset) { P.autoRunning = false; updateControls(); }
      P.offset = next;
    }
    renderOffset();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Status-Anzeige regelmäßig auffrischen (Sprech-Punkt, Tempo)
setInterval(() => { if (P.active && settings.mode === 'voice') updateStatus(); }, 250);

// ---------- Interaktion: Ziehen & Tippen ----------
let drag = null;
stageEl.addEventListener('pointerdown', (e) => {
  if (!P.active) return;
  stageEl.setPointerCapture(e.pointerId);
  drag = { y: e.clientY, x: e.clientX, offset: P.offset, moved: false };
  P.interacting = true;
});
stageEl.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dy = (e.clientY - drag.y) * (settings.flipV ? -1 : 1);
  if (Math.abs(dy) > 6 || Math.abs(e.clientX - drag.x) > 6) drag.moved = true;
  if (drag.moved) {
    P.offset = clampOffset(drag.offset - dy);
    renderOffset();
  }
});
const endDrag = (e) => {
  if (!drag) return;
  const wasTap = !drag.moved;
  drag = null;
  P.interacting = false;
  if (wasTap) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (el && el.classList.contains('w')) jumpTo(Number(el.dataset.i));
  } else {
    jumpTo(wordAtReadingLine(), false);
  }
};
stageEl.addEventListener('pointerup', endDrag);
stageEl.addEventListener('pointercancel', endDrag);

let wheelTimer = null;
stageEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  P.interacting = true;
  P.offset = clampOffset(P.offset + e.deltaY);
  renderOffset();
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => { P.interacting = false; jumpTo(wordAtReadingLine(), false); }, 150);
}, { passive: false });

function jumpTo(i, moveView = true) {
  if (settings.mode === 'voice') {
    P.follower.setPosition(i - 1);
  } else if (moveView && P.wordMid[i] !== undefined) {
    P.offset = clampOffset(P.wordMid[i] - P.readingY);
    renderOffset();
  }
}

// ---------- Steuerung ----------
function setMode(mode) {
  if (mode === 'voice' && !SpeechRec) {
    showNotice('Dieser Browser unterstützt keine Spracherkennung.');
    return;
  }
  P.follower?.stop();
  P.autoRunning = false;
  settings.mode = mode;
  saveSettings();
  if (mode === 'auto') setHighlight(-1);
  else if (P.follower) {
    P.follower.setPosition(wordAtReadingLine() - 1);
    setHighlight(P.follower.position);
  }
  updateControls();
}

function updateControls() {
  const voice = settings.mode === 'voice';
  for (const b of $('modeSwitch').children) b.classList.toggle('on', b.dataset.mode === settings.mode);
  const running = voice ? !!P.follower?.listening : P.autoRunning;
  const main = $('btnMain');
  main.classList.toggle('on', running);
  main.innerHTML = voice ? ICONS.mic : (P.autoRunning ? ICONS.pause : ICONS.play);
  main.setAttribute('aria-label', voice ? (running ? 'Zuhören beenden' : 'Zuhören starten') : (running ? 'Pause' : 'Start'));
  $('capsule').classList.toggle('running', running);
  $('speed').hidden = voice;
  $('speed').value = settings.autoSpeed;
  updateStatus();
}

function updateStatus() {
  const f = P.follower;
  const voice = settings.mode === 'voice';
  const statusEl = $('status');
  if (!voice || !f || f.status === 'idle' || f.status === 'error') {
    statusEl.hidden = true;
  } else {
    statusEl.hidden = false;
    $('dot').classList.toggle('on', f.speaking);
    if (f.status === 'starting') {
      $('statusText').textContent = '…';
    } else {
      const pct = Math.round(Math.max(f.position + 1, 0) / Math.max(f.count, 1) * 100);
      $('statusText').textContent = f.wpm ? `${Math.round(f.wpm)}/Min · ${pct} %` : `${pct} %`;
    }
  }
  const notice = $('notice');
  if (voice && f && f.status === 'error') {
    notice.textContent = f.error;
    notice.className = 'error';
    notice.hidden = false;
  } else if (notice.classList.contains('error')) {
    notice.hidden = true;
    notice.className = '';
  }
}

let noticeTimer = null;
function showNotice(text) {
  const n = $('notice');
  n.className = '';
  n.textContent = text;
  n.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { if (!n.classList.contains('error')) n.hidden = true; }, 2200);
}

$('btnClose').onclick = closePrompter;
$('btnTop').onclick = () => {
  P.autoRunning = false;
  P.follower.setPosition(-1);
  P.offset = clampOffset((P.wordMid[0] ?? 0) - P.readingY);
  renderOffset();
  updateControls();
};
$('btnMain').onclick = () => {
  if (settings.mode === 'voice') {
    if (P.follower.listening) P.follower.stop(); else P.follower.start();
  } else {
    P.autoRunning = !P.autoRunning;
  }
  updateControls();
};
$('speed').oninput = (e) => { settings.autoSpeed = Number(e.target.value); saveSettings(); };
for (const b of $('modeSwitch').children) b.onclick = () => setMode(b.dataset.mode);

window.addEventListener('resize', () => applyLayout());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadRepoScripts();
    if (P.active) lockScreen();
  } else {
    P.follower?.stop();
    P.autoRunning = false;
    if (P.active) updateControls();
  }
});

async function lockScreen() {
  try { P.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* nicht unterstützt */ }
}
function releaseScreen() {
  try { P.wakeLock?.release(); } catch { /* egal */ }
  P.wakeLock = null;
}

// ============================================================
// Einstellungs-Panel
// ============================================================
const panel = $('panel');

function openPanel() {
  refreshPanel();
  panel.hidden = false;
  $('bottom').hidden = true;
  prompterEl.classList.add('guides');
}
function closePanel() {
  panel.hidden = true;
  $('bottom').hidden = false;
  prompterEl.classList.remove('guides');
}

function formatOut(key) {
  const v = settings[key];
  switch (key) {
    case 'fontSize': return `${v} pt`;
    case 'leftMargin': case 'rightMargin': return `${Math.round(v * 100)} %`;
    case 'leadLines': return v === 0 ? 'aus' : v === 1 ? '1 Zeile' : `${String(v).replace('.', ',')} Zeilen`;
    case 'pauseDelay': return `${v.toFixed(1).replace('.', ',')} s`;
    default: return String(v);
  }
}

function refreshPanel() {
  for (const el of panel.querySelectorAll('[data-key]')) {
    const v = settings[el.dataset.key];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  }
  for (const out of panel.querySelectorAll('[data-out]')) out.textContent = formatOut(out.dataset.out);
  $('rowMarginBoth').hidden = !settings.linkMargins;
  $('rowMarginL').hidden = settings.linkMargins;
  $('rowMarginR').hidden = settings.linkMargins;
}

panel.addEventListener('input', (e) => {
  const el = e.target;
  const key = el.dataset.key;
  if (!key) return;
  let value = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
  settings[key] = value;
  if (key === 'leftMargin' && (el.dataset.link || settings.linkMargins)) settings.rightMargin = value;
  if (key === 'linkMargins' && value) settings.rightMargin = settings.leftMargin;
  if (key === 'lang' && P.follower?.listening) { P.follower.stop(); P.follower.start(); }
  saveSettings();
  refreshPanel();
  applyLayout();
});
for (const b of panel.querySelectorAll('[data-step]')) {
  b.onclick = () => {
    settings.fontSize = Math.min(120, Math.max(20, settings.fontSize + Number(b.dataset.step)));
    saveSettings();
    refreshPanel();
    applyLayout();
  };
}
$('btnSettings').onclick = () => (panel.hidden ? openPanel() : closePanel());
$('btnPanelDone').onclick = closePanel;
$('btnSwap').onclick = () => { settings.panelLeft = !settings.panelLeft; saveSettings(); applyLayout(); };
$('btnReset').onclick = () => {
  settings = { ...DEFAULTS, mode: settings.mode, autoSpeed: settings.autoSpeed, panelLeft: settings.panelLeft };
  saveSettings();
  refreshPanel();
  applyLayout();
};

// ============================================================
// Start
// ============================================================
renderLibrary();
renderRepoList();
loadRepoScripts();
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
