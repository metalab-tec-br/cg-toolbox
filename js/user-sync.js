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
//
// Precisa ser `async` e usar `await` no reloadFoldersFromServer() abaixo —
// bug reportado: "com a home page definida com a folders nenhum comando nem
// pasta são carregados". Causa: depois do fix de VIEW_FOLDERS_HOME (ver
// applyDefaultsFromSettings() em settings.js), quando a Home page é
// "Folders" a tela entra direto no ramo VIEW_FOLDERS_HOME de render.js, que
// usa a variável global FOLDERS (js/folders.js) pra montar as seções. Antes
// deste fix, reloadFoldersFromServer() era disparado (fetch assíncrono, sem
// aguardar) e o render() logo em seguida rodava ANTES do fetch resolver —
// com FOLDERS ainda vazio ([], valor inicial em folders.js), o ramo
// VIEW_FOLDERS_HOME monta 0 seções e a função de combo retorna '' (ver
// render.js: "if (!folderGroups) return '';"), deixando a tela em branco
// até reloadFoldersFromServer() completar e chamar render() de novo por
// conta própria — o que deveria acontecer, mas na prática ficava sujeito a
// condição de corrida (o próprio render() daqui também é assíncrono, por
// causa do fetchCommands() dentro dele, então a ordem de quem termina
// primeiro não era garantida). Aguardar aqui garante que FOLDERS já está
// populado (ou definitivamente vazio, se o fetch falhar — reloadFoldersFromServer
// trata esse erro internamente) antes do render() final rodar.
async function reapplyAfterUserSync() {
  if (typeof applyTheme === 'function') {
    let theme = 'light';
    try { theme = localStorage.getItem('cpa-theme') || 'light'; } catch (e) {}
    applyTheme(theme);
    if (typeof syncThemeToggleUI === 'function') syncThemeToggleUI(theme);
  }
  if (typeof applyDefaultsFromSettings === 'function') applyDefaultsFromSettings();
  if (typeof reloadFoldersFromServer === 'function') await reloadFoldersFromServer();
  if (typeof render === 'function') render();
}

// Busca /api/me com UMA tentativa extra se a primeira falhar — bug
// reportado: "botão logout não aparece para usuário local", mesmo após
// login local bem-sucedido e containers recém reconstruídos. Investigação:
// a lógica de login/sessão/`/api/me` está correta (testada isoladamente
// contra um Postgres real simulando login → sessão → checagem do botão,
// inclusive casos de borda como sessão expirada/usuário desabilitado — ver
// test_local_login_authmethod.js). O sintoma relatado (linha de role/
// método VAZIA no dropdown, não só o botão Log out sumindo) só acontece
// quando este catch abaixo é executado (fetch()/`.json()` falhando) —
// deixando os elementos no estado "cru" do HTML (vazio/display:none) sem
// nenhuma indicação de erro. Isso bate com o cenário de logo após um
// rebuild: nginx pode responder com um 502/503 (corpo não-JSON, então
// `.json()` lança) enquanto o container do backend ainda está terminando
// de subir — mesma margem de segurança que já existe em server/db.js
// (initDb() tenta reconectar ao Postgres por até ~60s). Uma única
// retentativa aqui, com um pequeno atraso, cobre esse caso sem precisar de
// reload manual da página.
async function fetchMeWithRetry() {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const meRes = await fetch('/api/me');
      if (!meRes.ok) throw new Error(`/api/me respondeu ${meRes.status}`);
      return await meRes.json();
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 1200));
    }
  }
}
async function initUserSync() {
  try {
    const me = await fetchMeWithRetry();
    CURRENT_USER = me.username;
    renderCurrentUserUI(me.upn || me.username);
    if (typeof updateAccountUI === 'function') updateAccountUI(me);
  } catch (e) {
    console.warn('Não foi possível identificar o usuário atual', e);
    renderCurrentUserUI(null);
    // Antes disto o dropdown de conta ficava com a linha de role/método em
    // branco e SEM nenhuma pista de que algo falhou — indistinguível, pro
    // usuário, de "Log out não aparece porque a sessão não é local".
    // Mostrar um aviso explícito (e um jeito de tentar de novo sem F5) deixa
    // o problema óbvio em vez de silencioso.
    const roleLine = document.getElementById('hdrUserRoleLine');
    if (roleLine) roleLine.textContent = 'Could not verify your account — reload the page to try again.';
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
