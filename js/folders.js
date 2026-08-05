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

// VIEW_FOLDERS_HOME = visão "Folders" ativa (home page ou clique em
// #foldersNavRow) — mostra todo comando que esteja em QUALQUER pasta do
// usuário, uma seção recolhível por pasta (ver buildFolderSection em
// db-render-engine.js), mesmo estilo visual dos Tópicos. Não existe mais
// navegação por pasta individual pela sidebar (ela não lista mais as pastas
// — a pedido do usuário; renomear/excluir uma pasta agora é feito no
// cabeçalho da própria seção, ver .sec-folder-actions em components.css).
let VIEW_FOLDERS_HOME = loadSettings().home === 'folders';
(() => { const row = document.getElementById('foldersNavRow'); if (row) row.classList.toggle('on', VIEW_FOLDERS_HOME); })();

// Busca as pastas reais do usuário atual no servidor e substitui FOLDERS —
// chamado uma vez no boot (via user-sync.js) depois que o usuário é
// identificado; pode ser chamado de novo a qualquer momento para
// re-sincronizar (ex.: mesma pessoa com duas abas abertas).
async function reloadFoldersFromServer() {
  try {
    const res = await fetch('/api/folders');
    const data = await res.json();
    // `order` (task #458) é a MESMA lista que o servidor já devolve em
    // command_ids — ele já vem ordenado por sort_order (ver GET /api/folders
    // em server/index.js) — só guardamos uma cópia própria porque
    // command_ids vira um Set (checagem de membership O(1), usada em toda
    // parte) e Sets não preservam uma noção de "posição" utilizável pra
    // reconstruir a ordem de renderização depois.
    FOLDERS = (data || []).map(f => ({ id: f.id, name: f.name, sort_order: f.sort_order, command_ids: new Set(f.command_ids || []), order: (f.command_ids || []).slice() }));
    if (typeof render === 'function') render();
  } catch (e) {
    console.warn('Não foi possível carregar as pastas do servidor', e);
  }
}

// ALL_USERS_FOLDERS = pastas de TODOS os usuários (cross-user, ver
// GET /api/folders/all em server/index.js) — usada só pelo Group by "User
// folders" (valor interno 'user-folders', ver js/render.js). Diferente de
// FOLDERS acima (privado, só as pastas do usuário atual), aqui cada item já
// vem com `username` do dono. Carregada sob demanda (quando o usuário
// escolhe "User folders" no dropdown, ver setGroupBy() em js/settings.js) em
// vez de sempre no boot, já que a maioria nunca vai usar essa visão.
let ALL_USERS_FOLDERS = [];
async function reloadAllUsersFoldersFromServer() {
  try {
    const res = await fetch('/api/folders/all');
    const data = await res.json();
    ALL_USERS_FOLDERS = (data || []).map(f => ({ id: f.id, username: f.username, name: f.name, sort_order: f.sort_order, command_ids: new Set(f.command_ids || []), order: (f.command_ids || []).slice() }));
    if (typeof render === 'function' && GROUP_BY === 'user-folders') render();
  } catch (e) {
    console.warn('Não foi possível carregar as pastas de todos os usuários', e);
  }
}

// "Created by" e "User folders" são visões cross-user — não fazem sentido
// dentro de Folders (VIEW_FOLDERS_HOME), que já é o recorte privado das
// PRÓPRIAS pastas do usuário (pedido do usuário: dentro de Folders, o Group
// by só deve oferecer Topic/Folders/Version). Escondidos via style.display
// direto nos botões (mesmos .seg-btn usados no dropdown da toolbar E no
// modal de Configurações — document.querySelectorAll pega os dois de uma
// vez). Se a opção escondida estava ativa, volta pra Topic. Chamada sempre
// que VIEW_FOLDERS_HOME muda (viewAllFolders/goHome) e uma vez no boot,
// logo depois de VIEW_FOLDERS_HOME ser inicializado acima.
const GROUP_BY_HIDDEN_IN_FOLDERS = ['creator', 'user-folders'];
function updateGroupByOptionsForFoldersScope() {
  document.querySelectorAll('.seg-btn[data-val]').forEach(b => {
    if (GROUP_BY_HIDDEN_IN_FOLDERS.includes(b.dataset.val)) {
      b.style.display = VIEW_FOLDERS_HOME ? 'none' : '';
    }
  });
  if (VIEW_FOLDERS_HOME && GROUP_BY_HIDDEN_IN_FOLDERS.includes(GROUP_BY) && typeof setGroupBy === 'function') {
    setGroupBy('topic');
  }
}
updateGroupByOptionsForFoldersScope();

