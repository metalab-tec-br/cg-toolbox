// ════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════
// vd/sys = Vendor/Sistema — topo da hierarquia multi-fabricante ESTRITA
// (Vendor → Sistema → Versão → Ambiente → Tópico). Ao contrário de Versão/Ambiente,
// não geram um "valor padrão concreto" para os comandos (não há combo-block
// por Vendor/Sistema) — servem só para restringir a cascata e, quando NÃO em
// 'all', para filtrar de verdade quais comandos aparecem (ver render.js).
const ST = { vd: [], sys: [], v: [], e: [], t: [] };
const FL = { log: false };
// estado de modificadores de teclado
let _q7 = 0;
document.addEventListener('keydown', ev => {
  if (ev.key === 'Control') _q7 |= 1; else if (ev.key === 'Alt') _q7 |= 2;
});
document.addEventListener('keyup', ev => {
  if (ev.key === 'Control') _q7 &= ~1; else if (ev.key === 'Alt') _q7 &= ~2;
});
window.addEventListener('blur', () => { _q7 = 0; });
// Chaves específicas de cada filtro (todas exceto o item mestre "Todos"), na ordem de exibição
const VENDOR_KEYS = ['check-point'];
const SYSTEM_KEYS = ['gaia'];
const VERSION_KEYS = ['R81.10','R81.20','R82','R82.10'];
const ENV_KEYS = ['cluster','gaia','maestro','mds','standalone','vsx'];
const TYPE_KEYS = ['capture','carrier','debug','dlp','identity','ips','license','logs','management','mobile','policy','qos','routing','securexl','status','system','tables','vpn'];
// Valor concreto usado para GERAR o comando quando Versão/Ambiente = Any (DEFAULT_SETTINGS
// guarda 'all' como seleção padrão exibida na UI — mas buildCmds/buildStatic sempre precisam
// de um valor exato, nunca 'all').
const FALLBACK_VERSION = 'R82';
const FALLBACK_ENV = 'standalone';

function togFlag(k) {
  FL[k] = !FL[k];
  document.getElementById('tog-' + k).classList.toggle('on', FL[k]);
  document.getElementById('fw-' + k).classList.toggle('show', FL[k]);
  render();
}

// Quando ST.v === 'all' ("Todas as versões"), os blocos de diferenças por versão
// (⚡ ver diferenças) vêm auto-expandidos em cada card, já que não há uma única versão ativa.
let AUTO_EXPAND_DIFFS = false;

// ── Dropdowns da sidebar (Versão / Ambiente / Tipo-Assunto) ──
function closeAllDropdowns(exceptId) {
  document.querySelectorAll('.dd.open').forEach(dd => { if (dd.id !== exceptId) dd.classList.remove('open'); });
}
function toggleDropdown(id) {
  const dd = document.getElementById(id);
  if (!dd) return;
  const willOpen = !dd.classList.contains('open');
  closeAllDropdowns(willOpen ? id : null);
  dd.classList.toggle('open', willOpen);
}
document.addEventListener('click', ev => {
  if (!ev.target.closest('.dd')) closeAllDropdowns();
});

