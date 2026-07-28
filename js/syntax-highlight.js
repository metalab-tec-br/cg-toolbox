// ════════════════════════════════════════════════
// SAFE SYNTAX HIGHLIGHT
// Tokenises the command string into labelled spans.
// Rule: content inside double-quoted strings is NEVER tokenised further —
// it's emitted as-is inside a k-str span.
// Only the actual "variables" (values resolved from {{token}} placeholders —
// see markVar()/VAR_OPEN/VAR_CLOSE in db-render-engine.js) get their own
// colour (k-var); literal command syntax (command names, flags, paths, pipes,
// quoted strings, numbers) is rendered as plain text — see components.css.
// ════════════════════════════════════════════════

// Sentinel control chars db-render-engine.js wraps around a resolved
// parameter value so safeHL() can single it out as a "variable" span without
// re-tokenising its contents (same idea as the '"' quoted-string rule below).
// They never appear in real command text, so this is unambiguous.
const VAR_OPEN = '\x01', VAR_CLOSE = '\x02';
// Strips the sentinel markers back out — used wherever the marked-up text is
// copied verbatim instead of rendered (e.g. the clipboard "copy" button).
function stripVarMarkers(s) {
  return typeof s === 'string' ? s.replace(/[\x01\x02]/g, '') : s;
}

const CMD_WORDS = new Set([
  'fw','fw6','g_fw','fwaccel','g_fwaccel','tcpdump','cpstat','cpview',
  'cphaprob','vsenv','vsx','mdsenv','mdsstat','asg_cmd','asg_cpstat',
  'asg','g_all','g_allc','cpinfo','cpconfig','clusterXL_admin',
  'netstat','ip','arp','cpstart','cpstop','cprestart','cpwd_admin',
  'fwm','service','cat','ls','tail','grep','vi','clish','gclish',
  'fwm','logexport','show','set','save','reboot','asg_cp2blades',
]);

function safeHL(raw) {
  // We tokenise character-by-character so we never misparse quoted regions.
  const out = [];
  let i = 0;
  const len = raw.length;

  function peek() { return i < len ? raw[i] : ''; }
  function eat() { return raw[i++]; }

  function esc(text) {
    return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function flushText(text) {
    if (!text) return;
    out.push(esc(text));
  }
  function span(cls, text) {
    out.push(`<span class="${cls}">${esc(text)}</span>`);
  }

  while (i < len) {
    const ch = raw[i];

    // ── marked variable (db-render-engine.js wraps resolved {{token}}
    // values in VAR_OPEN/VAR_CLOSE) — grabbed whole, never re-tokenised, so
    // e.g. a quote-wrapped filter value inside doesn't get mistaken for a
    // literal k-str. This must come before the '"' rule below for that reason.
    if (ch === VAR_OPEN) {
      let s = ''; i++;
      while (i < len && raw[i] !== VAR_CLOSE) s += raw[i++];
      if (i < len) i++; // skip the closing marker
      span('k-var', s);
      continue;
    }

    // ── quoted string ─────────────────────────────
    // Content inside "..." is never re-tokenised as flags/paths/etc. — it's
    // rendered flat as k-str. The one exception is a resolved {{token}} value
    // (wrapped in VAR_OPEN/VAR_CLOSE by markVar(), e.g. fw monitor's
    // `"accept host({{src_ip}}) ..."` template): those bytes must still become
    // a nested k-var span instead of leaking into the page as literal control
    // characters (\x01/\x02), which is what happened before this fix — they
    // rendered as a garbled/invisible glyph right where the IP should show.
    if (ch === '"') {
      i++;
      let html = '"';
      while (i < len && raw[i] !== '"') {
        if (raw[i] === VAR_OPEN) {
          i++;
          let v = '';
          while (i < len && raw[i] !== VAR_CLOSE) v += raw[i++];
          if (i < len) i++; // skip VAR_CLOSE
          html += `<span class="k-var">${esc(v)}</span>`;
        } else {
          let s = '';
          while (i < len && raw[i] !== '"' && raw[i] !== VAR_OPEN) s += raw[i++];
          html += esc(s);
        }
      }
      if (i < len) { html += '"'; i++; }
      out.push(`<span class="k-str">${html}</span>`);
      continue;
    }

    // ── $VAR ──────────────────────────────────────
    if (ch === '$') {
      let s = '$'; i++;
      while (i < len && /[\w]/.test(raw[i])) s += raw[i++];
      // handle ${...}
      if (s === '$' && peek() === '{') {
        s += '{'; i++;
        while (i < len && raw[i] !== '}') s += raw[i++];
        if (i < len) { s += '}'; i++; }
      }
      span('k-env', s);
      continue;
    }

    // ── /path ──────────────────────────────────────
    if (ch === '/' && (i === 0 || /\s/.test(raw[i-1]))) {
      let s = '/'; i++;
      while (i < len && !/\s|;|"'|&|\|/.test(raw[i])) s += raw[i++];
      span('k-path', s);
      continue;
    }

    // ── pipe / redirect / semicolon ────────────────
    if ('|>&;'.includes(ch)) {
      span('k-pipe', ch); i++;
      continue;
    }

    // ── flag: -something ──────────────────────────
    if (ch === '-' && i > 0 && /\s/.test(raw[i-1])) {
      let s = '-'; i++;
      while (i < len && /[a-zA-Z0-9_\-]/.test(raw[i])) s += raw[i++];
      // only colour if it's actually a flag (not a lone dash)
      if (s.length > 1) { span('k-flag', s); continue; }
      flushText(s); continue;
    }

    // ── word ──────────────────────────────────────
    if (/[a-zA-Z_]/.test(ch)) {
      let s = ''; let start = i;
      while (i < len && /[a-zA-Z0-9_\.\-]/.test(raw[i])) s += raw[i++];
      // check if it's a known command word at start-of-line or after whitespace
      const prev = start > 0 ? raw[start-1] : ' ';
      if (CMD_WORDS.has(s) && /\s|;|^/.test(prev)) {
        span('k-cmd', s);
      } else {
        flushText(s);
      }
      continue;
    }

    // ── standalone number ─────────────────────────
    if (/[0-9]/.test(ch) && (i === 0 || /\s/.test(raw[i-1]))) {
      let s = ''; 
      while (i < len && /[0-9\.]/.test(raw[i])) s += raw[i++];
      // don't colour IPs as numbers; just emit
      flushText(s);
      continue;
    }

    // ── everything else ───────────────────────────
    out.push(raw[i] === '<' ? '&lt;' : raw[i] === '>' ? '&gt;' : raw[i] === '&' ? '&amp;' : raw[i]);
    i++;
  }

  return out.join('');
}