// ── Navegação: visão combinada de Folders / home ──
// Clique no cabeçalho "Folders" da sidebar — funciona como um toggle: clicar
// de novo enquanto já está ativo desliga a visão e volta para o menu normal
// (todos os comandos, agrupados por Tópico/etc. de novo), em vez de ficar
// preso em Folders sem um jeito óbvio de sair. Mesmo easter egg de sempre
// (Ctrl+Alt+clique, ver _q7 em js/state.js) preservado aqui no lugar de
// toggleFavoritesView(), que cumpria o mesmo papel antes.
function viewAllFolders() {
  if (_q7 === 3) return _rvl9();
  VIEW_FOLDERS_HOME = !VIEW_FOLDERS_HOME;
  const nav = document.getElementById('foldersNavRow');
  if (nav) nav.classList.toggle('on', VIEW_FOLDERS_HOME);
  updateGroupByOptionsForFoldersScope();
  render();
}
// Clique no nome/logo do app: volta para a página inicial configurada
// (Folders ou Command menu — ver "Home page" em Configurações).
function goHome() {
  const s = loadSettings();
  VIEW_FOLDERS_HOME = s.home === 'folders';
  const nav = document.getElementById('foldersNavRow');
  if (nav) nav.classList.toggle('on', VIEW_FOLDERS_HOME);
  updateGroupByOptionsForFoldersScope();
  render();
}

// ── Membership: adicionar/remover um comando de uma pasta (chamado pelo
// dropdown de pastas de cada card — ver folderMenuHtml()/toggleFolderMenu()
// em js/terminal-renderer.js) ──
//
// Navegando por Folders (VIEW_FOLDERS_HOME) ou com Group By = "My folders"
// (ver js/render.js: buildSections()), a tela é organizada em seções POR
// PASTA — um comando marcado/desmarcado muda quais cards aparecem em quais
// seções, o que exige reconstruir o HTML (render() completo), não só trocar
// uma classe. Fora desses casos (navegando normalmente por Tópico/Versão/
// Created by, com o dropdown de pastas aberto no próprio card), a
// atualização é otimista — marca/desmarca só o item clicado e o botão de
// pasta do card, SEM re-renderizar — para o dropdown continuar aberto e
// permitir marcar várias pastas em sequência.
function toggleCommandInFolder(cmdId, folderId, itemEl) {
  const folder = FOLDERS.find(f => f.id === folderId);
  if (!folder) return;
  const wasOn = folder.command_ids.has(cmdId);
  if (wasOn) folder.command_ids.delete(cmdId); else folder.command_ids.add(cmdId);
  // Mantém folder.order (task #458, lista usada só pra RENDERIZAR na ordem
  // certa — ver buildFolderSection em db-render-engine.js) sincronizado com
  // o Set acima: remove do meio se saiu, ou entra no FIM se entrou (mesmo
  // critério do backend — ver POST /api/folders/:id/commands/:commandId em
  // server/index.js, que dá sort_order = MAX+1 pro novo membership).
  if (!folder.order) folder.order = [...folder.command_ids];
  if (wasOn) {
    const idx = folder.order.indexOf(cmdId);
    if (idx !== -1) folder.order.splice(idx, 1);
  } else if (!folder.order.includes(cmdId)) {
    folder.order.push(cmdId);
  }
  // Mantém o snapshot cross-user (ALL_USERS_FOLDERS, ver Group by "User
  // folders") coerente com a própria pasta do usuário atual — sem isso, a
  // seção dele em "User folders" ficaria com a contagem/ordem antiga até o
  // próximo reload (F5 ou re-escolher o Group by).
  const ownInAllUsers = ALL_USERS_FOLDERS.find(f => f.id === folderId);
  if (ownInAllUsers) {
    if (wasOn) ownInAllUsers.command_ids.delete(cmdId); else ownInAllUsers.command_ids.add(cmdId);
    if (!ownInAllUsers.order) ownInAllUsers.order = [...ownInAllUsers.command_ids];
    if (wasOn) {
      const idx2 = ownInAllUsers.order.indexOf(cmdId);
      if (idx2 !== -1) ownInAllUsers.order.splice(idx2, 1);
    } else if (!ownInAllUsers.order.includes(cmdId)) {
      ownInAllUsers.order.push(cmdId);
    }
  }

  if (VIEW_FOLDERS_HOME || GROUP_BY === 'my-folders' || GROUP_BY === 'user-folders') {
    render();
  } else if (itemEl) {
    itemEl.classList.toggle('on', !wasOn);
    const chk = itemEl.querySelector('.folder-menu-chk');
    if (chk) chk.textContent = wasOn ? '' : '✓';
    const card = document.querySelector(`.card[data-cmd-id="${CSS.escape(cmdId)}"]`);
    if (card) {
      const inAnyFolder = FOLDERS.some(f => f.command_ids.has(cmdId));
      const btn = card.querySelector('.fav-wrap .fav-btn');
      if (btn) btn.classList.toggle('on', inAnyFolder);
    }
  }

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
    const commandIds = new Set(folder.command_ids || []);
    const order = (folder.command_ids || []).slice();
    if (cmdIdToAddAfter) {
      commandIds.add(cmdIdToAddAfter);
      order.push(cmdIdToAddAfter);
      fetch(`/api/folders/${folder.id}/commands/${encodeURIComponent(cmdIdToAddAfter)}`, { method: 'POST' }).catch(e => {
        console.warn('Falha ao adicionar o comando à nova pasta no servidor (mantido localmente)', e);
      });
    }
    FOLDERS.push({ id: folder.id, name: folder.name, sort_order: folder.sort_order, command_ids: commandIds, order });
    render(); // reconstrói os cards para o dropdown de pastas (e a seção da pasta, se estiver em Folders) já refletirem a pasta nova
  } catch (e) {
    alert('Failed to create folder. Please try again.');
  }
}
// `ev` (opcional): quando chamado a partir do cabeçalho de uma seção de
// pasta (.sec-folder-actions, ver buildFolderSection em
// db-render-engine.js), stopPropagation() evita que o clique também
// recolha/expanda a seção (o cabeçalho inteiro tem onclick="toggleSection(...)")
async function promptRenameFolder(id, currentName, ev) {
  if (ev) ev.stopPropagation();
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
    render(); // o nome da pasta aparece no título da sua seção — precisa reconstruir
  } catch (e) {
    alert('Failed to rename folder. Please try again.');
  }
}
function deleteFolderConfirm(id, name, ev) {
  if (ev) ev.stopPropagation();
  openConfirmModal(`Delete folder "${name}"? Commands inside it are not deleted — they just leave this folder. This action cannot be undone.`).then(ok => {
    if (!ok) return;
    FOLDERS = FOLDERS.filter(f => f.id !== id);
    FOLDER_REORDER_MODE.delete(id); // não deixa "vazando" um modo de edição pra um id de pasta que não existe mais
    fetch(`/api/folders/${id}`, { method: 'DELETE' }).catch(e => {
      console.warn('Falha ao excluir pasta no servidor (mantida localmente)', e);
    });
    render();
  });
}

