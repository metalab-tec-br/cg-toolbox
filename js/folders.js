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
// resolveFoldersHome() (js/settings.js) prioriza a última visão memorizada
// (localStorage 'cpa-last-view', gravada por viewAllFolders()/goHome()
// abaixo) sobre a preferência "Home page" — bug reportado: "estou em
// folders e quando atualizo a página está voltando para tela de comandos".
let VIEW_FOLDERS_HOME = resolveFoldersHome(loadSettings());
(() => { const row = document.getElementById('foldersNavRow'); if (row) row.classList.toggle('on', VIEW_FOLDERS_HOME); })();

// Busca as pastas reais do usuário atual no servidor e substitui FOLDERS —
// chamado uma vez no boot (via user-sync.js) depois que o usuário é
// identificado; pode ser chamado de novo a qualquer momento para
// re-sincronizar (ex.: mesma pessoa com duas abas abertas).
async function reloadFoldersFromServer() {
  try {
    const res = await fetch('/api/folders');
    const data = await res.json();
    // `order` (task #458, estendido pela task Notes) já vem do servidor
    // como um array combinado {type:'command'|'note', id} na ordem certa
    // (ver GET /api/folders em server/index.js) — comandos E notas
    // intercalados, não mais só command_ids. `notes` (task Notes) é a
    // lista de notas da pasta, cada uma já com folder_id/title/description.
    // `command_ids` continua um Set (checagem de membership O(1), usada em
    // toda parte) — Sets não preservam posição, por isso `order` é mantido
    // separado.
    FOLDERS = (data || []).map(f => ({
      id: f.id, name: f.name, sort_order: f.sort_order,
      command_ids: new Set(f.command_ids || []),
      notes: f.notes || [],
      order: (f.order || []).slice(),
    }));
    if (typeof render === 'function') render();
  } catch (e) {
    console.warn('Não foi possível carregar as pastas do servidor', e);
  }
}

