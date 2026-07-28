// ════════════════════════════════════════════════
// CONFIGURAÇÕES DO USUÁRIO (persistidas em localStorage)
// ════════════════════════════════════════════════
const SETTINGS_KEY = 'cpa-settings';
const DEFAULT_SETTINGS = {
  home: 'menu', vendor: [], sys: [], version: [], env: [], type: [],
  logFile: '/tmp/fw_export.txt',
  showCardDetails: false,
  enableCommandEditing: false,
  exportEnabled: false,
  groupBy: 'topic',
  // Só usado quando o usuário AINDA não tem preferência própria salva — nesse
  // caso o valor real vem do default do administrador (ver
  // applyGlobalDefaultsIfNeeded() mais abaixo); `false` aqui é só o fallback
  // caso o servidor não responda por qualquer motivo. Todas as 4 preferências
  // do grupo "Default settings" do modal (Dark mode, Details, Export, System
  // commands) começam desabilitadas por padrão, a pedido do usuário.
  showSystemCommands: false,
};

// Ligado/desligado ao vivo por terminal-renderer.js (card()) para decidir se mostra o
// ícone de editar em cada card — atualizado só por applyCommandEditingSetting().
let COMMAND_EDITING_ENABLED = false;

// Lido por render.js para decidir a unidade de agrupamento recolhível: 'topic' (padrão —
// uma seção por Tópico, comportamento de sempre) ou 'version' (um bloco recolhível por
// combinação Versão/Ambiente, com as seções de Tópico aninhadas dentro).
let GROUP_BY = 'topic';

// Normaliza um valor de configuração multi-seleção: aceita string única (formato antigo,
// pré-multi-seleção) ou array. Também remove a sentinela 'all' (formato antigo, de antes
// da remoção do item mestre 'Todos' das listas — ver js/state.js) de qualquer valor já
// salvo no localStorage de uma sessão anterior: hoje ela não existe mais, e o
// equivalente exato é a seleção vazia (sem filtro, mostra tudo).
function normalizeMultiSetting(val, fallback) {
  if (val === undefined || val === null) return fallback.slice();
  if (!Array.isArray(val)) return val ? [val] : []; // string única (formato antigo) vira array
  return val.filter(v => v !== 'all'); // já é array — respeita como está, inclusive vazio (seleção vazia é válida)
}
function loadSettings() {
  let s = Object.assign({}, DEFAULT_SETTINGS);
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) s = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
  } catch (e) {}
  // Compatibilidade: versões antigas salvavam version/env/type como string única — normaliza para array.
  s.type = normalizeMultiSetting(s.type, DEFAULT_SETTINGS.type);
  s.version = normalizeMultiSetting(s.version, DEFAULT_SETTINGS.version);
  s.env = normalizeMultiSetting(s.env, DEFAULT_SETTINGS.env);
  s.vendor = normalizeMultiSetting(s.vendor, DEFAULT_SETTINGS.vendor);
  s.sys = normalizeMultiSetting(s.sys, DEFAULT_SETTINGS.sys);
  return s;
}
function persistSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
}
function setActiveRow(listId, attr, val) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.querySelectorAll('.sb-row').forEach(r => r.classList.remove('on'));
  const row = list.querySelector(`[${attr}="${val}"]`);
  if (row) row.classList.add('on');
}
// Marca como ativas todas as linhas cujo valor esteja no array `vals` (multi-seleção,
// sem item mestre 'all' — ver js/state.js).
function setActiveRowsMulti(listId, attr, vals) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.querySelectorAll('.sb-row').forEach(r => {
    r.classList.toggle('on', vals.includes(r.getAttribute(attr)));
  });
}
function gvSet(id, val) { const el = document.getElementById(id); if (el) el.value = val; }

// ── Preferências de commit instantâneo (aplicam e persistem na hora, sem esperar
// o botão 'Salvar' do modal — mesmo padrão já usado por tema e idioma) ──────────