// ── Modo de edição de ordem por pasta (task #461) ──
// Arrastar os cards só é possível DENTRO desse modo — fora dele, mesmo numa
// pasta própria, os cards renderizam normais (sem alça de arrastar, ver
// wrapCardsForFolderDrag em db-render-engine.js), pra evitar reordenar algo
// por acidente ao rolar a tela ou clicar num card. `FOLDER_REORDER_MODE` é
// um Set de folderIds — cada pasta liga/desliga o próprio modo
// independentemente das outras, e o estado não precisa sobreviver a um
// reload da página (não é persistido em localStorage/servidor).
let FOLDER_REORDER_MODE = new Set();
// `ev` (opcional): chamado a partir do cabeçalho da seção (.sec-folder-
// actions, ver buildFolderSectionFromCards em db-render-engine.js) —
// mesmo motivo de stopPropagation() de promptRenameFolder/deleteFolderConfirm.
function toggleFolderReorderMode(folderId, ev) {
  if (ev) ev.stopPropagation();
  if (FOLDER_REORDER_MODE.has(folderId)) FOLDER_REORDER_MODE.delete(folderId);
  else FOLDER_REORDER_MODE.add(folderId);
  render();
}

// ── Reordenar os comandos DENTRO de uma pasta (task #458) ──
// Drag-to-reorder nos cards de uma seção de pasta — mesmo padrão de
// _ceArmLineDrag em js/command-editor.js (linhas do editor de comandos):
// `draggable` só é setado no mousedown do handle (⠿, ver
// wrapCardsForFolderDrag em db-render-engine.js), não na row inteira, pra
// não interferir com cliques nos botões/links dentro do card. Só existe
// handle em pastas do PRÓPRIO usuário (withActions=true, ver
// buildFolderSectionFromCards) — a pasta de outro usuário (Group by "User
// folders") é só leitura, e o backend recusaria a requisição de qualquer
// forma (PUT /api/folders/:id/reorder só aceita WHERE username = usuário
// atual).
function _fcArmDrag(handle) {
  const row = handle.closest('.folder-card-row');
  if (row) row.setAttribute('draggable', 'true');
}
document.addEventListener('mouseup', () => {
  document.querySelectorAll('.folder-card-row[draggable="true"]').forEach(r => r.removeAttribute('draggable'));
});
let _fcDragRow = null;
document.addEventListener('dragstart', ev => {
  const row = ev.target.closest && ev.target.closest('.folder-card-row');
  if (!row || !row.hasAttribute('draggable')) return;
  _fcDragRow = row;
  row.classList.add('dragging');
  ev.dataTransfer.effectAllowed = 'move';
  ev.dataTransfer.setData('text/plain', ''); // exigido pelo Firefox para permitir o drag
});
document.addEventListener('dragover', ev => {
  if (!_fcDragRow) return;
  const overRow = ev.target.closest && ev.target.closest('.folder-card-row');
  // Só reordena dentro da MESMA pasta (data-folder-id) — arrastar um card
  // pra dentro da seção de outra pasta na mesma tela (ex.: um comando que
  // está em duas pastas, cada uma com sua seção) não move nada entre elas.
  if (!overRow || overRow === _fcDragRow || overRow.dataset.folderId !== _fcDragRow.dataset.folderId) return;
  ev.preventDefault();
  const rect = overRow.getBoundingClientRect();
  const before = (ev.clientY - rect.top) < rect.height / 2;
  overRow.parentElement.insertBefore(_fcDragRow, before ? overRow : overRow.nextSibling);
});
document.addEventListener('drop', ev => { if (_fcDragRow) ev.preventDefault(); });
document.addEventListener('dragend', ev => {
  const row = ev.target.closest && ev.target.closest('.folder-card-row');
  if (row) {
    row.classList.remove('dragging');
    row.removeAttribute('draggable');
    const folderId = Number(row.dataset.folderId);
    const container = row.parentElement;
    if (folderId && container) {
      const orderedIds = [...container.querySelectorAll(`.folder-card-row[data-folder-id="${folderId}"]`)]
        .map(r => { const card = r.querySelector('.card'); return card ? card.dataset.cmdId : null; })
        .filter(Boolean);
      if (orderedIds.length) reorderFolderCommands(folderId, orderedIds);
    }
  }
  _fcDragRow = null;
});
// Persiste a nova ordem — otimista (atualiza FOLDERS/ALL_USERS_FOLDERS local
// na hora; a UI já está com a ordem certa, já que veio de um reorder no
// próprio DOM) + PUT em segundo plano. Não chama render() — reconstruir o
// HTML aqui destruiria a própria row que acabou de ser soltada.
function reorderFolderCommands(folderId, orderedIds) {
  const folder = FOLDERS.find(f => f.id === folderId);
  if (folder) folder.order = orderedIds.slice();
  const ownInAllUsers = ALL_USERS_FOLDERS.find(f => f.id === folderId);
  if (ownInAllUsers) ownInAllUsers.order = orderedIds.slice();
  fetch(`/api/folders/${folderId}/reorder`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command_ids: orderedIds }),
  }).catch(e => {
    console.warn('Falha ao salvar a nova ordem da pasta no servidor (mantida localmente)', e);
  });
}

