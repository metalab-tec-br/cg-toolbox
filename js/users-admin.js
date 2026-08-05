// ════════════════════════════════════════════════
// MANAGE USERS — Settings → System → Users (admin-only, ver
// applyAdminGating() em js/auth.js). CRUD de usuários locais + promover/
// rebaixar/desabilitar QUALQUER usuário (inclusive identificado via
// Windows/NTLM) — ver users em server/schema.sql e /api/users em
// server/index.js. Mesmo padrão visual/estrutural de js/api-keys.js.
// ════════════════════════════════════════════════

function _uaEscHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function _uaFormatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p2 = n => String(n).padStart(2, '0');
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

async function renderUserList() {
  const tbody = document.getElementById('userListTbody');
  const empty = document.getElementById('userListEmpty');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="5" class="audit-log-loading">Loading…</td></tr>`;
  if (empty) empty.style.display = 'none';
  let rows = [];
  try {
    const res = await fetch('/api/users');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rows = await res.json();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="audit-log-loading">Failed to load users. Please try again.</td></tr>`;
    return;
  }
  if (!rows.length) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  tbody.innerHTML = rows.map(u => {
    const uname = _uaEscHtml(u.username).replace(/'/g, "&#39;");
    const isAdmin = u.role === 'admin';
    const isDisabled = !!u.disabled;
    return `
    <tr style="${isDisabled ? 'opacity:.5;' : ''}">
      <td>${_uaEscHtml(u.username)}</td>
      <td>${u.is_local ? 'Local' : 'Windows'}</td>
      <td>${isAdmin ? 'Admin' : 'User'}</td>
      <td>${isDisabled ? 'Disabled' : 'Active'}</td>
      <td style="white-space:nowrap;">
        <button type="button" class="btn btn-sm" onclick="toggleUserRole('${uname}', ${isAdmin})">${isAdmin ? 'Make user' : 'Make admin'}</button>
        <button type="button" class="btn btn-sm" onclick="toggleUserDisabled('${uname}', ${isDisabled})">${isDisabled ? 'Enable' : 'Disable'}</button>
        ${u.is_local ? `<button type="button" class="btn btn-sm" onclick="openResetPasswordPrompt('${uname}')">Reset password</button>` : ''}
        <button type="button" class="btn btn-sm" onclick="deleteUserConfirm('${uname}')">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

async function toggleUserRole(username, isCurrentlyAdmin) {
  try {
    const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: isCurrentlyAdmin ? 'user' : 'admin' }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    renderUserList();
  } catch (err) {
    alert(err.message || 'Failed to update role.');
  }
}

async function toggleUserDisabled(username, isCurrentlyDisabled) {
  try {
    const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disabled: !isCurrentlyDisabled }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    renderUserList();
  } catch (err) {
    alert(err.message || 'Failed to update status.');
  }
}

function deleteUserConfirm(username) {
  openConfirmModal(`Delete the user "${username}"? Windows-identified users are recreated automatically (with the default "User" role) the next time they're seen. This cannot be undone.`, { danger: true })
    .then(async ok => {
      if (!ok) return;
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || `HTTP ${res.status}`);
        }
        renderUserList();
      } catch (err) {
        alert(err.message || 'Failed to delete user.');
      }
    });
}

// ── "New local user" ──
function openNewUserPrompt() {
  const u = document.getElementById('newUserUsernameInput');
  const p = document.getElementById('newUserPasswordInput');
  const r = document.getElementById('newUserRoleSelect');
  const err = document.getElementById('newUserErrorMsg');
  if (u) u.value = '';
  if (p) p.value = '';
  if (r) r.value = 'user';
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  const overlay = document.getElementById('newUserOverlay');
  if (overlay) overlay.classList.add('show');
  if (u) setTimeout(() => u.focus(), 0);
}
function closeNewUserPrompt() {
  const overlay = document.getElementById('newUserOverlay');
  if (overlay) overlay.classList.remove('show');
}
async function submitNewUser() {
  const username = (document.getElementById('newUserUsernameInput') || {}).value || '';
  const password = (document.getElementById('newUserPasswordInput') || {}).value || '';
  const role = (document.getElementById('newUserRoleSelect') || {}).value || 'user';
  const err = document.getElementById('newUserErrorMsg');
  if (!username.trim() || password.length < 4) {
    if (err) { err.textContent = 'Username is required and password must be at least 4 characters.'; err.style.display = ''; }
    return;
  }
  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.trim(), password, role }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    closeNewUserPrompt();
    renderUserList();
  } catch (e) {
    if (err) { err.textContent = e.message || 'Failed to create user.'; err.style.display = ''; }
  }
}

// ── "Reset password" (só usuários locais) ──
let _resetPasswordUsername = null;
function openResetPasswordPrompt(username) {
  _resetPasswordUsername = username;
  const title = document.getElementById('resetPasswordTitle');
  const input = document.getElementById('resetPasswordInput');
  const err = document.getElementById('resetPasswordErrorMsg');
  if (title) title.textContent = `Reset password — ${username}`;
  if (input) input.value = '';
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  const overlay = document.getElementById('resetPasswordOverlay');
  if (overlay) overlay.classList.add('show');
  if (input) setTimeout(() => input.focus(), 0);
}
function closeResetPasswordPrompt() {
  const overlay = document.getElementById('resetPasswordOverlay');
  if (overlay) overlay.classList.remove('show');
  _resetPasswordUsername = null;
}
async function submitResetPassword() {
  const password = (document.getElementById('resetPasswordInput') || {}).value || '';
  const err = document.getElementById('resetPasswordErrorMsg');
  if (!_resetPasswordUsername) return;
  if (password.length < 4) {
    if (err) { err.textContent = 'Password must be at least 4 characters.'; err.style.display = ''; }
    return;
  }
  try {
    const res = await fetch(`/api/users/${encodeURIComponent(_resetPasswordUsername)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || `HTTP ${res.status}`);
    }
    closeResetPasswordPrompt();
  } catch (e) {
    if (err) { err.textContent = e.message || 'Failed to reset password.'; err.style.display = ''; }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const newUserOverlay = document.getElementById('newUserOverlay');
  if (newUserOverlay) newUserOverlay.addEventListener('click', ev => { if (ev.target.id === 'newUserOverlay') closeNewUserPrompt(); });
  const resetOverlay = document.getElementById('resetPasswordOverlay');
  if (resetOverlay) resetOverlay.addEventListener('click', ev => { if (ev.target.id === 'resetPasswordOverlay') closeResetPasswordPrompt(); });
});
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  const newUserOverlay = document.getElementById('newUserOverlay');
  if (newUserOverlay && newUserOverlay.classList.contains('show')) closeNewUserPrompt();
  const resetOverlay = document.getElementById('resetPasswordOverlay');
  if (resetOverlay && resetOverlay.classList.contains('show')) closeResetPasswordPrompt();
});

// Carrega a lista quando a aba "System" do modal de Configurações é aberta —
// mesmo padrão de wrap de switchSettingsPane usado em js/api-keys.js (os dois
// wraps se empilham sem conflito, cada um chamando o anterior).
if (typeof switchSettingsPane === 'function') {
  const _uaOrigSwitchSettingsPane = switchSettingsPane;
  switchSettingsPane = function (pane) {
    _uaOrigSwitchSettingsPane(pane);
    if (pane === 'system') renderUserList();
  };
}
