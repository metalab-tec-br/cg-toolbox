// ════════════════════════════════════════════════
// BACKUP & RESTORE — modal aberto pelo botão "🗄️ Backup & Restore" no rodapé
// do modal de Configurações (só visível com Admin mode ligado — ver
// body.hide-command-editing #backupManagerBtn em components.css). Cobre:
//   1) Backup manual (POST /api/backups) — cópia .db consistente e completa,
//      criada com Database#backup() (better-sqlite3) sem parar o servidor.
//   2) Agendamento diário/semanal/mensal (GET/PUT /api/backup-schedule) — o
//      servidor checa a cada minuto (ver server/index.js: checkScheduledBackup).
//   3) Lista de backups existentes com baixar/restaurar
//      (GET /api/backups, GET /api/backups/:file/download,
//      POST /api/backups/:file/restore).
//
// Restaurar substitui o commands.db atual pelo backup escolhido e reinicia o
// serviço (ver comentário em server/index.js) — por isso passa por
// openConfirmModal() antes, com aviso claro de que a página vai recarregar.
// ════════════════════════════════════════════════

let _backupScheduleState = { enabled: false, frequency: 'daily', weeklyDays: [], monthlyDay: 1, time: '02:00' };

function _bkEscHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _bkFormatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p2 = n => String(n).padStart(2, '0');
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

function _bkFormatSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

function openBackupManagerModal() {
  const overlay = document.getElementById('backupManagerOverlay');
  if (!overlay) return;
  overlay.classList.add('show');
  const status = document.getElementById('backupNowStatus');
  if (status) status.textContent = '';
  const schedStatus = document.getElementById('backupScheduleStatus');
  if (schedStatus) schedStatus.textContent = '';
  renderBackupList();
  loadBackupSchedule();
}

function closeBackupManagerModal() {
  const overlay = document.getElementById('backupManagerOverlay');
  if (overlay) overlay.classList.remove('show');
}

// Click-outside-to-close + Escape, mesmo padrão de audit-log.js/catalog-admin.js.
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('backupManagerOverlay');
  if (overlay) overlay.addEventListener('click', ev => { if (ev.target.id === 'backupManagerOverlay') overlay.classList.remove('show'); });
});
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  const overlay = document.getElementById('backupManagerOverlay');
  if (overlay) overlay.classList.remove('show');
});

async function renderBackupList() {
  const tbody = document.getElementById('backupListTbody');
  const empty = document.getElementById('backupListEmpty');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="4" class="audit-log-loading">Loading…</td></tr>`;
  if (empty) empty.style.display = 'none';
  let rows = [];
  try {
    const res = await fetch('/api/backups');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rows = await res.json();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="audit-log-loading">Failed to load the backup list. Please try again.</td></tr>`;
    return;
  }
  if (!rows.length) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = '';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${_bkEscHtml(r.filename)}</td>
      <td>${_bkEscHtml(_bkFormatDate(r.createdAt))}</td>
      <td>${_bkEscHtml(_bkFormatSize(r.sizeBytes))}</td>
      <td style="white-space:nowrap;display:flex;gap:6px;">
        <a class="btn btn-sm" href="/api/backups/${encodeURIComponent(r.filename)}/download" download>⬇️ Download</a>
        <button type="button" class="btn btn-sm" onclick="restoreBackup('${r.filename.replace(/'/g, "\\'")}')">♻️ Restore</button>
      </td>
    </tr>
  `).join('');
}

async function backupNow() {
  const btn = document.getElementById('backupNowBtn');
  const status = document.getElementById('backupNowStatus');
  if (btn) btn.disabled = true;
  if (status) status.textContent = 'Creating backup…';
  try {
    const res = await fetch('/api/backups', { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (status) status.textContent = `Backup created: ${data.filename}`;
    renderBackupList();
  } catch (err) {
    if (status) status.textContent = 'Backup failed. Please try again.';
    console.error('Backup now failed', err);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function restoreBackup(filename) {
  openConfirmModal(
    `Restore "${filename}"? This replaces the current database with this backup's contents. A safety copy of the current database is taken automatically first. The server will restart and the page will need to be reloaded.`,
    { danger: true }
  ).then(async ok => {
    if (!ok) return;
    try {
      const res = await fetch(`/api/backups/${encodeURIComponent(filename)}/restore`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      alert(data.message || 'Restore complete. The server is restarting — reload the page in a few seconds.');
    } catch (err) {
      alert('Restore failed. Please try again.');
      console.error('Restore failed', err);
    }
  });
}