// ── Copiar uma pasta de OUTRO usuário para a própria lista (task #459) ──
// Só aparece no Group by "User folders" (ver render.js), na pasta de
// alguém que não seja CURRENT_USER (ver buildFolderSectionFromCards:
// `copyable` é passado como !isOwn). O backend (POST /api/folders/:id/copy)
// cria uma pasta NOVA com os mesmos comandos/ordem — a pasta original de
// quem copiamos não é alterada nem removida.
function copyFolderFromUser(folderId, folderName, ev) {
  if (ev) ev.stopPropagation();
  openConfirmModal(`Copy folder "${folderName}" to your own Folders? This creates a new folder with the same commands — it won't affect the original.`).then(async ok => {
    if (!ok) return;
    try {
      const res = await fetch(`/api/folders/${folderId}/copy`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.message || 'Failed to copy folder.');
        return;
      }
      const folder = await res.json();
      FOLDERS.push({
        id: folder.id, name: folder.name, sort_order: folder.sort_order,
        command_ids: new Set(folder.command_ids || []), order: (folder.command_ids || []).slice(),
      });
      render(); // a pasta nova precisa aparecer nos dropdowns de pasta de cada card, e em "Folders"/"My folders" se o usuário for lá depois
    } catch (e) {
      alert('Failed to copy folder. Please try again.');
    }
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
