// ════════════════════════════════════════════════
// MODAL DE CONFIRMAÇÃO GENÉRICO
// Substitui o confirm() nativo do navegador — que exibe o host da página
// (ex.: "localhost:3000 diz") e não segue as cores do tema — por um modal
// próprio, centralizado na tela, com as cores do tema atual (claro/escuro).
// Uso: openConfirmModal('Mensagem...').then(ok => { if (ok) { ... } });
// ════════════════════════════════════════════════
let _confirmResolve = null;

function openConfirmModal(message, { danger = true } = {}) {
  return new Promise(resolve => {
    _confirmResolve = resolve;
    const msgEl = document.getElementById('confirmMessage');
    if (msgEl) msgEl.textContent = message;
    const okBtn = document.getElementById('confirmOkBtn');
    if (okBtn) {
      okBtn.classList.toggle('btn-danger', danger);
      okBtn.classList.toggle('btn-primary', !danger);
    }
    const overlay = document.getElementById('confirmOverlay');
    if (overlay) overlay.classList.add('show');
  });
}

function closeConfirmModal(result) {
  const overlay = document.getElementById('confirmOverlay');
  if (overlay) overlay.classList.remove('show');
  if (_confirmResolve) {
    const resolve = _confirmResolve;
    _confirmResolve = null;
    resolve(result);
  }
}

(() => {
  const overlay = document.getElementById('confirmOverlay');
  if (overlay) {
    overlay.addEventListener('click', ev => {
      if (ev.target.id === 'confirmOverlay') closeConfirmModal(false);
    });
  }
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    const ov = document.getElementById('confirmOverlay');
    if (ov && ov.classList.contains('show')) closeConfirmModal(false);
  });
})();
