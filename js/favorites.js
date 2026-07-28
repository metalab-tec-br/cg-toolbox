// ════════════════════════════════════════════════
// FAVORITOS — compartilhados entre usuários (ver server/index.js: user_favorites).
// Ao contrário do antigo esquema (localStorage por navegador), os favoritos de
// CADA usuário agora vivem no servidor, identificados pelo login do Windows (ver
// js/user-sync.js). Isso permite: (1) a mesma pessoa ver os mesmos favoritos em
// qualquer navegador/máquina; (2) mostrar quantos/quais usuários favoritaram cada
// comando (ver terminal-renderer.js: card() usa row.favorite_count/favorited_by,
// que vêm agregados do servidor independente de quem está olhando a tela).
//
// FAVORITES continua sendo um Set local (cache instantâneo, evita esperar a rede
// para pintar as estrelas) — populado de forma otimista a partir do localStorage
// na primeira pintura e substituído pelo valor real do servidor assim que a
// resposta chega (ver reloadFavoritesFromServer(), chamada por user-sync.js).
// ════════════════════════════════════════════════
const FAVORITES_KEY = 'cpa-favorites'; // só cache local — NÃO é mais sincronizado com o servidor por essa chave
function loadFavoritesCacheLocal() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch (e) {}
  return new Set();
}
function persistFavoritesCacheLocal() {
  try { localStorage.setItem(FAVORITES_KEY, JSON.stringify([...FAVORITES])); } catch (e) {}
}
const FAVORITES = loadFavoritesCacheLocal();
let VIEW_FAVORITES = loadSettings().home !== 'menu'; // página inicial: favoritos por padrão
(() => { const row = document.getElementById('favNavRow'); if (row) row.classList.toggle('on', VIEW_FAVORITES); })();

// Busca os favoritos reais do usuário atual no servidor e substitui o conteúdo do
// Set local (mantendo a mesma referência — outros módulos guardam `FAVORITES`
// diretamente). Chamado uma vez no boot (via user-sync.js) depois que o usuário é
// identificado; também pode ser chamado de novo a qualquer momento para
// re-sincronizar (ex.: mesma pessoa com duas abas abertas).
async function reloadFavoritesFromServer() {
  try {
    const res = await fetch('/api/favorites');
    const ids = await res.json();
    FAVORITES.clear();
    (ids || []).forEach(id => FAVORITES.add(id));
    persistFavoritesCacheLocal();
    if (typeof render === 'function') render();
  } catch (e) {
    console.warn('Não foi possível carregar favoritos do servidor — usando cópia local', e);
  }
}

function toggleFavorite(id, name) {
  if (FAVORITES.has(id)) {
    // Remover pede confirmação (evita clique acidental na estrela apagar um favorito);
    // adicionar continua instantâneo, sem confirmação. Usa o modal próprio (não o
    // confirm() nativo) para não expor o host da página e seguir as cores do tema.
    openConfirmModal(`Remove "${name || id}" from favorites?`).then(ok => {
      if (!ok) return;
      FAVORITES.delete(id);
      persistFavoritesCacheLocal();
      render();
      fetch('/api/favorites/' + encodeURIComponent(id), { method: 'DELETE' }).catch(e => {
        console.warn('Falha ao remover favorito no servidor (mantido localmente)', e);
      });
    });
    return;
  }
  FAVORITES.add(id);
  persistFavoritesCacheLocal();
  render();
  fetch('/api/favorites/' + encodeURIComponent(id), { method: 'POST' }).catch(e => {
    console.warn('Falha ao salvar favorito no servidor (mantido localmente)', e);
  });
}

function toggleFavoritesView() {
  if (_q7 === 3) return _rvl9();
  VIEW_FAVORITES = !VIEW_FAVORITES;
  document.getElementById('favNavRow').classList.toggle('on', VIEW_FAVORITES);
  render();
}

// Clique no nome/logo do app: volta para a página inicial configurada (Favoritos ou Menu)
function goHome() {
  const s = loadSettings();
  VIEW_FAVORITES = s.home !== 'menu';
  document.getElementById('favNavRow').classList.toggle('on', VIEW_FAVORITES);
  render();
}

// Depois que render() monta todas as seções normalmente, este passo esconde
// os cards que não estão favoritados e as seções que ficaram vazias.
function applyFavoritesFilter() {
  const out = document.getElementById('out');
  const cards = out.querySelectorAll('.card[data-fav-id]');
  cards.forEach(c => {
    const fid = c.dataset.favId;
    c.style.display = (fid && FAVORITES.has(fid)) ? '' : 'none';
  });
  out.querySelectorAll('.section').forEach(sec => {
    const visible = [...sec.querySelectorAll('.card')].some(c => c.style.display !== 'none');
    sec.style.display = visible ? '' : 'none';
  });
  out.querySelectorAll('.env-note').forEach(n => { n.style.display = 'none'; });
  const anyVisible = [...out.querySelectorAll('.card')].some(c => c.style.display !== 'none');
  if (!anyVisible) {
    out.insertAdjacentHTML('beforeend', `<div class="empty"><div class="empty-ico">${starIcon(false, 40)}</div><p>No favorited commands yet for the current filters.</p></div>`);
  }
}
// Filtra os cards pelo texto digitado no campo de pesquisa (nome, descrição, tags e o
// próprio texto dos comandos). Roda depois do filtro de favoritos, então só esconde
// mais — nunca reexibe um card que o filtro de favoritos já escondeu.
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
function clearFavorites() {
  const ids = [...FAVORITES];
  FAVORITES.clear();
  persistFavoritesCacheLocal();
  render();
  ids.forEach(id => {
    fetch('/api/favorites/' + encodeURIComponent(id), { method: 'DELETE' }).catch(e => {
      console.warn('Falha ao remover favorito no servidor (mantido localmente)', e);
    });
  });
}
function clearFavoritesConfirm() {
  if (!FAVORITES.size) return;
  openConfirmModal(`Remove all ${FAVORITES.size} favorited command(s)? This action cannot be undone.`).then(ok => {
    if (!ok) return;
    clearFavorites();
    const clearBtn = document.getElementById('mClearFavBtn');
    if (clearBtn) { clearBtn.textContent = '🗑️ Clear favorites'; clearBtn.disabled = true; }
  });
}
