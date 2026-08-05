// ════════════════════════════════════════════════
// FOLDERS — substitui a antiga feature "Favorites" (ver server/index.js:
// folders/folder_commands, e a migração de dados em server/db.js). Cada
// usuário organiza comandos em pastas PRÓPRIAS (nome livre) e um mesmo
// comando pode estar em várias pastas ao mesmo tempo. Diferente do antigo
// esquema de favoritos, pastas são privadas — não existe mais uma contagem/
// lista de "quem mais favoritou" visível entre usuários (ver
// server/index.js: shapeCommand()'s folder_ids, que só reflete as pastas do
// usuário que está olhando a tela).
//
// FOLDERS é um array vivo (não um Set, já que cada item carrega nome/id além
// da membership): [{ id, name, sort_order, command_ids: Set<string> }, ...].
// Carregado do servidor (reloadFoldersFromServer(), chamado por
// js/user-sync.js depois que o usuário é identificado) e mantido atualizado
// localmente de forma otimista a cada criação/renomeação/exclusão de pasta
// ou mudança de membership — sem esperar round-trip do servidor para a UI
// responder (mesmo princípio do antigo toggleFavorite()).
// ════════════════════════════════════════════════
let FOLDERS = [];

// VIEW_FOLDERS_HOME = visão combinada (home page "Folders" — mostra todo
// comando que esteja em QUALQUER pasta do usuário, sem seções por pasta).
// VIEW_FOLDER_ID = pasta específica sendo visualizada (clicada na sidebar) —
// os dois são mutuamente exclusivos; nenhum dos dois ativo = menu normal.
let VIEW_FOLDERS_HOME = loadSettings().home === 'folders';
let VIEW_FOLDER_ID = null;
(() => { const row = document.getElementById('foldersNavRow'); if (row) row.classList.toggle('on', VIEW_FOLDERS_HOME); })();
// Estado de expandido/recolhido da lista de pastas na sidebar — só estético,
// puramente local (não sincronizado entre máquinas, ao contrário das pastas
// em si), por isso persistido direto no localStorage sem passar pelo
// mecanismo de sync de user-data (ver js/user-sync.js: USER_SYNCED_KEYS).
(() => {
  const block = document.getElementById('foldersBlock');
  if (!block) return;
  let expanded = true;
  try { expanded = localStorage.getItem('cpa-folders-expanded') !== '0'; } catch (e) {}
  block.classList.toggle('collapsed', !expanded);
})();

// Busca as pastas reais do usuário atual no servidor e substitui FOLDERS —
// chamado uma vez no boot (via user-sync.js) depois que o usuário é
// identificado; pode ser chamado de novo a qualquer momento para
// re-sincronizar (ex.: mesma pessoa com duas abas abertas).
async function reloadFoldersFromServer() {
  try {
    const res = await fetch('/api/folders');
    const data = await res.json();
    FOLDERS = (data || []).map(f => ({ id: f.id, name: f.name, sort_order: f.sort_order, command_ids: new Set(f.command_ids || []) }));
    renderFoldersSidebarList();
    if (typeof render === 'function') render();
  } catch (e) {
    console.warn('Não foi possível carregar as pastas do servidor', e);
  }
}

// ── Sidebar: lista de pastas (nested list sob o cabeçalho "Folders") ──
function renderFoldersSidebarList() {
  const list = document.getElementById('foldersDynamicList');
  if (!list) return;
  const sorted = FOLDERS.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  list.innerHTML = sorted.map(f => `
    <div class="sb-row folder-row${VIEW_FOLDER_ID === f.id ? ' on' : ''}" data-folder-id="${f.id}" onclick="selectFolder(${f.id})">
      ${folderIcon(false, 12)}
      <span class="folder-row-name">${escapeCmdSearchHistoryHtml(f.name)}</span>
      <span class="folder-row-count">${f.command_ids.size}</span>
      <span class="folder-row-actions">
        <button type="button" class="folder-row-btn" onmousedown="event.preventDefault()" onclick="promptRenameFolder(${f.id}, '${jsAttrEscapeCmdSearch(f.name)}', event)" title="Rename folder">✎</button>
        <button type="button" class="folder-row-btn" onmousedown="event.preventDefault()" onclick="deleteFolderConfirm(${f.id}, '${jsAttrEscapeCmdSearch(f.name)}', event)" title="Delete folder">✕</button>
      </span>
    </div>`).join('');
}

