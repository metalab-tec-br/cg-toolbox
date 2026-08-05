// ════════════════════════════════════════════════
// SINCRONIZAÇÃO POR USUÁRIO (multiusuário)
// Identifica o usuário atual (login do Windows, via NTLM no servidor — ver
// server/index.js) e sincroniza suas preferências (tema, configurações,
// históricos) com o servidor, para que a mesma pessoa tenha os mesmos dados em
// qualquer navegador/máquina onde acesse a aplicação.
//
// Estratégia: localStorage continua sendo a fonte "instantânea" usada por
// theme.js/settings.js/query-bar.js (evita a tela piscar enquanto a rede não
// respondeu) — mas ao carregar a página ela é semeada com o que o servidor
// tem para este usuário, e toda escrita nas chaves relevantes é replicada de
// volta ao servidor (best-effort, silenciosa). Folders são um caso à parte
// (ver folders.js): vivem só no servidor, sem cache local, porque são um
// recurso privado por usuário sem necessidade de pintura instantânea.
//
// Este script é o PRIMEIRO <script> da página para que a requisição ao servidor
// comece o quanto antes — mas como fetch() é assíncrono, os demais scripts (que
// definem applyTheme/etc.) já terão rodado por completo antes da resposta
// chegar, então é seguro chamá-los de volta aqui.
// ════════════════════════════════════════════════
const USER_SYNCED_KEYS = new Set(['cpa-settings', 'cpa-theme']);
// Os dois históricos (busca de comandos / parâmetros) agora usam uma chave
// DINÂMICA por usuário — 'cpa-query-history:<username>' / 'cpa-cmdsearch-
// history:<username>' (ver js/query-bar.js e js/folders.js) — em vez da
// chave fixa antiga, pra impedir que o histórico de um usuário apareça
// pra outro que faça login local (js/auth.js) no mesmo navegador. Por
// isso a checagem abaixo usa prefixo em vez de comparar a chave inteira.
const USER_SYNCED_KEY_PREFIXES = ['cpa-query-history:', 'cpa-cmdsearch-history:'];
function isUserSyncedKey(key) {
  return USER_SYNCED_KEYS.has(key) || USER_SYNCED_KEY_PREFIXES.some(p => key.startsWith(p));
}

let CURRENT_USER = null;

// Nota: sobrescrever localStorage.setItem por atribuição direta (localStorage.setItem = fn)
// NÃO funciona de forma confiável — Storage é um objeto especial (named properties),
// então a atribuição direta é ignorada silenciosamente. A forma correta e portável é
// sobrescrever o método no PROTÓTIPO compartilhado (Storage.prototype), que todo
// navegador resolve normalmente via a cadeia de protótipos.
const _origLSSetItem = Storage.prototype.setItem;
let _pendingUserDataSync = {};
let _userDataSyncTimer = null;
Storage.prototype.setItem = function (key, value) {
  _origLSSetItem.call(this, key, value);
  if (isUserSyncedKey(key)) {
    _pendingUserDataSync[key] = value;
    clearTimeout(_userDataSyncTimer);
    _userDataSyncTimer = setTimeout(flushUserDataSync, 400);
  }
};
function flushUserDataSync() {
  if (!Object.keys(_pendingUserDataSync).length) return;
  const payload = _pendingUserDataSync;
  _pendingUserDataSync = {};
  fetch('/api/user-data', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {}); // best-effort: a UI local já foi atualizada via localStorage
}
window.addEventListener('beforeunload', flushUserDataSync);

function renderCurrentUserUI(username) {
  const el = document.getElementById('currentUserLabel');
  if (el) el.textContent = username || '';
}

// Reaplica, ao vivo, tudo que os módulos já carregaram de forma síncrona a partir
// do localStorage "frio" (antes da resposta do servidor chegar) — chamado uma vez,
// assim que os dados reais do usuário chegam, para não atrasar a primeira pintura
// da tela esperando essa requisição.
function reapplyAfterUserSync() {
  if (typeof applyTheme === 'function') {
    let theme = 'light';
    try { theme = localStorage.getItem('cpa-theme') || 'light'; } catch (e) {}
    applyTheme(theme);
    if (typeof syncThemeToggleUI === 'function') syncThemeToggleUI(theme);
  }
  if (typeof applyDefaultsFromSettings === 'function') applyDefaultsFromSettings();
  if (typeof reloadFoldersFromServer === 'function') reloadFoldersFromServer();
  if (typeof render === 'function') render();
}

async function initUserSync() {
  try {
    const meRes = await fetch('/api/me');
    const me = await meRes.json();
    CURRENT_USER = me.username;
    renderCurrentUserUI(me.upn || me.username);
    if (typeof updateAccountUI === 'function') updateAccountUI(me);
  } catch (e) {
    console.warn('Não foi possível identificar o usuário atual', e);
    renderCurrentUserUI(null);
  }

  try {
    const dataRes = await fetch('/api/user-data');
    const data = await dataRes.json();
    Object.keys(data).forEach(k => {
      if (data[k] != null) _origLSSetItem.call(localStorage, k, data[k]);
    });
  } catch (e) {
    console.warn('Não foi possível sincronizar preferências do usuário — usando cópia local', e);
  }

  // Espera os catálogos de Versão/Ambiente/Tópico (js/catalogs.js) ficarem prontos
  // antes do primeiro render() de verdade (disparado dentro de
  // reapplyAfterUserSync) — sem isso, o primeiro render poderia rodar com
  // VERSION_KEYS/ENV_KEYS/TYPE_KEYS ainda nos valores estáticos do HTML.
  if (window.CATALOGS_READY) {
    try { await window.CATALOGS_READY; } catch (e) {}
  }

  reapplyAfterUserSync();
}
initUserSync();