// ── Ordenação alfabética dos menus suspensos ──────────────────
// Como o texto das opções muda de idioma (ex.: "Tabelas Kernel" vira "Kernel Tables"),
// a ordem alfabética correta depende do idioma atual — por isso reordenamos aqui em vez
// de fixar a ordem no HTML. Chamado no carregamento inicial e sempre que o idioma muda.
function stripLeadingSymbols(str) {
  return (str || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
}
// Grupos de seleção única/múltipla do modal de Configurações (.dd-panel.seg > .seg-btn[data-val]).
// Não há mais item mestre 'all' — todas as opções são só ordenadas alfabeticamente.
function sortSegGroup(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const items = [...panel.querySelectorAll(':scope > .seg-btn')];
  if (items.length < 2) return;
  items.sort((a, b) => stripLeadingSymbols(a.textContent).localeCompare(stripLeadingSymbols(b.textContent), undefined, { sensitivity: 'base' }));
  const foot = panel.querySelector('.dd-panel-foot');
  items.forEach(el => panel.insertBefore(el, foot || null));
}
// Listas da sidebar (.dd-panel > .sb-row[data-v|data-e|data-t]). Não há mais item mestre 'all'.
function sortSidebarGroup(listId, attr) {
  const list = document.getElementById(listId);
  if (!list) return;
  const items = [...list.querySelectorAll(':scope > .sb-row')];
  if (items.length < 2) return;
  items.sort((a, b) => stripLeadingSymbols(a.textContent).localeCompare(stripLeadingSymbols(b.textContent), undefined, { sensitivity: 'base' }));
  const foot = list.querySelector('.dd-panel-foot');
  items.forEach(el => list.insertBefore(el, foot || null));
}
// Grupo de toggles compactos do topo do modal de Configurações (Tema / Descrição /
// Modo administrador) — mesmo princípio do sortSegGroup/sortSidebarGroup, mas reordenando
// os '.sb-toggle' pelo texto do próprio rótulo (que muda de idioma) em vez de data-val.
function sortToggleGroup(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const items = [...container.querySelectorAll(':scope > .sb-toggle')];
  if (items.length < 2) return;
  items.sort((a, b) => stripLeadingSymbols(a.textContent).localeCompare(stripLeadingSymbols(b.textContent), undefined, { sensitivity: 'base' }));
  items.forEach(el => container.appendChild(el));
}
function sortAllDropdowns() {
  sortSidebarGroup('vendorList', 'data-vd');
  sortSidebarGroup('sysList', 'data-sys');
  sortSidebarGroup('vList', 'data-v');
  sortSidebarGroup('eList', 'data-e');
  sortSidebarGroup('tList', 'data-t');
  sortSegGroup('mHome');
  sortSegGroup('mVendor');
  sortSegGroup('mSys');
  sortSegGroup('mVersion');
  sortSegGroup('mEnv');
  sortSegGroup('mType');
  sortToggleGroup('settingsToggleGroup');
}
sortAllDropdowns();

// Rótulo de uma linha sb-row sem o caractere de check decorativo
function rowLabel(row) { return row ? row.textContent.trim().replace(/^✓\s*/, '').trim() : ''; }
function updateDDLabel(btnId, text, color) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.querySelector('.dd-label').textContent = text;
  const pip = btn.querySelector('.sb-pip');
  if (pip && color) pip.style.background = color;
}
// Atualiza o rótulo de um dropdown multi-seleção (Vendor / System / Versão / Ambiente /
// Tópico): 'All' quando nada estiver marcado (estado padrão — sem 'all' sentinela, ver
// bindMultiSelect/toggleSidebarFilterAll abaixo), o nome do item quando só um estiver
// marcado, ou a contagem quando vários. Também destaca o botão (mesmo tratamento visual
// do item ativo "Folders" — ver #foldersNavRow.on/.dd-btn.filter-active) sempre que
// houver algo marcado — assim fica óbvio, de relance, quais filtros da sidebar estão
// realmente restringindo o resultado.
function updateMultiDDLabel(listId, btnId, keyAttr, stateArr, pluralWord) {
  const list = document.getElementById(listId);
  const btn = document.getElementById(btnId);
  if (btn) btn.classList.toggle('filter-active', stateArr.length > 0);
  if (stateArr.length === 0) {
    updateDDLabel(btnId, 'All', '#8B949E');
  } else if (stateArr.length === 1) {
    const row = list.querySelector(`[${keyAttr}="${stateArr[0]}"]`);
    updateDDLabel(btnId, rowLabel(row), row ? row.querySelector('.sb-pip').style.background : '#8B949E');
  } else {
    updateDDLabel(btnId, `${stateArr.length} ${pluralWord}`, '#8B949E');
  }
}
function updateVendorDDLabel() { updateMultiDDLabel('vendorList', 'vendorDDBtn', 'data-vd', ST.vd, 'vendors'); }
function updateSystemDDLabel() { updateMultiDDLabel('sysList', 'sysDDBtn', 'data-sys', ST.sys, 'systems'); }
function updateVersionDDLabel() { updateMultiDDLabel('vList', 'vDDBtn', 'data-v', ST.v, 'selecionadas'); }
function updateEnvDDLabel()     { updateMultiDDLabel('eList', 'eDDBtn', 'data-e', ST.e, 'selecionados'); }
function updateTypeDDLabel()    { updateMultiDDLabel('tList', 'tDDBtn', 'data-t', ST.t, 'selecionados'); }

// Comportamento genérico de multi-seleção SEM item mestre 'Todos' — usado por Vendor,
// System, Versão, Ambiente e Tópico (tanto na sidebar .sb-row quanto no modal de
// Configurações .seg-btn). Cada item é um checkbox comum e independente: clicar marca/
// desmarca só aquele item, sem nenhum efeito colateral sobre os outros. Todos começam
// desmarcados por padrão, e uma seleção vazia é o estado padrão válido — significa
// "sem filtro" (mostra tudo, ver render.js/ccResolveParentSelection) em vez de "nada
// selecionado". Isso evita o comportamento confuso de antes, em que era preciso
// desmarcar 'Todos' primeiro para poder marcar um item específico.
function bindMultiSelect(containerId, itemSelector, keyAttr, onChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.addEventListener('click', ev => {
    const item = ev.target.closest(itemSelector);
    if (!item || !item.getAttribute(keyAttr)) return;
    item.classList.toggle('on');
    onChange();
  });
}
// Lê o valor final de um grupo multi-seleção após um clique: a lista das chaves
// específicas marcadas (pode ser vazia — estado padrão válido, ver bindMultiSelect acima).
function readMultiSelectValue(containerId, itemSelector, keyAttr, specificKeys) {
  const container = document.getElementById(containerId);
  return specificKeys.filter(k => {
    const el = container.querySelector(`${itemSelector}[${keyAttr}="${k}"]`);
    return el && el.classList.contains('on');
  });
}