// ── Navegação: visão combinada / pasta específica / home ──
function toggleFoldersExpanded() {
  const block = document.getElementById('foldersBlock');
  if (!block) return;
  const willCollapse = !block.classList.contains('collapsed');
  block.classList.toggle('collapsed', willCollapse);
  try { localStorage.setItem('cpa-folders-expanded', willCollapse ? '0' : '1'); } catch (e) {}
}
function updateFoldersNavHighlight() {
  const nav = document.getElementById('foldersNavRow');
  if (nav) nav.classList.toggle('on', VIEW_FOLDERS_HOME);
  document.querySelectorAll('#foldersDynamicList .folder-row').forEach(r => {
    r.classList.toggle('on', VIEW_FOLDER_ID !== null && String(VIEW_FOLDER_ID) === r.dataset.folderId);
  });
}
// Clique no cabeçalho "Folders" da sidebar — mesmo easter egg de sempre
// (Ctrl+Alt+clique, ver _q7 em js/state.js) preservado aqui no lugar de
// toggleFavoritesView(), que cumpria o mesmo papel antes.
function viewAllFolders() {
  if (_q7 === 3) return _rvl9();
  VIEW_FOLDERS_HOME = true;
  VIEW_FOLDER_ID = null;
  updateFoldersNavHighlight();
  render();
}
function selectFolder(id) {
  VIEW_FOLDERS_HOME = false;
  VIEW_FOLDER_ID = id;
  updateFoldersNavHighlight();
  render();
}
// Clique no nome/logo do app: volta para a página inicial configurada
// (Folders ou Command menu — ver "Home page" em Configurações).
function goHome() {
  const s = loadSettings();
  VIEW_FOLDERS_HOME = s.home === 'folders';
  VIEW_FOLDER_ID = null;
  updateFoldersNavHighlight();
  render();
}

// ── Filtros pós-render (mesma técnica do antigo applyFavoritesFilter): depois
// que render() monta todas as seções normalmente, esconde os cards que não
// batem com a pasta/visão atual e as seções que ficaram vazias. ──
function _foldersEmptyState(message) {
  return `<div class="empty"><div class="empty-ico">${folderIcon(false, 40)}</div><p>${message}</p></div>`;
}
function filterCardsByIdSet(idSet, emptyMessage) {
  const out = document.getElementById('out');
  const cards = out.querySelectorAll('.card[data-cmd-id]');
  cards.forEach(c => {
    const cid = c.dataset.cmdId;
    c.style.display = (cid && idSet.has(cid)) ? '' : 'none';
  });
  out.querySelectorAll('.section').forEach(sec => {
    const visible = [...sec.querySelectorAll('.card')].some(c => c.style.display !== 'none');
    sec.style.display = visible ? '' : 'none';
  });
  out.querySelectorAll('.env-note').forEach(n => { n.style.display = 'none'; });
  const anyVisible = [...out.querySelectorAll('.card')].some(c => c.style.display !== 'none');
  if (!anyVisible) out.insertAdjacentHTML('beforeend', _foldersEmptyState(emptyMessage));
}
function applyFolderFilter() {
  const folder = FOLDERS.find(f => f.id === VIEW_FOLDER_ID);
  filterCardsByIdSet(folder ? folder.command_ids : new Set(), folder ? `No commands in "${folder.name}" yet for the current filters.` : 'Folder not found.');
}
function applyAnyFolderFilter() {
  const anyIds = new Set();
  FOLDERS.forEach(f => f.command_ids.forEach(id => anyIds.add(id)));
  filterCardsByIdSet(anyIds, 'No commands in any folder yet for the current filters.');
}