// Mostra/oculta descrição curta, bloco 'about' (finalidade/quando usar/observação) e tags
// do cabeçalho de cada card, conforme a preferência 'showCardDetails' (tela menos poluída).
function applyCardDetailsSetting(show) {
  document.body.classList.toggle('compact-cards', !show);
}
// Reflete o estado atual (ligado/desligado) no toggle da sidebar E no toggle compacto
// equivalente do modal de Configurações (mDescToggle).
function syncShowDetailsToggleUI(show) {
  const side = document.getElementById('tog-details');
  if (side) side.classList.toggle('on', show);
  const modal = document.getElementById('mDescToggle');
  if (modal) modal.classList.toggle('on', show);
}
function setShowCardDetails(show) {
  applyCardDetailsSetting(show);
  syncShowDetailsToggleUI(show);
  const s = loadSettings();
  s.showCardDetails = show;
  persistSettings(s);
}
function toggleShowCardDetails() {
  setShowCardDetails(!(loadSettings().showCardDetails === true));
}
// Toggle compacto (Descrição) do modal de Configurações — mesma preferência do
// toggle 'Descrição' da sidebar (tog-details), só que com commit instantâneo aqui também.
function toggleModalDesc() {
  setShowCardDetails(!(loadSettings().showCardDetails === true));
}

// Mostra/oculta os comandos System (created_by='System' — ver is_system em
// server/index.js: shapeCommand) da tela, conforme a preferência
// 'showSystemCommands' (toggle "System commands" na sidebar, seção Options).
// A filtragem de verdade acontece em render.js, sobre o array vindo de
// fetchCommands(); aqui só guardamos a flag viva e refletimos no toggle.
let SHOW_SYSTEM_COMMANDS = false;
function applyShowSystemCommandsSetting(show) {
  SHOW_SYSTEM_COMMANDS = show !== false;
  if (typeof render === 'function') render();
}
// Reflete o estado atual no toggle da sidebar E no espelho do modal de
// Configurações (mSystemCommandsToggle) — mesmo padrão de
// syncShowDetailsToggleUI/mDescToggle acima.
function syncShowSystemCommandsToggleUI(show) {
  const side = document.getElementById('tog-system-commands');
  if (side) side.classList.toggle('on', show !== false);
  const modal = document.getElementById('mSystemCommandsToggle');
  if (modal) modal.classList.toggle('on', show !== false);
}
function setShowSystemCommands(show) {
  applyShowSystemCommandsSetting(show);
  syncShowSystemCommandsToggleUI(show);
  const s = loadSettings();
  s.showSystemCommands = show !== false;
  persistSettings(s);
}
function toggleShowSystemCommands() {
  setShowSystemCommands(!(loadSettings().showSystemCommands !== false));
}
// Toggle compacto (System commands) do modal de Configurações — mesma
// preferência pessoal do toggle "System commands" da sidebar (tog-system-
// commands), com commit instantâneo aqui também (igual toggleModalDesc()).
function toggleModalSystemCommands() {
  setShowSystemCommands(!(loadSettings().showSystemCommands !== false));
}

// Liga/desliga o redirecionamento '> arquivo' anexado às linhas de comando que
// suportam exportação (supports_export=1 — ver dbLineToTerm em
// db-render-engine.js, que lê values.FL.log/values.logFile). Antes era um
// flag puramente de sessão (FL.log via togFlag('log'), em js/state.js); agora
// é uma preferência persistida igual a Description/System commands — FL.log
// continua sendo o valor "ao vivo" que o motor de render consome, só que
// inicializado e mantido a partir daqui em vez de sempre começar em false.
function applyExportSetting(enabled) {
  FL.log = !!enabled;
  const fw = document.getElementById('fw-log');
  if (fw) fw.classList.toggle('show', FL.log);
  if (typeof render === 'function') render();
}
// Reflete o estado atual no toggle da sidebar E no espelho do modal de
// Configurações (mExportToggle) — mesmo padrão de
// syncShowDetailsToggleUI/syncShowSystemCommandsToggleUI acima.
function syncExportToggleUI(enabled) {
  const side = document.getElementById('tog-log');
  if (side) side.classList.toggle('on', !!enabled);
  const modal = document.getElementById('mExportToggle');
  if (modal) modal.classList.toggle('on', !!enabled);
}
function setExportEnabled(enabled) {
  applyExportSetting(enabled);
  syncExportToggleUI(enabled);
  const s = loadSettings();
  s.exportEnabled = !!enabled;
  persistSettings(s);
}
function toggleExportEnabled() {
  setExportEnabled(!(loadSettings().exportEnabled === true));
}
// Toggle compacto (Export) do modal de Configurações — mesma preferência
// pessoal do toggle "Export" da sidebar (tog-log), com commit instantâneo
// aqui também (igual toggleModalDesc()/toggleModalSystemCommands()).
function toggleModalExport() {
  setExportEnabled(!(loadSettings().exportEnabled === true));
}