// ALL_USERS_FOLDERS = pastas de TODOS os usuários (cross-user, ver
// GET /api/folders/all em server/index.js) — usada pelo seletor de escopo de
// pastas dentro de Folders (#folderScopeDD: "All"/um usuário escolhido, ver
// FOLDER_SCOPE abaixo). Diferente de FOLDERS acima (privado, só as pastas do
// usuário atual), aqui cada item já vem com `username` do dono. Carregada
// sob demanda (ao entrar em Folders, ver updateGroupByOptionsForFoldersScope())
// em vez de sempre no boot, já que a maioria fica em "My folders" (padrão).
let ALL_USERS_FOLDERS = [];
async function reloadAllUsersFoldersFromServer() {
  try {
    const res = await fetch('/api/folders/all');
    const data = await res.json();
    ALL_USERS_FOLDERS = (data || []).map(f => ({
      id: f.id, username: f.username, name: f.name, sort_order: f.sort_order,
      command_ids: new Set(f.command_ids || []),
      notes: f.notes || [],
      order: (f.order || []).slice(),
    }));
    // Re-renderiza se o seletor de escopo de pastas dentro de Folders
    // depende desses dados (qualquer escopo diferente de "My folders", ver
    // FOLDER_SCOPE abaixo) — só carrega ALL_USERS_FOLDERS sob demanda,
    // então precisa de um render() depois que a resposta chega.
    const needsRender = typeof VIEW_FOLDERS_HOME !== 'undefined' && VIEW_FOLDERS_HOME
      && typeof FOLDER_SCOPE !== 'undefined' && FOLDER_SCOPE !== 'mine';
    if (typeof render === 'function' && needsRender) render();
    if (typeof renderFolderScopeOptions === 'function') renderFolderScopeOptions();
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
// "Folders" e "User folders" (agrupar por pasta própria / cross-user) foram
// REMOVIDOS do Group by — essas duas visões já são cobertas por inteiro
// pela seção "Folders" da sidebar + o seletor de escopo (#folderScopeDD:
// My folders/usuário escolhido/All), então mantê-las como opções
// duplicadas no Group by só confundia. 'creator' ("Created by") continua
// existindo, só escondido enquanto o usuário está em Folders (ali o
// dropdown inteiro já é substituído pelo seletor de escopo, ver abaixo).
const GROUP_BY_HIDDEN_IN_FOLDERS = ['creator'];
// Dentro de Folders, o controle "Group by" da toolbar (#groupByDD) é
// substituído por inteiro pelo seletor de ESCOPO de pastas (#folderScopeDD
// — ver renderFolderScopeOptions()/setFolderScope() mais abaixo): "My
// folders" (padrão) / um usuário escolhido / "All". Os dois dropdowns
// nunca ficam visíveis ao mesmo tempo — só um "style.display" complementar,
// mesmo padrão já usado pelos seg-btns escondidos abaixo. O rótulo
// compartilhado (#ctbGroupByLabel, ver index.html) troca de texto junto:
// "Group by" fora de Folders, "Filter by" dentro (ali o dropdown não
// agrupa nada, só filtra de quem são as pastas exibidas).
function updateGroupByOptionsForFoldersScope() {
  document.querySelectorAll('.seg-btn[data-val]').forEach(b => {
    if (GROUP_BY_HIDDEN_IN_FOLDERS.includes(b.dataset.val)) {
      b.style.display = VIEW_FOLDERS_HOME ? 'none' : '';
    }
  });
  if (VIEW_FOLDERS_HOME && GROUP_BY_HIDDEN_IN_FOLDERS.includes(GROUP_BY) && typeof setGroupBy === 'function') {
    setGroupBy('topic');
  }
  const groupByDD = document.getElementById('groupByDD');
  const folderScopeDD = document.getElementById('folderScopeDD');
  if (groupByDD) groupByDD.style.display = VIEW_FOLDERS_HOME ? 'none' : '';
  if (folderScopeDD) folderScopeDD.style.display = VIEW_FOLDERS_HOME ? '' : 'none';
  const groupByLabelEl = document.getElementById('ctbGroupByLabel');
  if (groupByLabelEl) groupByLabelEl.textContent = VIEW_FOLDERS_HOME ? 'Filter by' : 'Group by';
  if (VIEW_FOLDERS_HOME) {
    // O seletor de usuário precisa da lista cross-user (ALL_USERS_FOLDERS)
    // pronta — carrega (ou refresca) sob demanda ao entrar em Folders, em
    // vez de manter isso sempre quente no boot pra todo mundo.
    if (typeof reloadAllUsersFoldersFromServer === 'function') reloadAllUsersFoldersFromServer();
    if (typeof renderFolderScopeOptions === 'function') renderFolderScopeOptions();
  }
}
updateGroupByOptionsForFoldersScope();

// ── Seletor de ESCOPO de pastas dentro de Folders (substitui Group by lá —
// ver comentário acima) ──
// FOLDER_SCOPE: 'mine' (padrão) | 'all' | 'user:<username>'. Só em memória
// (não persistido) de propósito, mesma decisão já tomada para
// FOLDER_EDIT_MODE — não precisa sobreviver a um reload da página.
let FOLDER_SCOPE = 'mine';
function folderScopeLabel(scope) {
  if (scope === 'all') return 'All';
  if (scope && scope.startsWith('user:')) return scope.slice('user:'.length);
  return 'My folders';
}
// Lista de usuários pra escolher = quem tem pelo menos uma pasta hoje (ver
// ALL_USERS_FOLDERS), exceto o próprio usuário atual — "My folders" já
// cobre esse caso, não faz sentido duplicar na lista de "outro usuário".
function folderScopeUsernames() {
  const all = typeof ALL_USERS_FOLDERS !== 'undefined' ? ALL_USERS_FOLDERS : [];
  const usernames = [...new Set(all.map(f => f.username))]
    .filter(u => typeof CURRENT_USER === 'undefined' || u !== CURRENT_USER)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return usernames;
}
function renderFolderScopeOptions() {
  const panel = document.getElementById('folderScopeToggle');
  if (!panel) return;
  const usernames = folderScopeUsernames();
  const userRows = usernames.map(u => {
    const jsEsc = typeof jsAttrEscapeCmdSearch === 'function' ? jsAttrEscapeCmdSearch(u) : u;
    const safe = typeof escapeCmdSearchHistoryHtml === 'function' ? escapeCmdSearchHistoryHtml(u) : u;
    return `<button type="button" class="seg-btn${FOLDER_SCOPE === 'user:' + u ? ' on' : ''}" onclick="setFolderScope('user:${jsEsc}')">${safe}</button>`;
  }).join('');
  panel.innerHTML = `
    <button type="button" class="seg-btn${FOLDER_SCOPE === 'mine' ? ' on' : ''}" onclick="setFolderScope('mine')">My folders</button>
    ${userRows}
    <button type="button" class="seg-btn${FOLDER_SCOPE === 'all' ? ' on' : ''}" onclick="setFolderScope('all')">All</button>
  `;
}
function setFolderScope(scope) {
  FOLDER_SCOPE = scope || 'mine';
  renderFolderScopeOptions(); // reconstrói a lista com o item certo marcado ".on"
  const btn = document.getElementById('folderScopeDDBtn');
  const label = btn && btn.querySelector('.dd-label');
  if (label) label.textContent = folderScopeLabel(FOLDER_SCOPE);
  const dd = document.getElementById('folderScopeDD');
  if (dd) dd.classList.remove('open');
  if (FOLDER_SCOPE !== 'mine' && typeof ALL_USERS_FOLDERS !== 'undefined' && !ALL_USERS_FOLDERS.length && typeof reloadAllUsersFoldersFromServer === 'function') {
    reloadAllUsersFoldersFromServer();
  }
  if (typeof render === 'function') render();
}

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
  persistLastView(VIEW_FOLDERS_HOME);
  const nav = document.getElementById('foldersNavRow');
  if (nav) nav.classList.toggle('on', VIEW_FOLDERS_HOME);
  updateGroupByOptionsForFoldersScope();
  render();
}
// Clique no nome/logo do app: volta para a página inicial configurada
// (Folders ou Command menu — ver "Home page" em Configurações). Diferente
// de um F5 (que deve manter a visão atual — ver resolveFoldersHome()), este
// é um clique deliberado pra "ir pra tela inicial", então também grava o
// resultado como a nova visão atual (persistLastView) — senão um F5 logo
// depois de clicar em "voltar pro início" poderia jogar o usuário de volta
// pra Folders, se ele estivesse navegando lá antes.
function goHome() {
  const s = loadSettings();
  VIEW_FOLDERS_HOME = s.home === 'folders';
  persistLastView(VIEW_FOLDERS_HOME);
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
  // Mantém folder.order (task #458, agora um array de {type,id} — task
  // Notes — usado só pra RENDERIZAR na ordem certa — ver buildFolderSection
  // em db-render-engine.js) sincronizado com o Set acima: remove do meio se
  // saiu, ou entra no FIM se entrou (mesmo critério do backend — ver POST
  // /api/folders/:id/commands/:commandId em server/index.js, que dá
  // sort_order = MAX+1 cross-table pro novo membership).
  if (!folder.order) folder.order = [...folder.command_ids].map(id => ({ type: 'command', id }));
  if (wasOn) {
    const idx = folder.order.findIndex(o => o.type === 'command' && o.id === cmdId);
    if (idx !== -1) folder.order.splice(idx, 1);
  } else if (!folder.order.some(o => o.type === 'command' && o.id === cmdId)) {
    folder.order.push({ type: 'command', id: cmdId });
  }
  // Mantém o snapshot cross-user (ALL_USERS_FOLDERS, ver seletor de escopo
  // dentro de Folders) coerente com a própria pasta do usuário atual — sem
  // isso, a seção dele no escopo "All"/outro usuário ficaria com a
  // contagem/ordem antiga até o próximo reload (F5 ou re-escolher o escopo).
  const ownInAllUsers = ALL_USERS_FOLDERS.find(f => f.id === folderId);
  if (ownInAllUsers) {
    if (wasOn) ownInAllUsers.command_ids.delete(cmdId); else ownInAllUsers.command_ids.add(cmdId);
    if (!ownInAllUsers.order) ownInAllUsers.order = [...ownInAllUsers.command_ids].map(id => ({ type: 'command', id }));
    if (wasOn) {
      const idx2 = ownInAllUsers.order.findIndex(o => o.type === 'command' && o.id === cmdId);
      if (idx2 !== -1) ownInAllUsers.order.splice(idx2, 1);
    } else if (!ownInAllUsers.order.some(o => o.type === 'command' && o.id === cmdId)) {
      ownInAllUsers.order.push({ type: 'command', id: cmdId });
    }
  }

  if (VIEW_FOLDERS_HOME) {
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
    const order = (folder.command_ids || []).map(id => ({ type: 'command', id }));
    if (cmdIdToAddAfter) {
      commandIds.add(cmdIdToAddAfter);
      order.push({ type: 'command', id: cmdIdToAddAfter });
      fetch(`/api/folders/${folder.id}/commands/${encodeURIComponent(cmdIdToAddAfter)}`, { method: 'POST' }).catch(e => {
        console.warn('Falha ao adicionar o comando à nova pasta no servidor (mantido localmente)', e);
      });
    }
    FOLDERS.push({ id: folder.id, name: folder.name, sort_order: folder.sort_order, command_ids: commandIds, notes: [], order });
    render(); // reconstrói os cards para o dropdown de pastas (e a seção da pasta, se estiver em Folders) já refletirem a pasta nova
  } catch (e) {
    alert('Failed to create folder. Please try again.');
  }
}
// ── Renomear pasta: nome editável inline no cabeçalho (dentro do modo de
// edição) ──
// Antes exigia clicar num botão "✎ Rename" separado, que abria um modal
// (openFolderPromptModal('rename', ...)) por cima da tela. Agora, dentro do
// modo de edição, o próprio nome no cabeçalho é um <input> (ver
// buildFolderSectionFromCards em db-render-engine.js) — o usuário clica
// direto nele e digita, sem etapa extra. Salva no blur ou Enter; Escape
// cancela sem salvar.
// `ev` (opcional em outras funções deste bloco): quando chamadas a partir do
// cabeçalho de uma seção de pasta (.sec-folder-actions, ver
// buildFolderSectionFromCards em db-render-engine.js), stopPropagation()
// evita que o clique também recolha/expanda a seção (o cabeçalho inteiro tem
// onclick="toggleSection(...)").
function _folderNameInputKeydown(ev) {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    ev.target.blur(); // dispara _folderNameInputBlur, que salva
  } else if (ev.key === 'Escape') {
    ev.preventDefault();
    ev.target.value = ev.target.defaultValue; // reverte sem salvar
    ev.target.blur();
  }
}
async function _folderNameInputBlur(ev) {
  const input = ev.target;
  const id = Number(input.dataset.folderId);
  const oldName = input.defaultValue;
  const newName = input.value.trim();
  if (!newName || newName === oldName) { input.value = oldName; return; } // vazio ou sem mudança: não chama a API
  try {
    const res = await fetch(`/api/folders/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.message || 'Failed to rename folder.');
      input.value = oldName;
      return;
    }
    const folder = FOLDERS.find(f => f.id === id);
    if (folder) folder.name = newName;
    render(); // o nome da pasta aparece no título da sua seção — precisa reconstruir
  } catch (e) {
    alert('Failed to rename folder. Please try again.');
    input.value = oldName;
  }
}
function deleteFolderConfirm(id, name, ev) {
  if (ev) ev.stopPropagation();
  openConfirmModal(`Delete folder "${name}"? Commands inside it are not deleted — they just leave this folder. Notes inside it ARE deleted along with the folder (notes only exist inside a folder). This action cannot be undone.`).then(ok => {
    if (!ok) return;
    FOLDERS = FOLDERS.filter(f => f.id !== id);
    FOLDER_EDIT_MODE.delete(id); // não deixa "vazando" um modo de edição pra um id de pasta que não existe mais
    fetch(`/api/folders/${id}`, { method: 'DELETE' }).catch(e => {
      console.warn('Falha ao excluir pasta no servidor (mantida localmente)', e);
    });
    render();
  });
}

// ── Modo de edição da pasta (task #461, consolidado na task #463) ──
// Um único botão "⚙ Edit folder" no cabeçalho liga/desliga esse modo por
// pasta — SÓ dentro dele é que aparecem Renomear (✎)/Excluir (✕) e os
// cards ficam arrastáveis (embrulhados em .folder-card-row, ver
// wrapCardsForFolderDrag em db-render-engine.js). Fora desse modo, mesmo
// numa pasta própria, a seção mostra só os cards + os botões "+ Note"/"⚙
// Edit" sempre visíveis — renomear/excluir/reordenar por acidente (rolar a
// tela, clicar num card) não deveria ser possível sem entrar deliberadamente
// no modo de edição. `FOLDER_EDIT_MODE` é um Set de folderIds — cada pasta
// liga/desliga o próprio modo independentemente das outras; não persiste
// entre reloads (mesma decisão de sempre pra esse tipo de estado de UI).
let FOLDER_EDIT_MODE = new Set();
// `ev` (opcional): chamado a partir do cabeçalho da seção (.sec-folder-
// actions, ver buildFolderSectionFromCards em db-render-engine.js) —
// mesmo motivo de stopPropagation() de promptRenameFolder/deleteFolderConfirm.
function toggleFolderEditMode(folderId, ev) {
  if (ev) ev.stopPropagation();
  if (FOLDER_EDIT_MODE.has(folderId)) FOLDER_EDIT_MODE.delete(folderId);
  else FOLDER_EDIT_MODE.add(folderId);
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
      // Cada row embrulha OU um card de comando (data-cmd-id) OU um card de
      // nota (data-note-id, ver buildNoteCardHtml em db-render-engine.js) —
      // lê qualquer um dos dois pra remontar o array combinado {type,id} na
      // ordem em que ficaram no DOM depois do drag.
      const orderedTagged = [...container.querySelectorAll(`.folder-card-row[data-folder-id="${folderId}"]`)]
        .map(r => {
          const card = r.querySelector('.card');
          if (!card) return null;
          if (card.dataset.noteId) return { type: 'note', id: Number(card.dataset.noteId) };
          if (card.dataset.cmdId) return { type: 'command', id: card.dataset.cmdId };
          return null;
        })
        .filter(Boolean);
      if (orderedTagged.length) reorderFolderItems(folderId, orderedTagged);
    }
  }
  _fcDragRow = null;
});
// Persiste a nova ordem (comandos E notas — task Notes) — otimista (atualiza
// FOLDERS/ALL_USERS_FOLDERS local na hora; a UI já está com a ordem certa,
// já que veio de um reorder no próprio DOM) + PUT em segundo plano. Não
// chama render() — reconstruir o HTML aqui destruiria a própria row que
// acabou de ser soltada. `orderedTagged` é um array de {type, id}.
function reorderFolderItems(folderId, orderedTagged) {
  const folder = FOLDERS.find(f => f.id === folderId);
  if (folder) folder.order = orderedTagged.slice();
  const ownInAllUsers = ALL_USERS_FOLDERS.find(f => f.id === folderId);
  if (ownInAllUsers) ownInAllUsers.order = orderedTagged.slice();
  fetch(`/api/folders/${folderId}/reorder`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: orderedTagged }),
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
      // /copy agora também duplica as notas da pasta original (a pedido do
      // usuário — antes só trazia os comandos) e já devolve `notes`/`order`
      // prontos (ver POST /api/folders/:id/copy, server/index.js), então
      // basta usar o que veio da resposta em vez de derivar. As notas
      // copiadas já chegam com username = quem copiou (nunca o autor
      // original), então já são totalmente editáveis/clonáveis/excluíveis
      // por este usuário como qualquer outra nota própria.
      FOLDERS.push({
        id: folder.id, name: folder.name, sort_order: folder.sort_order,
        command_ids: new Set(folder.command_ids || []),
        notes: folder.notes || [],
        order: folder.order || [],
      });
      render(); // a pasta nova precisa aparecer nos dropdowns de pasta de cada card, e em "Folders"/"My folders" se o usuário for lá depois
    } catch (e) {
      alert('Failed to copy folder. Please try again.');
    }
  });
}

// ── Notes (task Notes) — anotações livres dentro de uma pasta própria ──
// Editor compartilhado create/edit num modal (#noteEditorOverlay em
// index.html), mesmo padrão de openFolderPromptModal acima.
// Redesign (pedido: "achei confusa a tela de notas com comandos, ajustar
// para que fiquem em um só campo e o usuário possa colocar negrito,
// itálico etc, deixar o fundo transparente"): não existe mais um campo de
// Título separado — é tudo HTML "rico" digitado num único <div
// contenteditable> (#noteBodyEditor), com uma pequena barra de negrito/
// itálico/sublinhado (ver neExec abaixo) e suporte a colar imagens
// (convertidas pra data URI e inseridas como <img>, ver _neHandlePaste) e
// redimensioná-las arrastando o canto inferior direito (ver
// _neArmImageResize). O backend ainda tem uma coluna `title` (ver
// schema.sql) — em vez de removê-la (migração desnecessária), ela é
// preenchida automaticamente a partir do texto puro da nota (ver
// _deriveNoteTitle abaixo), só pra uso interno: mensagem de confirmação ao
// excluir e nome ao clonar (" (copy)"). O usuário nunca vê/edita esse campo
// diretamente. O servidor sanitiza o HTML antes de gravar (sanitizeNoteHtml
// em server/index.js) — o front-end não precisa (e não deveria) confiar no
// próprio HTML gerado como seguro por si só, mas também não faz
// sanitização própria aqui: só o servidor é a fonte de verdade do que fica
// salvo.
let _noteEditorFolderId = null;
let _noteEditorNoteId = null;
// Deriva um "título" curto a partir do texto puro da nota — só usado
// internamente (ver comentário acima), nunca mostrado como campo próprio.
function _deriveNoteTitle(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  const text = (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
  return text.length > 80 ? text.slice(0, 80).trim() + '…' : text;
}
function openNoteEditor(mode, folderId, noteId, ev) {
  if (ev) ev.stopPropagation();
  _noteEditorFolderId = folderId;
  _noteEditorNoteId = noteId || null;
  let description = '';
  if (mode === 'edit' && noteId) {
    const folder = FOLDERS.find(f => f.id === folderId);
    const note = folder && (folder.notes || []).find(n => n.id === noteId);
    if (note) { description = note.description || ''; }
  }
  const titleEl = document.getElementById('noteEditorTitle');
  if (titleEl) titleEl.textContent = mode === 'edit' ? 'Edit note' : 'New note';
  const body = document.getElementById('noteBodyEditor');
  if (body) {
    body.innerHTML = description;
    _neArmExistingImages(body);
  }
  const overlay = document.getElementById('noteEditorOverlay');
  if (overlay) overlay.classList.add('show');
  setTimeout(() => { if (body) body.focus(); }, 0);
}
function closeNoteEditorModal() {
  const overlay = document.getElementById('noteEditorOverlay');
  if (overlay) overlay.classList.remove('show');
  _noteEditorFolderId = null;
  _noteEditorNoteId = null;
}
// Botões da barra de formatação (negrito/itálico/sublinhado/alinhamento) do
// editor — document.execCommand está deprecated mas continua funcionando em
// todos os navegadores relevantes pra formatar um <div contenteditable>
// local; é a mesma abordagem simples já usada pra colar/redimensionar
// imagem aqui (sem editor de terceiros). O onmousedown="event.preventDefault()"
// no botão (ver index.html) evita que o clique tire o foco/seleção de texto
// do editor antes do comando rodar — sem isso, a seleção seria perdida e
// nada seria formatado.
function neExec(cmd) {
  const body = document.getElementById('noteBodyEditor');
  if (body) body.focus();
  document.execCommand(cmd, false, null);
}

// Tamanho de fonte e cor (pedido: "permita o usuário alterar o tamanho da
// fonte, a cor e alinha para esquerda, centro e direita") usam um <select>
// e um <input type="color"> (ver index.html) — diferente dos botões acima,
// esses dois elementos PRECISAM ganhar foco pra funcionar (senão o
// navegador não abre o dropdown/seletor de cor nativo), então
// onmousedown="event.preventDefault()" não é uma opção aqui: o foco (e,
// nos navegadores mais rigorosos, a seleção de texto dentro do editor)
// pode se perder ao clicar neles. Por isso guardamos a última seleção real
// feita dentro de #noteBodyEditor (_neSaveSelection, disparado em
// mouseup/keyup lá dentro) e a restauramos (_neRestoreSelection) antes de
// aplicar o comando — sem isso, escolher um tamanho/cor formataria uma
// seleção vazia/errada (ou nenhuma).
let _neLastRange = null;
function _neSaveSelection() {
  const body = document.getElementById('noteBodyEditor');
  const sel = window.getSelection();
  if (body && sel && sel.rangeCount && body.contains(sel.anchorNode)) {
    _neLastRange = sel.getRangeAt(0).cloneRange();
  }
}
function _neRestoreSelection() {
  const body = document.getElementById('noteBodyEditor');
  if (!body) return;
  body.focus();
  if (_neLastRange) {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(_neLastRange);
  }
}
document.getElementById('noteBodyEditor') && document.getElementById('noteBodyEditor').addEventListener('mouseup', _neSaveSelection);
document.getElementById('noteBodyEditor') && document.getElementById('noteBodyEditor').addEventListener('keyup', _neSaveSelection);

// document.execCommand('fontSize', ...) só aceita a escala legada de 1 a 7
// (sem controle em pixels) — o truque padrão (sem precisar de nenhuma lib)
// é aplicar o tamanho 7 (usado só como marcador único, fácil de achar
// depois) e então trocar cada <font size="7"> resultante por um `style`
// inline com o tamanho em px de verdade, removendo o atributo `size`. O
// próprio <select> volta pro placeholder ("Size") depois de aplicar (ver
// onchange em index.html), pra poder escolher o MESMO tamanho de novo em
// seguida sem precisar trocar de opção primeiro.
function neSetFontSize(px) {
  if (!px) return;
  _neRestoreSelection();
  document.execCommand('fontSize', false, '7');
  const body = document.getElementById('noteBodyEditor');
  if (!body) return;
  body.querySelectorAll('font[size="7"]').forEach(el => {
    el.removeAttribute('size');
    el.style.fontSize = px + 'px';
  });
}
function neSetColor(color) {
  _neRestoreSelection();
  document.execCommand('foreColor', false, color);
}
async function saveNoteEditor() {
  const bodyEl = document.getElementById('noteBodyEditor');
  const description = bodyEl ? bodyEl.innerHTML : '';
  // "Vazia" = sem texto E sem nenhuma imagem colada — uma nota só com
  // imagem (sem nenhum texto) ainda é válida, então não basta checar se
  // sobra texto depois de tirar as tags (isso descartaria uma nota só de
  // imagem, já que <img> também some nesse strip).
  const hasText = !!((bodyEl && bodyEl.textContent) || '').trim();
  const hasImage = !!(bodyEl && bodyEl.querySelector('img'));
  if (!hasText && !hasImage) {
    alert('Write something in the note.');
    return;
  }
  const title = _deriveNoteTitle(description);
  const folderId = _noteEditorFolderId, noteId = _noteEditorNoteId;
  try {
    const res = noteId
      ? await fetch(`/api/notes/${noteId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, description }) })
      : await fetch(`/api/folders/${folderId}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, description }) });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      alert(errBody.message || 'Failed to save note.');
      return;
    }
    const note = await res.json();
    const folder = FOLDERS.find(f => f.id === note.folder_id);
    if (folder) {
      if (!folder.notes) folder.notes = [];
      const idx = folder.notes.findIndex(n => n.id === note.id);
      if (idx !== -1) folder.notes[idx] = note; else folder.notes.push(note);
      if (!folder.order) folder.order = [];
      if (!folder.order.some(o => o.type === 'note' && o.id === note.id)) folder.order.push({ type: 'note', id: note.id });
    }
    closeNoteEditorModal();
    render();
  } catch (e) {
    alert('Failed to save note. Please try again.');
  }
}
function deleteNoteConfirm(noteId, title, ev) {
  if (ev) ev.stopPropagation();
  openConfirmModal(`Delete note "${title}"? This action cannot be undone.`).then(ok => {
    if (!ok) return;
    FOLDERS.forEach(f => {
      if (f.notes) f.notes = f.notes.filter(n => n.id !== noteId);
      if (f.order) f.order = f.order.filter(o => !(o.type === 'note' && o.id === noteId));
    });
    render();
    fetch(`/api/notes/${noteId}`, { method: 'DELETE' }).catch(e => {
      console.warn('Falha ao excluir nota no servidor (mantida localmente)', e);
    });
  });
}
// Clona uma nota PRÓPRIA na MESMA pasta (título com sufixo " (copy)", ver
// POST /api/notes/:id/clone em server/index.js) — mesmo espírito do
// "Duplicate command", mas sem precisar abrir editor: já cria a cópia
// direto e a tela reflete na hora.
async function cloneNote(noteId, ev) {
  if (ev) ev.stopPropagation();
  try {
    const res = await fetch(`/api/notes/${noteId}/clone`, { method: 'POST' });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      alert(errBody.message || 'Failed to clone note.');
      return;
    }
    const note = await res.json();
    const folder = FOLDERS.find(f => f.id === note.folder_id);
    if (folder) {
      if (!folder.notes) folder.notes = [];
      folder.notes.push(note);
      if (!folder.order) folder.order = [];
      folder.order.push({ type: 'note', id: note.id });
    }
    render();
  } catch (e) {
    alert('Failed to clone note. Please try again.');
  }
}

// ── Colar/redimensionar imagens dentro da nota (task Notes) ──
// Cola uma imagem (Ctrl+V com uma imagem na área de transferência) dentro
// do editor: intercepta o evento de paste, lê o arquivo via FileReader
// (mesma técnica já usada pra linhas de comando tipo 'image', ver
// _ceHandleImageFileInput em js/command-editor.js) e insere um <img> no
// ponto do cursor como data URI base64 — sem upload nem endpoint próprio de
// arquivo, a imagem vira parte do próprio HTML da nota. Colar texto normal
// continua funcionando do jeito padrão do navegador (contenteditable).
function _neHandlePaste(ev) {
  const items = (ev.clipboardData && ev.clipboardData.items) || [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type && item.type.startsWith('image/')) {
      ev.preventDefault();
      const file = item.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => _neInsertImage(reader.result);
      reader.readAsDataURL(file);
      return;
    }
  }
}
function _neInsertImage(dataUrl) {
  const editor = document.getElementById('noteBodyEditor');
  if (!editor) return;
  const img = document.createElement('img');
  img.src = dataUrl;
  img.width = 320; // largura inicial razoável — arrastável depois pelo canto (ver _neArmImageResize)
  editor.focus();
  const sel = window.getSelection();
  if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(img);
    range.setStartAfter(img);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    editor.appendChild(img);
  }
  _neArmImageResize(img);
}
// Redimensiona arrastando o canto inferior-direito da imagem (últimos 16px
// x16px) — só altera a largura (atributo `width`, o mesmo que
// sanitizeNoteHtml preserva no servidor); a altura acompanha
// proporcionalmente sozinha (comportamento padrão do navegador pra um
// <img width="N"> sem height fixado).
function _neArmImageResize(img) {
  img.style.cursor = 'nwse-resize';
  img.addEventListener('mousedown', ev => {
    const rect = img.getBoundingClientRect();
    const nearCorner = (ev.clientX > rect.right - 16) && (ev.clientY > rect.bottom - 16);
    if (!nearCorner) return;
    ev.preventDefault();
    const startX = ev.clientX;
    const startWidth = rect.width;
    function onMove(moveEv) {
      const newWidth = Math.max(40, Math.min(900, startWidth + (moveEv.clientX - startX)));
      img.width = Math.round(newWidth);
      img.removeAttribute('height');
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
// Ao abrir o editor pra EDITAR uma nota existente, as imagens que já
// estavam na descrição também precisam da alça de redimensionar — só as
// coladas na hora (via _neInsertImage) ganham isso automaticamente.
function _neArmExistingImages(container) {
  container.querySelectorAll('img').forEach(img => _neArmImageResize(img));
}
document.getElementById('noteBodyEditor') && document.getElementById('noteBodyEditor').addEventListener('paste', _neHandlePaste);
document.getElementById('noteEditorOverlay') && document.getElementById('noteEditorOverlay').addEventListener('click', ev => {
  if (ev.target.id === 'noteEditorOverlay') closeNoteEditorModal();
});

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
// A chave inclui o usuário atual (CURRENT_USER, ver js/user-sync.js) —
// mesmo motivo/mesma técnica do histórico de query-bar.js: sem isso, dois
// usuários que fazem login/logout local no mesmo navegador (js/auth.js)
// veriam o histórico de busca um do outro, já que o localStorage é do
// navegador, não da sessão lógica da aplicação. Enquanto CURRENT_USER
// ainda não foi resolvido, load/save não fazem nada (falha fechada, nunca
// um balde "anônimo" compartilhado entre usuários).
function cmdSearchHistoryKey() {
  return 'cpa-cmdsearch-history:' + CURRENT_USER;
}
const CMD_SEARCH_HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CMD_SEARCH_HISTORY_MAX_ITEMS = 200;

function loadCmdSearchHistoryRaw() {
  if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return [];
  try {
    const raw = localStorage.getItem(cmdSearchHistoryKey());
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function saveCmdSearchHistoryRaw(arr) {
  if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return;
  try { localStorage.setItem(cmdSearchHistoryKey(), JSON.stringify(arr)); } catch (e) {}
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