// ── Membership: adicionar/remover um comando de uma pasta (chamado pelo
// dropdown de pastas de cada card — ver folderMenuHtml()/toggleFolderMenu()
// em js/terminal-renderer.js) ──
function toggleCommandInFolder(cmdId, folderId, itemEl) {
  const folder = FOLDERS.find(f => f.id === folderId);
  if (!folder) return;
  const wasOn = folder.command_ids.has(cmdId);
  if (wasOn) folder.command_ids.delete(cmdId); else folder.command_ids.add(cmdId);
  // Atualização otimista: marca/desmarca o item clicado no próprio dropdown
  // e o botão de pasta do card (ligado se o comando estiver em QUALQUER
  // pasta agora) — SEM re-renderizar a tela toda, para o dropdown continuar
  // aberto e permitir marcar várias pastas em sequência.
  if (itemEl) {
    itemEl.classList.toggle('on', !wasOn);
    const chk = itemEl.querySelector('.folder-menu-chk');
    if (chk) chk.textContent = wasOn ? '' : '✓';
  }
  const card = document.querySelector(`.card[data-cmd-id="${CSS.escape(cmdId)}"]`);
  if (card) {
    const inAnyFolder = FOLDERS.some(f => f.command_ids.has(cmdId));
    const btn = card.querySelector('.fav-wrap .fav-btn');
    if (btn) btn.classList.toggle('on', inAnyFolder);
  }
  const folderCountEl = document.querySelector(`#foldersDynamicList .folder-row[data-folder-id="${folderId}"] .folder-row-count`);
  if (folderCountEl) folderCountEl.textContent = folder.command_ids.size;
  // Se a pasta alterada é a que está sendo filtrada agora, atualiza a
  // visibilidade do card na hora — sem isso, remover um comando da pasta
  // aberta o deixaria visível até o próximo render() completo.
  if (VIEW_FOLDER_ID === folderId) applyFolderFilter();
  else if (VIEW_FOLDERS_HOME) applyAnyFolderFilter();

  const method = wasOn ? 'DELETE' : 'POST';
  fetch(`/api/folders/${folderId}/commands/${encodeURIComponent(cmdId)}`, { method }).catch(e => {
    console.warn('Falha ao atualizar pasta no servidor (mantido localmente)', e);
  });
}

