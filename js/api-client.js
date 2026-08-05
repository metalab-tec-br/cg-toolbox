// ════════════════════════════════════════════════
// API CLIENT — talks to the Express/SQLite backend (server/index.js) that now
// serves the command catalog. The app is always served BY that same server
// (no more file:// usage), so relative URLs ("/api/commands") work as-is.
// ════════════════════════════════════════════════

// Caches the catalog fetch — avoids re-fetching on every render() (render()
// runs on nearly every keystroke). Invalidated on create/update/delete.
let _commandsCache = null; // Promise<Array<command>> | null

function invalidateCommandsCache() {
  _commandsCache = null;
}

async function fetchCommands() {
  if (_commandsCache) return _commandsCache;
  const promise = fetch('/api/commands')
    .then(res => {
      if (!res.ok) throw new Error(`fetchCommands: HTTP ${res.status}`);
      return res.json();
    })
    .catch(err => {
      _commandsCache = null; // don't cache a failed fetch — allow retry on next render()
      throw err;
    });
  _commandsCache = promise;
  return promise;
}

// Cria um comando novo (inclusive via "Duplicate command", que também passa
// por aqui — ver js/command-editor.js). Atribuído ao usuário atual
// (created_by, ver server/index.js) por padrão. `asSystem` (opcional) manda o
// header X-Save-As-System — só é honrado pelo servidor se o chamador for
// admin (ver POST /api/commands em server/index.js); usado hoje só pelo
// checkbox admin-only "Import as System commands" em js/csv-import.js.
async function createCommand(payload, asSystem) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (asSystem) headers['X-Save-As-System'] = '1';
    const res = await fetch('/api/commands', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`createCommand: HTTP ${res.status} — ${body.message || ''}`);
    }
    return await res.json();
  } finally {
    invalidateCommandsCache();
  }
}

// Edita um comando existente. Qualquer usuário pode editar comandos de
// qualquer OUTRO usuário, mas comandos de referência (created_by='System')
// só podem ser editados por admins — usuário comum recebe 403 forbidden
// (ver PUT /api/commands/:id em server/index.js; a UI já esconde o botão
// Edit nesse caso, ver js/terminal-renderer.js). Cada alteração é registrada
// no log de auditoria (audit_log, GET /api/audit-log).
async function updateCommand(id, payload) {
  try {
    const res = await fetch(`/api/commands/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`updateCommand: HTTP ${res.status} — ${body.message || ''}`);
    }
    return await res.json();
  } finally {
    invalidateCommandsCache();
  }
}

// Default(s) definidos pelo administrador (ver comentário em server/index.js:
// GET/PUT /api/global-settings). Sem uso no momento no front-end — o único
// consumidor era o toggle "Show System commands by default" (Settings →
// System), removido a pedido do usuário (ver applyGlobalDefaultsIfNeeded em
// js/settings.js, agora fixo em `false`). Mantido aqui (front e back) porque
// o formato {chave: valor} genérico serve para outros defaults futuros sem
// mudar a API.
async function fetchGlobalSettings() {
  const res = await fetch('/api/global-settings');
  if (!res.ok) throw new Error(`fetchGlobalSettings: HTTP ${res.status}`);
  return res.json();
}
async function saveGlobalSettings(payload) {
  const res = await fetch('/api/global-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`saveGlobalSettings: HTTP ${res.status}`);
}

async function deleteCommand(id) {
  try {
    const res = await fetch(`/api/commands/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`deleteCommand: HTTP ${res.status} — ${body.message || ''}`);
    }
    return true;
  } finally {
    invalidateCommandsCache();
  }
}
