'use strict';
// Abgleich gesprochener Wörter mit dem Skript (Port aus der iOS-App).

const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const CUE_RE = /\[[^\]]*\]/g;

function normalize(s) {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
}

/** Teilt den Skripttext in Wörter, Regieanweisungen [..] und Zwischenraum. */
function tokenize(text) {
  const parts = []; // {type: 'word'|'cue'|'space', text, index?}
  const words = []; // normalisierte Wörter
  let last = 0;
  const pushPlain = (chunk) => {
    let p = 0;
    for (const m of chunk.matchAll(WORD_RE)) {
      if (m.index > p) parts.push({ type: 'space', text: chunk.slice(p, m.index) });
      const norm = normalize(m[0]);
      if (norm) {
        parts.push({ type: 'word', text: m[0], index: words.length });
        words.push(norm);
      } else {
        parts.push({ type: 'space', text: m[0] });
      }
      p = m.index + m[0].length;
    }
    if (p < chunk.length) parts.push({ type: 'space', text: chunk.slice(p) });
  };
  for (const m of text.matchAll(CUE_RE)) {
    pushPlain(text.slice(last, m.index));
    parts.push({ type: 'cue', text: m[0], after: words.length - 1 });
    last = m.index + m[0].length;
  }
  pushPlain(text.slice(last));
  return { parts, words };
}

function spokenTokens(transcript) {
  return transcript.split(/[\s\-–]+/).map(normalize).filter(Boolean);
}

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let cur = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

function similarity(a, b) {
  if (a === b) return 1;
  const la = [...a].length, lb = [...b].length;
  if (Math.min(la, lb) <= 2) return 0;
  if (Math.min(la, lb) >= 5 && (a.startsWith(b) || b.startsWith(a))) return 0.75;
  if (Math.abs(la - lb) > Math.floor(Math.max(la, lb) / 2)) return 0;
  return 1 - levenshtein([...a], [...b]) / Math.max(la, lb);
}

class ScriptMatcher {
  constructor(words) {
    this.words = words;
    this.threshold = 0.7;
  }

  /** Rückwärts-Abgleich der gesprochenen Wörter mit dem Skript, das bei `end` endet. */
  align(spoken, end) {
    const T = this.threshold, w = this.words;
    let i = spoken.length - 1, s = end, score = 0, matched = 0, recent = 0, misses = 0;
    const recentLimit = spoken.length - 3;
    while (i >= 0 && s >= 0 && misses <= 2) {
      const sim = similarity(spoken[i], w[s]);
      if (sim >= T) {
        score += sim; matched++;
        if (i >= recentLimit) recent++;
        i--; s--;
      } else if (i > 0 && similarity(spoken[i - 1], w[s]) >= T) {
        i--; misses++; score -= 0.3;       // zusätzliches Wort gesprochen
      } else if (s > 0 && similarity(spoken[i], w[s - 1]) >= T) {
        s--; misses++; score -= 0.3;       // Wort im Skript ausgelassen
      } else {
        i--; s--; misses++; score -= 0.5;  // falsch erkannt
      }
    }
    return { index: end, matched, recent, score };
  }

  /**
   * @param allowBack  false = nur vorwärts (Zurück nur per Sprachbefehl/Antippen)
   * @returns {{match, isJump}|null}
   */
  locate(spoken, current, allowBack = true) {
    const w = this.words;
    if (!spoken.length || !w.length) return null;
    const tail = spoken.slice(-8);
    const last = tail[tail.length - 1];
    const cur = Math.max(current, 0);
    // Nur-vorwärts-Modus: kleines Suchfenster, weite Sprünge brauchen mehr Übereinstimmung.
    const lo = allowBack ? Math.max(0, cur - 20) : Math.max(0, current);
    const hi = Math.min(w.length - 1, cur + (allowBack ? 40 : 15));
    const recentNeeded = Math.min(2, tail.length);
    const distPenalty = allowBack ? 0.04 : 0.15;

    // 1) Lokal rund um die aktuelle Position
    let bestLocal = null, bestValue = -Infinity;
    for (let j = lo; j <= hi; j++) {
      if (similarity(last, w[j]) < this.threshold) continue;
      const m = this.align(tail, j);
      if (m.recent < recentNeeded && tail.length > 1) continue;
      const dist = j - current;
      let ok;
      if (dist < 0) ok = m.matched >= 3;
      else if (dist <= 4 || allowBack) ok = m.matched >= 2 || (dist <= 3 && [...w[j]].length >= 4);
      else ok = m.matched >= 3 && m.recent >= Math.min(3, tail.length) && m.score >= 2.6;
      if (!ok) continue;
      const value = m.score - Math.abs(dist) * distPenalty - (dist < 0 ? 0.5 : 0);
      if (value > bestValue) { bestValue = value; bestLocal = m; }
    }

    // 1b) Aufholen: nichts in der Nähe gefunden → weiter vorne suchen, aber nur bei klarer Übereinstimmung.
    if (!bestLocal && !allowBack && tail.length >= 4) {
      const far = Math.min(w.length - 1, cur + 45);
      for (let j = hi + 1; j <= far; j++) {
        if (similarity(last, w[j]) < this.threshold) continue;
        const m = this.align(tail, j);
        if (m.matched < 5 || m.recent < 3 || m.score < 4.3) continue;
        if (!bestLocal || m.score - (j - current) * 0.01 > bestValue) {
          bestValue = m.score - (j - current) * 0.01;
          bestLocal = m;
        }
      }
    }

    // 2) Global: von vorne angefangen oder weit gesprungen? (nur wenn Zurückspringen erlaubt)
    if (allowBack && tail.length >= 3) {
      let bestGlobal = null;
      for (let j = 0; j < w.length; j++) {
        if (j <= hi && (j >= lo || !allowBack)) continue;
        if (similarity(last, w[j]) < this.threshold) continue;
        const m = this.align(tail, j);
        if (m.recent < 3) continue;
        const strong = (m.matched >= 4 && m.score >= 3.4)
          || (j < 12 && m.matched >= 3 && m.score >= 2.6 && m.matched >= Math.min(tail.length, j + 1));
        if (strong && (!bestGlobal || m.score > bestGlobal.score)) bestGlobal = m;
      }
      if (bestGlobal && bestGlobal.score > (bestLocal ? bestLocal.score : 0) + 1.0) {
        return { match: bestGlobal, isJump: true };
      }
    }
    if (!bestLocal) return null;
    return { match: bestLocal, isJump: bestLocal.index < current - 3 };
  }
}

/**
 * Sucht einen Sprachbefehl „Teleprompter Anfang / zurück / weiter“ in den Wörtern.
 * @returns {{command: 'start'|'back'|'next', end: number}|null}  end = Index nach dem Befehl
 */
function findCommand(tokens) {
  const words = {
    start: ['anfang', 'vorne', 'start', 'beginn'],
    back: ['zuruck', 'zurueck', 'nochmal'],
    next: ['weiter', 'nachster', 'nachsten', 'vor'],
  };
  for (let i = 0; i < tokens.length; i++) {
    if (similarity(tokens[i], 'teleprompter') < 0.7 && tokens[i] !== 'prompter') continue;
    for (let k = i + 1; k <= i + 3 && k < tokens.length; k++) {
      for (const [command, list] of Object.entries(words)) {
        if (list.includes(tokens[k])) return { command, end: k + 1 };
      }
    }
  }
  return null;
}

if (typeof module !== 'undefined') module.exports = { tokenize, spokenTokens, ScriptMatcher, normalize, findCommand };