function onSidebarFilterChange() {
  if (VIEW_FOLDERS_HOME || VIEW_FOLDER_ID != null) {
    VIEW_FOLDERS_HOME = false;
    VIEW_FOLDER_ID = null;
    if (typeof updateFoldersNavHighlight === 'function') updateFoldersNavHighlight();
  }
  render();
}
bindMultiSelect('vendorList', '.sb-row', 'data-vd', () => {
  ST.vd = readMultiSelectValue('vendorList', '.sb-row', 'data-vd', VENDOR_KEYS);
  updateVendorDDLabel();
  if (typeof ccRefreshCascade === 'function') ccRefreshCascade();
  onSidebarFilterChange();
});
bindMultiSelect('sysList', '.sb-row', 'data-sys', () => {
  ST.sys = readMultiSelectValue('sysList', '.sb-row', 'data-sys', SYSTEM_KEYS);
  updateSystemDDLabel();
  if (typeof ccRefreshCascade === 'function') ccRefreshCascade();
  onSidebarFilterChange();
});
bindMultiSelect('vList', '.sb-row', 'data-v', () => {
  ST.v = readMultiSelectValue('vList', '.sb-row', 'data-v', VERSION_KEYS);
  updateVersionDDLabel();
  if (typeof ccRefreshCascade === 'function') ccRefreshCascade();
  onSidebarFilterChange();
});
bindMultiSelect('eList', '.sb-row', 'data-e', () => {
  ST.e = readMultiSelectValue('eList', '.sb-row', 'data-e', ENV_KEYS);
  updateEnvDDLabel();
  if (typeof ccRefreshCascade === 'function') ccRefreshCascade();
  onSidebarFilterChange();
});
bindMultiSelect('tList', '.sb-row', 'data-t', () => {
  ST.t = readMultiSelectValue('tList', '.sb-row', 'data-t', TYPE_KEYS);
  updateTypeDDLabel();
  onSidebarFilterChange();
});

// Config de cada filtro da sidebar: a chave em ST, a função de rótulo, e a lista de
// chaves específicas (mutada in-place por catalogs.js conforme o catálogo muda —
// a referência abaixo continua sempre válida). Usado pelo botão "All" do rodapé
// (toggleSidebarFilterAll) e pelo botão único "Clear filters" (clearAllSidebarFilters).
const SB_FILTER_CFG = {
  vendorList: { stKey: 'vd', label: updateVendorDDLabel, keys: VENDOR_KEYS },
  sysList: { stKey: 'sys', label: updateSystemDDLabel, keys: SYSTEM_KEYS },
  vList: { stKey: 'v', label: updateVersionDDLabel, keys: VERSION_KEYS },
  eList: { stKey: 'e', label: updateEnvDDLabel, keys: ENV_KEYS },
  tList: { stKey: 't', label: updateTypeDDLabel, keys: TYPE_KEYS },
};
// Botão "All" do rodapé de cada dropdown da sidebar — alterna entre marcar TODOS os
// itens específicos (equivalente, na prática, a uma seleção vazia — ver render.js —
// mas deixa visualmente claro o que está incluído) e desmarcar tudo (volta ao padrão
// "sem filtro"). Não existe mais um item mestre 'Todos' na lista — este botão é o
// único lugar que ainda oferece esse atalho de marcar/desmarcar tudo de uma vez.
function toggleSidebarFilterAll(containerId) {
  const cfg = SB_FILTER_CFG[containerId];
  if (!cfg) return;
  const rows = [...document.querySelectorAll(`#${containerId} .sb-row`)];
  const wasFullySelected = rows.length > 0 && rows.every(el => el.classList.contains('on'));
  rows.forEach(el => el.classList.toggle('on', !wasFullySelected));
  ST[cfg.stKey] = wasFullySelected ? [] : cfg.keys.slice();
  cfg.label();
  if (typeof ccRefreshCascade === 'function') ccRefreshCascade();
  onSidebarFilterChange();
}
// Volta um filtro específico para o padrão (sem filtro / nada marcado).
function resetSidebarFilterToAny(containerId) {
  const cfg = SB_FILTER_CFG[containerId];
  if (!cfg) return;
  document.querySelectorAll(`#${containerId} .sb-row`).forEach(el => el.classList.remove('on'));
  ST[cfg.stKey] = [];
  cfg.label();
}
// "Clear filters" reseta Vendor/System/Versão/Ambiente/Tópico de uma vez só (um único
// render no final) — diferente das mudanças individuais de filtro
// (onSidebarFilterChange), ele NÃO tira o usuário da visão de Folders
// (VIEW_FOLDERS_HOME/VIEW_FOLDER_ID), por isso chama render() diretamente em
// vez de passar por onSidebarFilterChange().
function clearAllSidebarFilters() {
  Object.keys(SB_FILTER_CFG).forEach(resetSidebarFilterToAny);
  if (typeof ccRefreshCascade === 'function') ccRefreshCascade();
  render();
}

