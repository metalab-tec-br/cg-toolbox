// ════════════════════════════════════════════════
// LOGIN LOCAL — permite trocar a identificação automática por login do
// Windows (NTLM) por uma conta local (usuário/senha), sem fechar o
// navegador. Ver server/index.js: POST /api/auth/login, POST /api/auth/logout,
// GET /api/me (agora devolve também role/isAdmin/authMethod), e users/sessions
// em server/schema.sql.
//
// window.CG_IS_ADMIN / window.CG_AUTH_METHOD são preenchidos por
// updateAccountUI(), chamada a partir de js/user-sync.js assim que /api/me
// responde (e de novo depois de login/logout bem-sucedidos) — outros
// arquivos (js/command-editor.js, js/settings-modal.js) leem
// window.CG_IS_ADMIN para decidir o que mostrar/esconder.
// ════════════════════════════════════════════════
window.CG_IS_ADMIN = false;
window.CG_AUTH_METHOD = 'ntlm';

// Atualiza o rótulo do usuário no header, o texto do dropdown de conta
// (role atual + botão Log out só quando a sessão ativa é local) e dispara a
// re-aplicação do gate de admin no resto da UI (ver js/user-sync.js).
function updateAccountUI(me) {
  if (!me) return;
  window.CG_IS_ADMIN = !!me.isAdmin;
  window.CG_AUTH_METHOD = me.authMethod || 'ntlm';

  const roleLine = document.getElementById('hdrUserRoleLine');
  if (roleLine) {
    const roleLabel = me.isAdmin ? 'Admin' : 'User';
    const methodLabel = me.authMethod === 'local' ? 'local account' : (me.authMethod === 'api_key' ? 'API key' : 'Windows login');
    roleLine.textContent = `${roleLabel} — signed in via ${methodLabel}`;
  }
  const logoutBtn = document.getElementById('hdrLogoutBtn');
  if (logoutBtn) logoutBtn.style.display = (me.authMethod === 'local') ? '' : 'none';

  if (typeof applyAdminGating === 'function') applyAdminGating();
}

// Esconde por completo os grupos/abas admin-only de Settings (Database:
// Backup & Restore/View audit log; API access — dentro de System; e a aba
// própria "Users", ver #usersNavBtn em index.html) para quem não é admin — a
// API já recusa essas chamadas com 403 de qualquer forma (ver requireAdmin()
// em server/index.js), isto é só para não mostrar controles que vão falhar.
// "Export/Import commands" fica de fora de propósito — não é admin-only (ver
// escopo do pedido original). Exceção dentro do próprio Import: o checkbox
// "Import as System commands" (importAsSystemRow) — ver js/csv-import.js —
// que aparece só para admins.
const ADMIN_ONLY_SETTINGS_GROUP_IDS = ['sysGroupDatabase', 'sysGroupApiAccess', 'usersNavBtn', 'importAsSystemRow'];
function applyAdminGating() {
  ADMIN_ONLY_SETTINGS_GROUP_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = window.CG_IS_ADMIN ? '' : 'none';
  });
}

// ── Dropdown de conta (header) — abre/fecha via toggleDropdown('hdrUserDD'),
// já genérico (ver js/state.js). Só precisamos fechar o dropdown ao abrir o
// modal de login, para não ficarem os dois sobrepostos. ──
function openLoginModal() {
  const dd = document.getElementById('hdrUserDD');
  if (dd) dd.classList.remove('open');
  const userInput = document.getElementById('loginUsernameInput');
  const passInput = document.getElementById('loginPasswordInput');
  const errBox = document.getElementById('loginErrorMsg');
  if (userInput) userInput.value = '';
  if (passInput) passInput.value = '';
  if (errBox) { errBox.style.display = 'none'; errBox.textContent = ''; }
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.classList.add('show');
  if (userInput) setTimeout(() => userInput.focus(), 0);
}
function closeLoginModal() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.classList.remove('show');
}

async function submitLogin() {
  const username = (document.getElementById('loginUsernameInput') || {}).value || '';
  const password = (document.getElementById('loginPasswordInput') || {}).value || '';
  const errBox = document.getElementById('loginErrorMsg');
  const btn = document.getElementById('loginSubmitBtn');
  if (!username.trim() || !password) {
    if (errBox) { errBox.textContent = 'Enter both username and password.'; errBox.style.display = ''; }
    return;
  }
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Invalid username or password.');
    }
    closeLoginModal();
    // Recarrega a página inteira — mais simples e seguro do que tentar
    // re-hidratar favoritos/preferências/gate de admin ao vivo para o usuário
    // novo, e garante que tudo (inclusive o front-end sync de user-data)
    // parte do zero para a identidade certa.
    location.reload();
  } catch (err) {
    if (errBox) { errBox.textContent = err.message || 'Login failed. Please try again.'; errBox.style.display = ''; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function authLogout() {
  const dd = document.getElementById('hdrUserDD');
  if (dd) dd.classList.remove('open');
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    console.error('Logout failed (continuing to reload anyway):', e);
  }
  location.reload();
}

document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.addEventListener('click', ev => { if (ev.target.id === 'loginOverlay') closeLoginModal(); });
  const passInput = document.getElementById('loginPasswordInput');
  if (passInput) passInput.addEventListener('keydown', ev => { if (ev.key === 'Enter') submitLogin(); });
});
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  const overlay = document.getElementById('loginOverlay');
  if (overlay && overlay.classList.contains('show')) closeLoginModal();
});