// ── Default do administrador para "System commands" (Settings modal, seção
// Admin mode — ver GET/PUT /api/global-settings em server/index.js) ─────────
// Só é aplicado a um usuário que AINDA não tem preferência própria salva
// (ver hasExplicitSetting abaixo) — depois que a pessoa mexe no toggle da
// sidebar, a escolha dela passa a valer sempre, independente do default.
function hasExplicitSetting(key) {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return false;
    return Object.prototype.hasOwnProperty.call(JSON.parse(raw), key);
  } catch (e) { return false; }
}
function syncAdminDefaultToggleUI(show) {
  const el = document.getElementById('mSystemCommandsDefaultToggle');
  if (el) el.classList.toggle('on', show !== false);
}
// Chamado uma vez no boot (ver fim deste arquivo) — busca o default salvo pelo
// administrador e, SE este usuário ainda não tiver escolha própria, aplica e
// persiste esse valor (a partir daí passa a contar como "escolha própria").
async function applyGlobalDefaultsIfNeeded() {
  let globalDefault = false;
  try {
    const g = await fetchGlobalSettings();
    if (g && g.showSystemCommandsDefault != null) globalDefault = g.showSystemCommandsDefault !== 'false';
    syncAdminDefaultToggleUI(globalDefault);
  } catch (e) {
    console.warn('Could not load admin defaults — using built-in fallback', e);
  }
  if (!hasExplicitSetting('showSystemCommands')) {
    setShowSystemCommands(globalDefault);
  }
}
// Toggle do modal (seção Admin mode) — grava o default GLOBAL (todo mundo que
// ainda não tiver escolha própria passa a herdar este valor), não a
// preferência pessoal de quem está mexendo agora (essa é o toggle da sidebar).
function toggleModalSystemCommandsDefault() {
  const el = document.getElementById('mSystemCommandsDefaultToggle');
  const next = !(el && el.classList.contains('on'));
  syncAdminDefaultToggleUI(next);
  saveGlobalSettings({ showSystemCommandsDefault: String(next) }).catch(e => console.warn('Failed to save admin default', e));
}

// Mostra/oculta o botão '+ Adicionar comando' da sidebar e o ícone de editar de cada
// card, conforme a preferência 'enableCommandEditing' (fica escondido por padrão para
// não poluir a tela do usuário comum — só aparece quando habilitado em Configurações).
function applyCommandEditingSetting(enabled) {
  COMMAND_EDITING_ENABLED = !!enabled;
  document.body.classList.toggle('hide-command-editing', !enabled);
  if (typeof render === 'function') render(); // reconstrói os cards para (des)aparecer o lápis de editar
}
function syncCommandEditingToggleUI(enabled) {
  const modal = document.getElementById('mEnableEditingToggle');
  if (modal) modal.classList.toggle('on', enabled);
}
function setEnableCommandEditing(enabled) {
  applyCommandEditingSetting(enabled);
  syncCommandEditingToggleUI(enabled);
  const s = loadSettings();
  s.enableCommandEditing = enabled;
  persistSettings(s);
}
function toggleModalEnableEditing() {
  setEnableCommandEditing(!(loadSettings().enableCommandEditing === true));
}

