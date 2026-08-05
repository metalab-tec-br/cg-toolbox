// ════════════════════════════════════════════════
// API KEYS — seção "API access" na aba System do modal de Configurações (ver
// #apiKeyListWrap em index.html). Permite criar/revogar chaves usadas por
// integrações externas para chamar a API (header `X-API-Key`, ver api_keys
// em server/schema.sql e o middleware de autenticação em server/index.js).
//
// A key em texto puro só é devolvida pela API no momento da criação (POST
// /api/api-keys) — depois disso só o hash fica guardado no banco, então só
// dá pra mostrar de novo o "prefixo" (primeiros caracteres, só para
// identificação visual na lista). Por isso o fluxo aqui é: criar -> mostrar
// a key completa uma única vez, com aviso claro para copiar agora -> a
// lista passa a mostrar só o prefixo dali em diante.
// ════════════════════════════════════════════════

function _akEscHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _akFormatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p2 = n => String(n).padStart(2, '0');
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

async function renderApiKeyList() {
  const tbody = document.getElementById('apiKeyListTbody');
  const empty = document.getElementById('apiKeyListEmpty');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="audit-log-loading">Loading…</td></tr>`;
  if (empty) empty.style.display = 'none';
  let rows = [];
  try {
    const res = await fetch('/api/api-keys');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rows = await res.json();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="audit-log-loading">Failed to load API keys. Please try again.</td></tr>`;
    return;
  }
  if (!rows.length) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr style="${r.revoked_at ? 'opacity:.5;' : ''}">
      <td>${_akEscHtml(r.name)}</td>
      <td><code>${_akEscHtml(r.key_prefix)}…</code></td>
      <td>${_akEscHtml(r.created_by || '—')}</td>
      <td>${_akEscHtml(_akFormatDate(r.created_at))}</td>
      <td>${_akEscHtml(_akFormatDate(r.last_used_at))}</td>
      <td>
        ${r.revoked_at
          ? '<span class="set-hint">Revoked</span>'
          : `<button type="button" class="btn btn-sm" onclick="revokeApiKey(${r.id}, '${String(r.name).replace(/'/g, "\\'")}')">Revoke</button>`}
      </td>
    </tr>
  `).join('');
}

// ── "New API key" (nome) — modal próprio no lugar do prompt() nativo do
// navegador, mesmo padrão visual/classes de confirmOverlay (ver
// js/confirm-modal.js e #apiKeyNameOverlay em index.html). ──
function openNewApiKeyPrompt() {
  const input = document.getElementById('apiKeyNameInput');
  if (input) input.value = '';
  const overlay = document.getElementById('apiKeyNameOverlay');
  if (overlay) overlay.classList.add('show');
  if (input) setTimeout(() => input.focus(), 0);
}

function closeApiKeyNamePrompt() {
  const overlay = document.getElementById('apiKeyNameOverlay');
  if (overlay) overlay.classList.remove('show');
}

function submitApiKeyNamePrompt() {
  const input = document.getElementById('apiKeyNameInput');
  const name = input ? input.value.trim() : '';
  if (!name) { if (input) input.focus(); return; }
  closeApiKeyNamePrompt();
  createApiKey(name);
}

document.addEventListener('DOMContentLoaded', () => {
  const nameOverlay = document.getElementById('apiKeyNameOverlay');
  if (nameOverlay) nameOverlay.addEventListener('click', ev => { if (ev.target.id === 'apiKeyNameOverlay') closeApiKeyNamePrompt(); });
  const nameInput = document.getElementById('apiKeyNameInput');
  if (nameInput) nameInput.addEventListener('keydown', ev => { if (ev.key === 'Enter') submitApiKeyNamePrompt(); });
  const revealOverlay = document.getElementById('apiKeyRevealOverlay');
  if (revealOverlay) revealOverlay.addEventListener('click', ev => { if (ev.target.id === 'apiKeyRevealOverlay') closeApiKeyRevealModal(); });
});
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  const nameOverlay = document.getElementById('apiKeyNameOverlay');
  if (nameOverlay && nameOverlay.classList.contains('show')) closeApiKeyNamePrompt();
  const revealOverlay = document.getElementById('apiKeyRevealOverlay');
  if (revealOverlay && revealOverlay.classList.contains('show')) closeApiKeyRevealModal();
});

// ── "API key created" (reveal, uma única vez) — mesmo padrão. ──
function openApiKeyRevealModal(keyValue) {
  const input = document.getElementById('apiKeyRevealInput');
  if (input) input.value = keyValue;
  const copyBtn = document.getElementById('apiKeyRevealCopyBtn');
  if (copyBtn) copyBtn.textContent = 'Copy';
  const overlay = document.getElementById('apiKeyRevealOverlay');
  if (overlay) overlay.classList.add('show');
}

function closeApiKeyRevealModal() {
  const overlay = document.getElementById('apiKeyRevealOverlay');
  if (overlay) overlay.classList.remove('show');
}

// Reaproveita o helper de cópia já usado nos botões "Copy" das linhas de
// comando (ver js/terminal-renderer.js: _copyToClipboard) — funciona tanto
// via Clipboard API (HTTPS/localhost) quanto via execCommand (HTTP puro).
function copyApiKeyReveal() {
  const input = document.getElementById('apiKeyRevealInput');
  const btn = document.getElementById('apiKeyRevealCopyBtn');
  if (!input) return;
  const copy = (typeof _copyToClipboard === 'function') ? _copyToClipboard(input.value) : Promise.reject(new Error('no clipboard helper'));
  copy.then(() => {
    if (!btn) return;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  }).catch(() => {
    input.focus();
    input.select();
  });
}

async function createApiKey(name) {
  try {
    const res = await fetch('/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    renderApiKeyList();
    // A key completa só existe AQUI — nunca mais é recuperável depois disso.
    openApiKeyRevealModal(data.key);
  } catch (err) {
    alert('Failed to create API key. Please try again.');
    console.error('Create API key failed', err);
  }
}

function revokeApiKey(id, name) {
  openConfirmModal(`Revoke the API key "${name}"? Any integration still using it will stop working immediately. This cannot be undone.`, { danger: true })
    .then(async ok => {
      if (!ok) return;
      try {
        const res = await fetch(`/api/api-keys/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        renderApiKeyList();
      } catch (err) {
        alert('Failed to revoke API key. Please try again.');
        console.error('Revoke API key failed', err);
      }
    });
}

// Carrega a lista quando a aba "System" do modal de Configurações é aberta.
// switchSettingsPane() (js/settings-modal.js) já existe antes deste arquivo
// ser carregado (ver ordem dos <script> em index.html) — envolve a função
// original para disparar renderApiKeyList() sem duplicar a lógica de troca
// de aba.
if (typeof switchSettingsPane === 'function') {
  const _akOrigSwitchSettingsPane = switchSettingsPane;
  switchSettingsPane = function (pane) {
    _akOrigSwitchSettingsPane(pane);
    if (pane === 'system') renderApiKeyList();
  };
}