// ── CRUD de pastas — modal de nome compartilhado (create/rename), ver
// #folderPromptOverlay em index.html ──
let _folderPromptResolve = null;
function openFolderPromptModal(mode, currentName) {
  return new Promise(resolve => {
    _folderPromptResolve = resolve;
    document.getElementById('folderPromptTitle').textContent = mode === 'rename' ? 'Rename folder' : 'New folder';
    document.getElementById('folderPromptOkBtn').textContent = mode === 'rename' ? 'Rename' : 'Create';
    const input = document.getElementById('folderPromptInput');
    input.value = currentName || '';
    const errBox = document.getElementById('folderPromptError');
    if (errBox) { errBox.style.display = 'none'; errBox.textContent = ''; }
    document.getElementById('folderPromptOverlay').classList.add('show');
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}
function closeFolderPromptModal(result) {
  document.getElementById('folderPromptOverlay').classList.remove('show');
  if (_folderPromptResolve) { const r = _folderPromptResolve; _folderPromptResolve = null; r(result); }
}
function submitFolderPromptModal() {
  const name = (document.getElementById('folderPromptInput').value || '').trim();
  const errBox = document.getElementById('folderPromptError');
  if (!name) {
    if (errBox) { errBox.textContent = 'Enter a folder name.'; errBox.style.display = ''; }
    return;
  }
  closeFolderPromptModal(name);
}
document.getElementById('folderPromptInput') && document.getElementById('folderPromptInput').addEventListener('keydown', ev => {
  if (ev.key === 'Enter') submitFolderPromptModal();
});
document.getElementById('folderPromptOverlay') && document.getElementById('folderPromptOverlay').addEventListener('click', ev => {
  if (ev.target.id === 'folderPromptOverlay') closeFolderPromptModal(null);
});

// `cmdIdToAddAfter` (opcional): quando a pasta é criada a partir do "+ New
// folder" dentro do dropdown de um card (ver folderMenuHtml() em
// terminal-renderer.js), o comando já entra automaticamente na pasta nova,
// sem precisar reabrir o dropdown e marcar de novo.
async function promptCreateFolder(cmdIdToAddAfter) {
  const name = await openFolderPromptModal('create');
  if (!name) return;
  try {
    const res = await fetch('/api/folders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.message || 'Failed to create folder.');
      return;
    }
    const folder = await res.json();
    FOLDERS.push({ id: folder.id, name: folder.name, sort_order: folder.sort_order, command_ids: new Set(folder.command_ids || []) });
    renderFoldersSidebarList();
    if (cmdIdToAddAfter) {
      toggleCommandInFolder(cmdIdToAddAfter, folder.id, null);
      render(); // reconstrói os cards para o dropdown de pastas já listar a nova
    }
  } catch (e) {
    alert('Failed to create folder. Please try again.');
  }
}
async function promptRenameFolder(id, currentName, ev) {
  if (ev) ev.stopPropagation(); // não deixa o clique também selecionar a pasta (ver selectFolder no row pai)
  const name = await openFolderPromptModal('rename', currentName);
  if (!name || name === currentName) return;
  try {
    const res = await fetch(`/api/folders/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.message || 'Failed to rename folder.');
      return;
    }
    const folder = FOLDERS.find(f => f.id === id);
    if (folder) folder.name = name;
    renderFoldersSidebarList();
  } catch (e) {
    alert('Failed to rename folder. Please try again.');
  }
}
function deleteFolderConfirm(id, name, ev) {
  if (ev) ev.stopPropagation();
  openConfirmModal(`Delete folder "${name}"? Commands inside it are not deleted — they just leave this folder. This action cannot be undone.`).then(ok => {
    if (!ok) return;
    FOLDERS = FOLDERS.filter(f => f.id !== id);
    fetch(`/api/folders/${id}`, { method: 'DELETE' }).catch(e => {
      console.warn('Falha ao excluir pasta no servidor (mantida localmente)', e);
    });
    if (VIEW_FOLDER_ID === id) { VIEW_FOLDER_ID = null; goHome(); }
    else { renderFoldersSidebarList(); render(); }
  });
}

// Filtra os cards pelo texto digitado no campo de pesquisa (nome, descrição, tags e o
// próprio texto dos comandos). Roda depois do filtro de pastas, então só esconde
// mais — nunca reexibe um card que o filtro de pastas já escondeu.
// Chamado a cada tecla digitada no campo de pesquisa: re-renderiza e mostra/esconde o "x" de limpar.
function onSearchInput() {
  updateSearchClearBtn();
  render();
}
function updateSearchClearBtn() {
  const btn = document.getElementById('cmdSearchClear');
  if (!btn) return;
  const hasText = !!(gv('cmdSearch') || '').length;
  btn.style.display = hasText ? 'flex' : 'none';
}
function clearCommandSearch() {
  const input = document.getElementById('cmdSearch');
  if (!input) return;
  saveCmdSearchHistoryEntry(input.value); // preserva o texto no histórico antes de limpar
  input.value = '';
  updateSearchClearBtn();
  render();
  input.focus();
}

// ── Histórico da pesquisa de comandos (sidebar "Search commands...") ──
// Independente do histórico da barra de parâmetros (query-bar.js) — chave própria no
// localStorage, mesma janela de 7 dias e mesmo limite de ~10 itens visíveis com scroll.
// Como aqui é um único texto livre (sem tags/labels), o salvamento acontece só ao sair
// do campo (blur/clique fora) ou ao limpar — nunca a cada tecla digitada.
const CMD_SEARCH_HISTORY_KEY = 'cpa-cmdsearch-history';
const CMD_SEARCH_HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CMD_SEARCH_HISTORY_MAX_ITEMS = 200;

function loadCmdSearchHistoryRaw() {
  try {
    const raw = localStorage.getItem(CMD_SEARCH_HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function saveCmdSearchHistoryRaw(arr) {
  try { localStorage.setItem(CMD_SEARCH_HISTORY_KEY, JSON.stringify(arr)); } catch (e) {}
}
function loadCmdSearchHistory() {
  const now = Date.now();
  const all = loadCmdSearchHistoryRaw();
  const fresh = all.filter(e => e && typeof e.text === 'string' && (now - e.ts) < CMD_SEARCH_HISTORY_MAX_AGE_MS);
  if (fresh.length !== all.length) saveCmdSearchHistoryRaw(fresh);
  return fresh.sort((a, b) => b.ts - a.ts);
}
function saveCmdSearchHistoryEntry(text) {
  text = (text || '').trim();
  if (!text) return;
  const now = Date.now();
  let all = loadCmdSearchHistoryRaw().filter(e => e && e.text !== text && (now - e.ts) < CMD_SEARCH_HISTORY_MAX_AGE_MS);
  all.unshift({ text, ts: now });
  if (all.length > CMD_SEARCH_HISTORY_MAX_ITEMS) all = all.slice(0, CMD_SEARCH_HISTORY_MAX_ITEMS);
  saveCmdSearchHistoryRaw(all);
  renderCmdSearchHistoryUI();
}
function removeCmdSearchHistoryEntry(text) {
  const all = loadCmdSearchHistoryRaw().filter(e => e.text !== text);
  saveCmdSearchHistoryRaw(all);
  renderCmdSearchHistoryUI();
}
function clearCmdSearchHistory() {
  saveCmdSearchHistoryRaw([]);
  renderCmdSearchHistoryUI();
}
function formatCmdSearchHistoryTime(ts) {
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}min ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}
function applyCmdSearchHistoryEntry(text) {
  const input = document.getElementById('cmdSearch');
  if (input) input.value = text;
  updateSearchClearBtn();
  render();
  if (input) input.focus();
}
function escapeCmdSearchHistoryHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
// Ver jsAttrEscape em query-bar.js para a explicação da ordem de escape (JS primeiro,
// depois HTML) — necessária para embutir texto do usuário com segurança dentro de um
// atributo onclick="...('TEXTO')".
function jsAttrEscapeCmdSearch(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
// ── Agrupamento por dia (Hoje/Ontem/dd-mm), com expandir/recolher por grupo — ver
// query-bar.js para a versão irmã (mesma lógica, chave própria em memória). ──
function cmdSearchHistoryDayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function cmdSearchHistoryDayLabel(ts) {
  const startOfDay = t => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(new Date(ts))) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  // dd/mm fixo (não depende do locale do navegador) — mesmo padrão de
  // formatAuditDate (terminal-renderer.js) e queryHistoryDayLabel (query-bar.js).
  const d = new Date(ts);
  const p2 = n => String(n).padStart(2, '0');
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
}
const CMD_SEARCH_HISTORY_COLLAPSED_DAYS = new Set();
function toggleCmdSearchHistoryDay(key) {
  const el = document.querySelector(`#cmdSearchHistoryList .cpq-history-day[data-day-key="${key}"]`);
  if (!el) return;
  const willCollapse = !el.classList.contains('collapsed');
  el.classList.toggle('collapsed', willCollapse);
  if (willCollapse) CMD_SEARCH_HISTORY_COLLAPSED_DAYS.add(key); else CMD_SEARCH_HISTORY_COLLAPSED_DAYS.delete(key);
}
function cmdSearchHistoryItemRowHtml(e) {
  return `<div class="cpq-history-item" onmousedown="event.preventDefault()" onclick="applyCmdSearchHistoryEntry('${jsAttrEscapeCmdSearch(e.text)}')">
    <span class="cpq-history-item-txt" title="${escapeCmdSearchHistoryHtml(e.text)}">${escapeCmdSearchHistoryHtml(e.text)}</span>
    <span class="cpq-history-item-time">${formatCmdSearchHistoryTime(e.ts)}</span>
    <button type="button" class="cpq-history-item-x" onmousedown="event.preventDefault()" onclick="event.stopPropagation(); removeCmdSearchHistoryEntry('${jsAttrEscapeCmdSearch(e.text)}')" title="Remove from history">✕</button>
  </div>`;
}
function renderCmdSearchHistoryUI() {
  const list = document.getElementById('cmdSearchHistoryList');
  if (!list) return;
  const entries = loadCmdSearchHistory(); // já vem ordenado do mais recente para o mais antigo
  const clearBtn = document.getElementById('cmdSearchHistoryClearBtn');
  if (clearBtn) clearBtn.style.display = entries.length ? '' : 'none';
  if (!entries.length) {
    list.innerHTML = `<div class="cpq-history-empty">No recent searches.</div>`;
    return;
  }
  const groups = [];
  entries.forEach(e => {
    const key = cmdSearchHistoryDayKey(e.ts);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(e);
    else groups.push({ key, label: cmdSearchHistoryDayLabel(e.ts), items: [e] });
  });
  list.innerHTML = groups.map(g => {
    const collapsed = CMD_SEARCH_HISTORY_COLLAPSED_DAYS.has(g.key);
    return `<div class="cpq-history-day${collapsed ? ' collapsed' : ''}" data-day-key="${g.key}">
      <div class="cpq-history-day-head" onmousedown="event.preventDefault()" onclick="toggleCmdSearchHistoryDay('${g.key}')">
        <svg class="cpq-history-day-chevron" width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M1 2l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>${g.label}</span>
        <span class="cpq-history-day-count">${g.items.length}</span>
      </div>
      <div class="cpq-history-day-body">${g.items.map(cmdSearchHistoryItemRowHtml).join('')}</div>
    </div>`;
  }).join('');
}
function openCmdSearchHistoryPanel() {
  const panel = document.getElementById('cmdSearchHistoryPanel');
  if (panel) panel.classList.add('open');
  renderCmdSearchHistoryUI();
}
function closeCmdSearchHistoryPanel() {
  const panel = document.getElementById('cmdSearchHistoryPanel');
  if (panel) panel.classList.remove('open');
  saveCmdSearchHistoryEntry(gv('cmdSearch'));
}
document.addEventListener('click', ev => {
  const wrap = ev.target.closest('.cmd-search-wrap');
  if (!wrap) closeCmdSearchHistoryPanel();
});
function applySearchFilter() {
  const out = document.getElementById('out');
  const query = (gv('cmdSearch') || '').trim().toLowerCase();
  const cards = [...out.querySelectorAll('.card')];
  if (query) {
    cards.forEach(c => {
      if (c.style.display === 'none') return;
      if (!c.textContent.toLowerCase().includes(query)) c.style.display = 'none';
    });
  }
  out.querySelectorAll('.section').forEach(sec => {
    const visible = [...sec.querySelectorAll('.card')].some(c => c.style.display !== 'none');
    sec.style.display = visible ? '' : 'none';
  });
  const anyVisible = cards.some(c => c.style.display !== 'none');
  if (query && !anyVisible && !out.querySelector('.empty')) {
    const safe = query.replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]));
    out.insertAdjacentHTML('beforeend', `<div class="empty"><div class="empty-ico">🔍</div><p>No commands found for "${safe}".</p></div>`);
  }
}

// ── Dropdown de pastas de cada card (ver folderMenuHtml() em
// terminal-renderer.js) — abre/fecha como os .dd da sidebar (mesmo padrão de
// fechar-os-outros do toggleDropdown/closeAllDropdowns em js/state.js), só
// que não é um .dd porque vive dentro de .card-actions, não da sidebar. ──
function toggleFolderMenu(ev, btn) {
  ev.stopPropagation();
  const pop = btn.parentElement.querySelector('.folder-menu-pop');
  if (!pop) return;
  const willOpen = !pop.classList.contains('open');
  document.querySelectorAll('.folder-menu-pop.open').forEach(p => { if (p !== pop) p.classList.remove('open'); });
  pop.classList.toggle('open', willOpen);
}
document.addEventListener('click', ev => {
  if (ev.target.closest('.folder-menu-pop') || ev.target.closest('.fav-btn')) return;
  document.querySelectorAll('.folder-menu-pop.open').forEach(p => p.classList.remove('open'));
});