// Agrupamento do resultado: 'topic' (uma seção recolhível por Tópico — padrão),
// 'version' (um bloco recolhível por Versão/Ambiente, com as seções de Tópico
// aninhadas), ou 'creator' (um bloco recolhível por quem cadastrou o comando —
// created_by —, também com as mesmas seções de Tópico aninhadas dentro de
// cada autor; ver uso em js/render.js). Substituiu a antiga preferência
// "Sort by creator" (um simples reordenar da lista) por um agrupamento de
// verdade, a pedido do usuário.
function normalizeGroupBy(mode) {
  return (mode === 'version') ? 'version' : (mode === 'creator') ? 'creator' : (mode === 'favorites') ? 'favorites' : 'topic';
}
function applyGroupBySetting(mode) {
  GROUP_BY = normalizeGroupBy(mode);
  if (typeof render === 'function') render();
}
// Texto mostrado no botão dropdown "Group by" (barra de ferramentas) —
// mantido em sincronia com GROUP_BY sempre que ele muda.
function groupByLabel(mode) {
  return mode === 'version' ? 'Version' : mode === 'creator' ? 'Created by' : mode === 'favorites' ? 'User favorites' : 'Topic';
}
function syncGroupByToggleUI(mode) {
  const wrap = document.getElementById('groupByToggle');
  if (wrap) wrap.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('on', b.dataset.val === mode));
  const btn = document.getElementById('groupByDDBtn');
  const label = btn && btn.querySelector('.dd-label');
  if (label) label.textContent = groupByLabel(mode);
}
function setGroupBy(mode) {
  applyGroupBySetting(mode);
  syncGroupByToggleUI(mode);
  // Dropdown de seleção única (barra de ferramentas) — fecha ao escolher,
  // mesmo padrão já usado pelo dropdown equivalente do modal de Configurações
  // (ver ['mHome','mGroupBy'].forEach em js/settings-modal.js).
  const dd = document.getElementById('groupByDD');
  if (dd) dd.classList.remove('open');
  if (typeof setSegActive === 'function') setSegActive('mGroupBy', GROUP_BY);
  if (typeof updateModalSingleLabel === 'function') updateModalSingleLabel('mGroupBy', 'mGroupByDDBtn');
  const s = loadSettings();
  s.groupBy = GROUP_BY;
  persistSettings(s);
}

// Aplica as preferências salvas ao estado vivo da ferramenta (chamado no boot)
function applyDefaultsFromSettings() {
  const s = loadSettings();
  ST.vd = s.vendor; ST.sys = s.sys; ST.v = s.version; ST.e = s.env; ST.t = s.type;
  setActiveRowsMulti('vendorList', 'data-vd', s.vendor);
  setActiveRowsMulti('sysList', 'data-sys', s.sys);
  setActiveRowsMulti('vList', 'data-v', s.version);
  setActiveRowsMulti('eList', 'data-e', s.env);
  setActiveRowsMulti('tList', 'data-t', s.type);
  updateVendorDDLabel();
  updateSystemDDLabel();
  updateVersionDDLabel();
  updateEnvDDLabel();
  updateTypeDDLabel();
  if (typeof ccRefreshCascade === 'function') ccRefreshCascade();
  gvSet('f-log', s.logFile);
  applyCardDetailsSetting(s.showCardDetails === true);
  syncShowDetailsToggleUI(s.showCardDetails === true);
  applyShowSystemCommandsSetting(s.showSystemCommands !== false);
  syncShowSystemCommandsToggleUI(s.showSystemCommands !== false);
  applyExportSetting(s.exportEnabled === true);
  syncExportToggleUI(s.exportEnabled === true);
  applyCommandEditingSetting(s.enableCommandEditing === true);
  syncCommandEditingToggleUI(s.enableCommandEditing === true);
  GROUP_BY = normalizeGroupBy(s.groupBy); // sem render() aqui — render() inicial ainda vai rodar
  syncGroupByToggleUI(GROUP_BY);
}
applyDefaultsFromSettings();
// Assíncrono, best-effort — não atrasa a primeira pintura da tela (mesmo
// espírito de initUserSync() em user-sync.js); só ajusta e re-renderiza
// depois se este usuário ainda não tiver escolhido "System commands" por
// conta própria (ver hasExplicitSetting).
applyGlobalDefaultsIfNeeded();
