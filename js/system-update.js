// ════════════════════════════════════════════════
// CHECK FOR UPDATES / UPDATE NOW — botões na aba System do modal de
// Configurações (ver #checkUpdateBtn/#applyUpdateBtn/#updateStatus em
// index.html). Fala com GET/POST /api/system/update-check e
// /api/system/update-apply, que por sua vez só repassam pro serviço
// companion "updater" (container isolado — ver updater/server.js e
// docker-compose.yml para o racional completo). Não existe em instalações
// sem Docker ou sem esse serviço habilitado — nesse caso a API responde 501
// e os botões mostram uma mensagem explicando isso, em vez de um erro cru.
//
// "Update now" reconstrói e reinicia o container da aplicação (git pull +
// docker compose up -d --build) — por isso passa por confirmação, e depois
// de disparado faz polling em /api/system/update-check até o servidor
// voltar a responder (esperando primeiro ele CAIR, pra não recarregar cedo
// demais enquanto o container antigo ainda está de pé durante o rebuild) e
// então recarrega a página sozinho.
// ════════════════════════════════════════════════

let _sysUpdatePollTimer = null;
let _sysUpdateInfo = null; // último resultado de update-check, usado por applyUpdate()

function _sysUpdSetStatus(text) {
  const el = document.getElementById('updateStatus');
  if (el) el.textContent = text;
}

async function checkForUpdate() {
  const checkBtn = document.getElementById('checkUpdateBtn');
  const applyBtn = document.getElementById('applyUpdateBtn');
  if (checkBtn) checkBtn.disabled = true;
  if (applyBtn) applyBtn.style.display = 'none';
  _sysUpdSetStatus('Checking…');
  try {
    const res = await fetch('/api/system/update-check');
    const data = await res.json().catch(() => ({}));
    if (res.status === 501) {
      _sysUpdSetStatus('Not available in this installation (no updater service configured).');
      return;
    }
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    _sysUpdateInfo = data;
    const shortCurrent = (data.current || '').slice(0, 7);
    const shortRemote = (data.remote || '').slice(0, 7);
    if (data.updateAvailable) {
      const n = Array.isArray(data.log) ? data.log.length : 0;
      const latest = n ? data.log[0].replace(/^[0-9a-f]+\s*/, '') : '';
      _sysUpdSetStatus(`Update available — ${n} new commit${n === 1 ? '' : 's'} (${shortCurrent} → ${shortRemote})${latest ? `. Latest: "${latest}"` : ''}.`);
      if (applyBtn) applyBtn.style.display = '';
    } else {
      _sysUpdSetStatus(`Up to date (${shortCurrent}).`);
    }
  } catch (err) {
    console.error('update-check failed', err);
    _sysUpdSetStatus('Could not check for updates. Please try again.');
  } finally {
    if (checkBtn) checkBtn.disabled = false;
  }
}

function applyUpdate() {
  openConfirmModal(
    'Update now? This pulls the latest version from GitHub and rebuilds/restarts the server. It takes a few minutes, and the page will reload automatically once it\'s back.',
    { danger: false }
  ).then(async ok => {
    if (!ok) return;
    const checkBtn = document.getElementById('checkUpdateBtn');
    const applyBtn = document.getElementById('applyUpdateBtn');
    if (checkBtn) checkBtn.disabled = true;
    if (applyBtn) applyBtn.disabled = true;
    _sysUpdSetStatus('Starting update…');
    try {
      const res = await fetch('/api/system/update-apply', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 501) {
        _sysUpdSetStatus('Not available in this installation (no updater service configured).');
        if (checkBtn) checkBtn.disabled = false;
        if (applyBtn) applyBtn.disabled = false;
        return;
      }
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      _sysUpdSetStatus('Update started — rebuilding and restarting the server. This page will reload automatically in a few minutes…');
      _sysUpdWaitForRestart();
    } catch (err) {
      console.error('update-apply failed', err);
      _sysUpdSetStatus('Could not start the update. Please try again.');
      if (checkBtn) checkBtn.disabled = false;
      if (applyBtn) applyBtn.disabled = false;
    }
  });
}

// Espera o servidor cair (rebuild em andamento) e depois voltar a responder,
// então recarrega a página sozinho. Sem essa checagem de "caiu primeiro",
// recarregaríamos cedo demais e só veríamos a versão antiga ainda de pé.
function _sysUpdWaitForRestart() {
  if (_sysUpdatePollTimer) clearInterval(_sysUpdatePollTimer);
  let sawDown = false;
  let attempts = 0;
  const maxAttempts = 150; // ~150 * 4s = 10 minutos
  _sysUpdatePollTimer = setInterval(async () => {
    attempts++;
    if (attempts > maxAttempts) {
      clearInterval(_sysUpdatePollTimer);
      _sysUpdatePollTimer = null;
      _sysUpdSetStatus('Update is taking longer than expected. Reload the page manually in a bit to check.');
      return;
    }
    try {
      const res = await fetch('/api/system/update-check', { cache: 'no-store' });
      if (!res.ok && res.status !== 501) throw new Error(`HTTP ${res.status}`);
      if (sawDown) {
        clearInterval(_sysUpdatePollTimer);
        _sysUpdatePollTimer = null;
        _sysUpdSetStatus('Update complete — reloading…');
        setTimeout(() => location.reload(), 600);
      }
      // ainda não caiu (container antigo respondendo durante o build) — continua esperando.
    } catch (err) {
      sawDown = true; // primeira falha de rede = o servidor caiu pra reiniciar
    }
  }, 4000);
}