// ─── Agendamento ──────────────────────────────────────────────
function _bkSetFreqUI(freq) {
  document.querySelectorAll('#backupFreq .seg-btn').forEach(b => b.classList.toggle('on', b.dataset.val === freq));
  const label = document.getElementById('backupFreqLabel');
  if (label) label.textContent = freq === 'weekly' ? 'Weekly' : freq === 'monthly' ? 'Monthly' : 'Daily';
  const weeklyRow = document.getElementById('backupWeeklyRow');
  const monthlyRow = document.getElementById('backupMonthlyRow');
  if (weeklyRow) weeklyRow.style.display = freq === 'weekly' ? '' : 'none';
  if (monthlyRow) monthlyRow.style.display = freq === 'monthly' ? '' : 'none';
}

function setBackupFrequency(freq) {
  _backupScheduleState.frequency = freq;
  _bkSetFreqUI(freq);
  toggleDropdown('backupFreqDD');
}

function toggleBackupWeeklyDay(day) {
  const idx = _backupScheduleState.weeklyDays.indexOf(day);
  if (idx >= 0) _backupScheduleState.weeklyDays.splice(idx, 1);
  else _backupScheduleState.weeklyDays.push(day);
  const btn = document.querySelector(`#backupWeeklyDays .seg-btn[data-day="${day}"]`);
  if (btn) btn.classList.toggle('on', _backupScheduleState.weeklyDays.includes(day));
}

function _bkApplyScheduleUI() {
  const s = _backupScheduleState;
  const toggle = document.getElementById('backupScheduleToggle');
  const options = document.getElementById('backupScheduleOptions');
  if (toggle) toggle.classList.toggle('on', s.enabled);
  if (options) options.style.opacity = s.enabled ? '1' : '.45';
  if (options) options.style.pointerEvents = s.enabled ? '' : 'none';
  _bkSetFreqUI(s.frequency);
  document.querySelectorAll('#backupWeeklyDays .seg-btn').forEach(b => {
    b.classList.toggle('on', s.weeklyDays.includes(Number(b.dataset.day)));
  });
  const monthlyDayInput = document.getElementById('backupMonthlyDay');
  if (monthlyDayInput) monthlyDayInput.value = s.monthlyDay;
  const timeInput = document.getElementById('backupScheduleTime');
  if (timeInput) timeInput.value = s.time;
}

function toggleBackupScheduleEnabled() {
  _backupScheduleState.enabled = !_backupScheduleState.enabled;
  _bkApplyScheduleUI();
}

async function loadBackupSchedule() {
  try {
    const res = await fetch('/api/backup-schedule');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    _backupScheduleState = {
      enabled: !!data.enabled,
      frequency: data.frequency || 'daily',
      weeklyDays: Array.isArray(data.weeklyDays) ? data.weeklyDays : [],
      monthlyDay: data.monthlyDay || 1,
      time: data.time || '02:00',
    };
  } catch (err) {
    console.error('Failed to load backup schedule', err);
  }
  _bkApplyScheduleUI();
}

async function saveBackupSchedule() {
  const monthlyDayInput = document.getElementById('backupMonthlyDay');
  const timeInput = document.getElementById('backupScheduleTime');
  _backupScheduleState.monthlyDay = Math.min(31, Math.max(1, parseInt(monthlyDayInput && monthlyDayInput.value, 10) || 1));
  _backupScheduleState.time = (timeInput && timeInput.value) || '02:00';
  const status = document.getElementById('backupScheduleStatus');
  if (status) status.textContent = 'Saving…';
  try {
    const res = await fetch('/api/backup-schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_backupScheduleState),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (status) status.textContent = 'Schedule saved.';
  } catch (err) {
    if (status) status.textContent = 'Failed to save. Please try again.';
    console.error('Failed to save backup schedule', err);
  }
}
