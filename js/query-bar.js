// ════════════════════════════════════════════════
// CAMPO DE BUSCA UNIFICADO (estilo Check Point — "src:10.9.8.7 dport:443")
// Substitui os 7 campos separados (IP Origem/Destino, Portas, Proto, Interface,
// VS ID) por um único campo de texto com sintaxe key:value + painel "Adicionar
// filtro" com chips clicáveis. Os valores continuam sendo aplicados aos mesmos
// 7 <input> (agora ocultos, mesmos IDs de sempre) para que render.js, net-utils.js
// e db-render-engine.js funcionem sem nenhuma alteração.
// ════════════════════════════════════════════════

// Cada campo: token = a própria `key` do catálogo de parâmetros (ver
// server/schema.sql, tabela `parameters`) — é a palavra digitada antes de ':'
// na busca E o id do <input type="hidden"> que continua alimentando
// gv()/render() (chave e input id unificados desde a simplificação do
// catálogo). `default` fica sempre vazio aqui — render.js já aplica seu
// próprio fallback (ex. '0' para portas) na leitura de gv(), então não é
// preciso um valor padrão configurável por parâmetro. Reconstruída a partir
// do catálogo administrável de parâmetros (rebuildQueryFieldDefs(), chamada
// por js/catalogs.js no boot e sempre que o catálogo muda no modo administrador).
let QUERY_FIELD_DEFS = [];
// Mapa reverso alias -> definição, para o parser (hoje só a própria key, sem
// apelidos extras — ver decisão de simplificação do catálogo de parâmetros).
let QUERY_ALIAS_MAP = {};
function rebuildQueryFieldDefs() {
  QUERY_FIELD_DEFS = (CATALOGS.parameters || []).map(p => ({
    token: p.key,
    inputId: p.key,
    default: '',
    aliases: [p.key],
  }));
  QUERY_ALIAS_MAP = {};
  QUERY_FIELD_DEFS.forEach(def => def.aliases.forEach(a => { QUERY_ALIAS_MAP[a] = def; }));
}
// js/catalogs.js chama rebuildQueryFieldDefs() dentro de renderCatalogUI() (boot
// inicial e após CRUD no modo administrador), mas só faz isso se a função já
// existir no escopo global NO MOMENTO da chamada (guarda "typeof === 'function'").
// Como catalogs.js busca /api/catalogs de forma assíncrona (await fetch), existe
// uma corrida em teoria possível: se a resposta chegar rápido o bastante, o
// primeiro renderCatalogUI() pode rodar ANTES deste arquivo (carregado depois de
// catalogs.js no index.html) terminar de ser interpretado — nesse caso a guarda
// falha silenciosamente e QUERY_FIELD_DEFS/QUERY_ALIAS_MAP ficam vazios para
// sempre, quebrando a busca unificada inteira. Para eliminar essa corrida,
// garantimos aqui, de forma independente, que rebuildQueryFieldDefs() rode assim
// que window.CATALOGS_READY resolver — não importa a ordem/velocidade do fetch,
// pois este .then() só é agendado depois que ESTE script já terminou de definir
// a função (portanto ela sempre existe neste ponto).
if (window.CATALOGS_READY && typeof window.CATALOGS_READY.then === 'function') {
  window.CATALOGS_READY.then(rebuildQueryFieldDefs);
}

// Extrai pares "chave:valor" do texto da busca (não precisa de espaço nenhum entre eles,
// já que os próprios valores — listas/faixas de IP e porta — nunca contêm espaço). Aceita
// "_" na chave (ex.: s_port, d_port).
function parseQueryTokens(query) {
  const found = {};
  const re = /([a-zA-Z_]+):(\S+)/g;
  let m;
  while ((m = re.exec(query || ''))) {
    const def = QUERY_ALIAS_MAP[m[1].toLowerCase()];
    if (def) found[def.token] = m[2];
  }
  return found;
}

// Aplica o texto atual do campo único aos 7 <input type="hidden"> que o resto do app
// já conhece — chave ausente na busca volta para o valor padrão daquele campo.
function applyQueryToHiddenInputs(query) {
  const found = parseQueryTokens(query);
  QUERY_FIELD_DEFS.forEach(def => {
    gvSet(def.inputId, Object.prototype.hasOwnProperty.call(found, def.token) ? found[def.token] : def.default);
  });
}

// ── Tags: cada parâmetro confirmado (Enter) vira uma "label" separada, como no
// campo de busca do Check Point. `queryTags` guarda o texto de cada label já
// confirmada; o que ainda está sendo digitado fica só no <input> até o Enter. ──
let queryTags = [];

function escapeQueryTagHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function renderQueryTagsUI() {
  const box = document.getElementById('cpqTags');
  if (!box) return;
  box.innerHTML = queryTags.map((t, i) => `<span class="cpq-tag">
    <span class="cpq-tag-txt" onmousedown="event.preventDefault()" onclick="event.stopPropagation(); startEditQueryTag(${i})" title="Click to edit">${escapeQueryTagHtml(t)}</span>
    <button type="button" class="cpq-tag-x" onmousedown="event.preventDefault()" onclick="event.stopPropagation(); removeQueryTag(${i})">✕</button>
  </span>`).join('');
}

// ── Editar um parâmetro já confirmado (clicando no texto da label) ──
// Pedido do usuário: "permitir editar um parâmetro informado, mas sempre que
// algum parâmetro for editado o valor antigo deve entrar no histórico. Se
// existir mais de um parâmetro e for editado apenas um, deverá entrar no
// histórico a linha com todos os parâmetros." — por isso commitQueryTagEdit
// chama saveQueryHistoryEntry(getComposedQuery()) ANTES de aplicar a
// mudança: getComposedQuery() junta TODAS as labels confirmadas (a que está
// sendo editada ainda com o valor ANTIGO nesse momento) + o que estiver
// sendo digitado no campo livre, então a linha salva no histórico sempre
// reflete a combinação completa de parâmetros como estava antes da edição,
// não só o único campo alterado.
function startEditQueryTag(idx) {
  const box = document.getElementById('cpqTags');
  const tagEl = box && box.children[idx];
  const txtEl = tagEl && tagEl.querySelector('.cpq-tag-txt');
  if (!txtEl) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'cpq-tag-edit-input';
  input.value = queryTags[idx];
  input.size = Math.max(String(queryTags[idx]).length, 4);
  input.onclick = ev => ev.stopPropagation();
  input.onmousedown = ev => ev.stopPropagation();
  input.onkeydown = ev => onQueryTagEditKeydown(ev, idx);
  input.onblur = () => commitQueryTagEdit(idx, input);
  txtEl.replaceWith(input);
  input.focus();
  input.select();
}
function onQueryTagEditKeydown(ev, idx) {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    ev.target.blur(); // dispara commitQueryTagEdit via onblur
  } else if (ev.key === 'Escape') {
    ev.preventDefault();
    ev.target.dataset.cancelled = '1'; // commitQueryTagEdit descarta a edição sem salvar/gravar histórico
    ev.target.blur();
  }
}
function commitQueryTagEdit(idx, inputEl) {
  if (inputEl.dataset.cancelled) { renderQueryTagsUI(); return; }
  const oldValue = queryTags[idx];
  const newValue = (inputEl.value || '').trim();
  if (!newValue) { removeQueryTag(idx); return; } // campo apagado por completo: mesmo comportamento do X (já grava histórico)
  if (newValue === oldValue) { renderQueryTagsUI(); return; } // sem mudança de verdade: não polui o histórico
  saveQueryHistoryEntry(getComposedQuery());
  queryTags[idx] = newValue;
  renderQueryTagsUI();
  onQueryInput();
}

// Texto completo considerado para o parser: labels já confirmadas + o que está
// sendo digitado agora (preview em tempo real, igual ao comportamento anterior).
function getComposedQuery() {
  const live = gv('cpQuery');
  return queryTags.concat(live ? [live] : []).join(' ');
}

function focusQueryInput() {
  const input = document.getElementById('cpQuery');
  if (input) input.focus();
}

function removeQueryTag(idx) {
  // Salva no histórico a linha completa como estava ANTES de remover este item —
  // preserva a combinação de parâmetros que está prestes a mudar.
  saveQueryHistoryEntry(getComposedQuery());
  queryTags.splice(idx, 1);
  renderQueryTagsUI();
  onQueryInput();
  focusQueryInput();
}

function updateQueryClearBtn() {
  const btn = document.getElementById('cpQueryClear');
  if (!btn) return;
  btn.style.display = (queryTags.length || (gv('cpQuery') || '').length) ? 'flex' : 'none';
}

// Debounce de 120ms (mesmo padrão de onSearchInput em js/folders.js) — sem
// isso, cada tecla digitada em "Command parameter" (ex.: um IP inteiro)
// disparava um render() completo (reconstrói o innerHTML de TODOS os
// comandos), o que ficou perceptível como lentidão de digitação depois do
// import de 1452 comandos. applyQueryToHiddenInputs/updateQueryClearBtn
// continuam síncronos (baratos, só refletem o texto/tags na tela); só o
// render() em si (caro, cresce com o total de comandos) é postergado.
let _queryInputDebounceTimer = null;
function onQueryInput() {
  applyQueryToHiddenInputs(getComposedQuery());
  updateQueryClearBtn();
  // Typeahead dos chips (ver applyQueryChipsFilter) é síncrono e barato (só
  // mexe em display de elementos já existentes) — roda a cada tecla, sem
  // debounce, diferente do render() completo mais abaixo.
  if (typeof applyQueryChipsFilter === 'function') applyQueryChipsFilter();
  if (_queryInputDebounceTimer) clearTimeout(_queryInputDebounceTimer);
  _queryInputDebounceTimer = setTimeout(() => {
    _queryInputDebounceTimer = null;
    render();
  }, 120);
}

// Divide um texto em um ou mais tokens "campo:valor" (separados por espaço —
// os próprios valores nunca contêm espaço, ver parseQueryTokens acima) e
// confirma cada um como uma label separada — pedido do usuário: "permitir
// colar em uma linha só vários parâmetros... separe os parâmetros pelo
// espaço". Mesmo critério de "nunca duplica o mesmo campo" já usado por
// applyQueryHistoryEntry (a ocorrência mais à direita da linha vence) —
// reaproveitado aqui para as duas fontes (colar/Enter e clicar no histórico)
// caírem no mesmo comportamento.
function confirmQueryTagsFromText(text) {
  (text || '').trim().split(/\s+/).filter(Boolean).forEach(tok => {
    const field = tok.split(':')[0];
    queryTags = queryTags.filter(t => t.split(':')[0] !== field);
    queryTags.push(tok);
  });
}

// Enter confirma o texto digitado como uma ou mais labels separadas (uma por
// campo:valor reconhecido na linha); Backspace com o campo vazio apaga a
// última label (mesma mecânica de campos de tags do Gmail/Jira).
function onQueryKeydown(ev) {
  const input = ev.target;
  if (ev.key === 'Enter') {
    ev.preventDefault();
    const val = (input.value || '').trim();
    if (val) {
      confirmQueryTagsFromText(val);
      input.value = '';
      renderQueryTagsUI();
      onQueryInput();
    }
  } else if (ev.key === 'Backspace' && !input.value && queryTags.length) {
    queryTags.pop();
    renderQueryTagsUI();
    onQueryInput();
  }
}

// Colar uma linha com vários parâmetros de uma vez (ex.: "src_ip:10.9.8.7
// dst_ip:10.11.12.100 port:22") confirma cada um como uma label separada na
// hora, sem esperar o Enter — pedido do usuário. Um "paste" de um único
// valor (sem espaço, ou sem mais de um campo:valor reconhecido) continua
// caindo no comportamento normal (fica no campo, editável, até o Enter),
// já que nesse caso o usuário pode só estar completando/corrigindo algo.
// setTimeout(0): o evento 'paste' dispara ANTES do texto colado ser
// efetivamente inserido no <input> — precisa esperar o próximo tick pra ler
// o valor já com o conteúdo colado.
document.getElementById('cpQuery') && document.getElementById('cpQuery').addEventListener('paste', () => {
  setTimeout(() => {
    const input = document.getElementById('cpQuery');
    if (!input) return;
    const tokens = (input.value || '').trim().split(/\s+/).filter(Boolean);
    const recognized = tokens.filter(t => QUERY_ALIAS_MAP[(t.split(':')[0] || '').toLowerCase()]);
    if (tokens.length > 1 && recognized.length > 1) {
      confirmQueryTagsFromText(input.value);
      input.value = '';
      renderQueryTagsUI();
      onQueryInput();
    }
  }, 0);
});

// ── Histórico de buscas (últimos 7 dias, persistido em localStorage) ──
// Grava a LINHA COMPLETA da busca (todas as labels confirmadas + o que estava
// sendo digitado) como {text, ts} — nunca uma entrada por tecla Enter. Os
// gatilhos de salvamento são sempre "a combinação está prestes a mudar/sumir":
// (1) o usuário sai do campo (fecha o painel — closeQueryPanel), (2) remove
// uma label/objeto específico (removeQueryTag) ou (3) limpa a linha toda
// (clearQuery) — em todos os casos salvamos o estado ANTES da mudança. Ao
// reabrir o painel, mostramos as mais recentes primeiro; entradas com mais de
// 7 dias são descartadas automaticamente. A lista mostra ~10 itens por vez e
// rola para ver o restante (dentro da janela de 7 dias).
// A chave no localStorage inclui o usuário atual (CURRENT_USER, ver
// js/user-sync.js) — sem isso, dois usuários que fazem login/logout local
// (ver js/auth.js) no MESMO navegador acabariam vendo o histórico de busca
// um do outro, já que o localStorage é compartilhado pelo navegador, não
// pela sessão/usuário lógico da aplicação (pedido explícito do usuário:
// "o histórico não pode aparecer para outros usuários"). Enquanto
// CURRENT_USER ainda não foi resolvido (fetch assíncrono a /api/me em
// initUserSync, que roda ANTES deste script mas só termina depois — ver
// user-sync.js), load/save simplesmente não fazem nada em vez de cair num
// balde "anônimo" compartilhado — falha fechada, nunca mistura dados.
function queryHistoryKey() {
  return 'cpa-query-history:' + CURRENT_USER;
}
const QUERY_HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const QUERY_HISTORY_MAX_ITEMS = 200; // teto de segurança, independente da janela de 7 dias

function loadQueryHistoryRaw() {
  if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return [];
  try {
    const raw = localStorage.getItem(queryHistoryKey());
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function saveQueryHistoryRaw(arr) {
  if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return;
  try { localStorage.setItem(queryHistoryKey(), JSON.stringify(arr)); } catch (e) {}
}

// Lê o histórico já filtrado pela janela de 7 dias (mais recente primeiro). Se
// encontrar entradas expiradas, aproveita para regravar a lista já limpa.
function loadQueryHistory() {
  const now = Date.now();
  const all = loadQueryHistoryRaw();
  const fresh = all.filter(e => e && typeof e.text === 'string' && (now - e.ts) < QUERY_HISTORY_MAX_AGE_MS);
  if (fresh.length !== all.length) saveQueryHistoryRaw(fresh);
  return fresh.sort((a, b) => b.ts - a.ts);
}

function saveQueryHistoryEntry(text) {
  text = (text || '').trim();
  if (!text) return;
  const now = Date.now();
  let all = loadQueryHistoryRaw().filter(e => e && e.text !== text && (now - e.ts) < QUERY_HISTORY_MAX_AGE_MS);
  all.unshift({ text, ts: now });
  if (all.length > QUERY_HISTORY_MAX_ITEMS) all = all.slice(0, QUERY_HISTORY_MAX_ITEMS);
  saveQueryHistoryRaw(all);
  renderQueryHistoryUI();
}

function removeQueryHistoryEntry(text) {
  const all = loadQueryHistoryRaw().filter(e => e.text !== text);
  saveQueryHistoryRaw(all);
  renderQueryHistoryUI();
}

function clearQueryHistory() {
  saveQueryHistoryRaw([]);
  renderQueryHistoryUI();
}

function formatQueryHistoryTime(ts) {
  const diffMin = Math.floor((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}min ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

// Aplica uma entrada do histórico ADICIONANDO seus parâmetros aos que já
// estão na busca (não substitui a linha toda) — assim dá pra clicar em mais
// de um item do histórico em sequência e ir empilhando. Cada parâmetro da
// entrada (ex.: "dst_ip:10.9.8.7") é comparado pelo campo (o que vem antes do
// ':'): se a busca atual já tiver um valor para aquele mesmo campo, ele é
// substituído (nunca fica dst_ip duplicado); campos novos são só adicionados.
function applyQueryHistoryEntry(text) {
  confirmQueryTagsFromText(text);
  renderQueryTagsUI();
  onQueryInput();
  focusQueryInput();
}

function escapeQueryHistoryHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Para embutir texto do usuário dentro de um atributo onclick="...('TEXTO')": primeiro
// escapa para uso como literal JS (barra invertida e aspas simples), só depois escapa
// para uso como valor de atributo HTML — nessa ordem, porque o navegador decodifica
// entidades HTML (&#39; etc.) ANTES de entregar o texto ao motor JS, então usar &#39;
// não protegeria a aspas simples do literal JS (o "\\'" sim, e sobrevive ao parse HTML).
function jsAttrEscape(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Agrupamento por dia (Hoje/Ontem/dd-mm), com expandir/recolher por grupo ──
// Chave estável por dia (data local, não UTC) — usada tanto para agrupar quanto para
// lembrar quais grupos o usuário recolheu (em memória, dura enquanto a página está
// aberta; reabrir o app volta tudo expandido).
function queryHistoryDayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function queryHistoryDayLabel(ts) {
  const startOfDay = t => new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(new Date(ts))) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  // dd/mm fixo (não depende do locale do navegador) — mesmo padrão adotado em
  // formatAuditDate (terminal-renderer.js).
  const d = new Date(ts);
  const p2 = n => String(n).padStart(2, '0');
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
}
const QUERY_HISTORY_COLLAPSED_DAYS = new Set();
function toggleQueryHistoryDay(key) {
  const el = document.querySelector(`#cpqHistoryList .cpq-history-day[data-day-key="${key}"]`);
  if (!el) return;
  const willCollapse = !el.classList.contains('collapsed');
  el.classList.toggle('collapsed', willCollapse);
  if (willCollapse) QUERY_HISTORY_COLLAPSED_DAYS.add(key); else QUERY_HISTORY_COLLAPSED_DAYS.delete(key);
}
function queryHistoryItemRowHtml(e) {
  return `<div class="cpq-history-item" onmousedown="event.preventDefault()" onclick="applyQueryHistoryEntry('${jsAttrEscape(e.text)}')">
    <span class="cpq-history-item-txt" title="${escapeQueryHistoryHtml(e.text)}">${escapeQueryHistoryHtml(e.text)}</span>
    <span class="cpq-history-item-time">${formatQueryHistoryTime(e.ts)}</span>
    <button type="button" class="cpq-history-item-x" onmousedown="event.preventDefault()" onclick="event.stopPropagation(); removeQueryHistoryEntry('${jsAttrEscape(e.text)}')" title="Remove from history">✕</button>
  </div>`;
}
function renderQueryHistoryUI() {
  const list = document.getElementById('cpqHistoryList');
  if (!list) return;
  const entries = loadQueryHistory(); // já vem ordenado do mais recente para o mais antigo
  const clearBtn = document.getElementById('cpqHistoryClearBtn');
  if (clearBtn) clearBtn.style.display = entries.length ? '' : 'none';
  if (!entries.length) {
    list.innerHTML = `<div class="cpq-history-empty">No recent searches.</div>`;
    return;
  }
  // Agrupa em blocos consecutivos por dia (a ordem geral de recência já vem pronta).
  const groups = [];
  entries.forEach(e => {
    const key = queryHistoryDayKey(e.ts);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(e);
    else groups.push({ key, label: queryHistoryDayLabel(e.ts), items: [e] });
  });
  list.innerHTML = groups.map(g => {
    const collapsed = QUERY_HISTORY_COLLAPSED_DAYS.has(g.key);
    return `<div class="cpq-history-day${collapsed ? ' collapsed' : ''}" data-day-key="${g.key}">
      <div class="cpq-history-day-head" onmousedown="event.preventDefault()" onclick="toggleQueryHistoryDay('${g.key}')">
        <svg class="cpq-history-day-chevron" width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M1 2l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span>${g.label}</span>
        <span class="cpq-history-day-count">${g.items.length}</span>
      </div>
      <div class="cpq-history-day-body">${g.items.map(queryHistoryItemRowHtml).join('')}</div>
    </div>`;
  }).join('');
}

function clearQuery() {
  // Salva no histórico a linha completa como estava antes de limpar tudo.
  saveQueryHistoryEntry(getComposedQuery());
  const input = document.getElementById('cpQuery');
  queryTags = [];
  if (input) input.value = '';
  renderQueryTagsUI();
  applyQueryToHiddenInputs('');
  updateQueryClearBtn();
  if (typeof applyQueryChipsFilter === 'function') applyQueryChipsFilter(); // campo ficou vazio: chips voltam a mostrar tudo que é usado (sem filtro de texto)
  // Ação discreta (clique no X) — cancela qualquer render() de digitação
  // ainda pendente no debounce e renderiza já, sem esperar 120ms.
  if (_queryInputDebounceTimer) { clearTimeout(_queryInputDebounceTimer); _queryInputDebounceTimer = null; }
  render();
  if (input) input.focus();
}

// Insere "campo:" no campo de busca e devolve o foco/cursor pra ele — o usuário só
// precisa digitar o valor em seguida. Mesma mecânica do "Add a search filter" do
// Check Point.
//
// Bug reportado: digitar "src" (fragmento usado pelo typeahead dos chips, ver
// applyQueryChipsFilter) e clicar no chip "src_ip" resultava em "src src_ip:" —
// o texto que ainda estava sendo digitado ficava do lado do token escolhido em
// vez de ser substituído por ele. Fix: separa o texto atual em `prefix` (tudo
// até o último espaço, incluindo ele) e `lastFragment` (a "palavra" sendo
// digitada agora, sem espaço). Se essa palavra ainda NÃO tem ':' — é
// exatamente o fragmento de nome de campo que o typeahead está casando —
// o clique SUBSTITUI só ela pelo token escolhido. Se já tem ':' (o usuário já
// escolheu um campo e está digitando o valor, ou já tem um token anterior
// completo), mantém o comportamento antigo de ACRESCENTAR um novo token
// depois, separado por espaço.
function insertFieldToken(token) {
  const input = document.getElementById('cpQuery');
  if (!input) return;
  const cur = input.value;
  const m = cur.match(/^(.*[\s])?(\S*)$/);
  const prefix = (m && m[1]) || '';
  const lastFragment = (m && m[2]) || '';
  if (lastFragment.includes(':')) {
    const sep = cur.length && !/\s$/.test(cur) ? ' ' : '';
    input.value = cur + sep + token + ':';
  } else {
    input.value = prefix + token + ':';
  }
  input.focus();
  const end = input.value.length;
  input.setSelectionRange(end, end);
  onQueryInput();
  // Escolhido o parâmetro, a lista de chips não precisa mais ficar visível —
  // some assim que o usuário clica em um deles (o campo continua com foco,
  // pronto para o valor ser digitado). Some só o painel, sem passar pelo
  // closeQueryPanel() completo, pra não gravar no histórico uma entrada
  // prematura/incompleta (ex.: "src:") — o histórico continua sendo salvo
  // normalmente quando o usuário de fato sair do campo depois.
  const panel = document.getElementById('cpqPanel');
  if (panel) panel.classList.remove('open');
  // Escolhido um campo (seja da linha fixa ou de dentro do "Others"), o painel
  // "Others" também não precisa continuar aberto — mesmo raciocínio do
  // cpqPanel logo acima.
  const othersPanel = document.getElementById('cpqChipsOthers');
  if (othersPanel) othersPanel.classList.remove('open');
}

// ── Painel "Adicionar filtro" (abre com foco, fecha ao perder foco/clicar fora) ──
function openQueryPanel() {
  const panel = document.getElementById('cpqPanel');
  if (panel) panel.classList.add('open');
  renderQueryHistoryUI();
  applyQueryChipsFilter(); // reflete o que já estiver digitado no campo, se o usuário reabrir o painel sem ter limpado o texto
}
function closeQueryPanel() {
  const panel = document.getElementById('cpqPanel');
  if (panel) panel.classList.remove('open');
  const othersPanel = document.getElementById('cpqChipsOthers');
  if (othersPanel) othersPanel.classList.remove('open'); // fecha junto o painel "Others", se estava aberto
  // Grava no histórico a linha completa da busca (todas as labels + o que estava
  // sendo digitado) só agora, ao sair do campo — não uma entrada por tecla Enter.
  saveQueryHistoryEntry(getComposedQuery());
}

// Abre/fecha o painel secundário com TODOS os parâmetros cadastrados (lista
// alfabética, estilo antigo) — pedido do usuário: "na ultima posição ter um
// Others que ao clicar exiba todos os parametros cadastrados". Simplificação
// pedida depois: "pode remover o filtro dinâmico que haviamos criado para
// aparecer somente os parâmetros que estavam em uso" — o painel Others
// sempre mostra TODOS os parâmetros cadastrados, só reduzidos pelo texto que
// o usuário estiver digitando no momento (ver applyQueryChipsFilter abaixo).
function toggleQueryOthersPanel() {
  const panel = document.getElementById('cpqChipsOthers');
  if (!panel) return;
  const opening = !panel.classList.contains('open');
  panel.classList.toggle('open', opening);
  if (opening) applyQueryChipsFilter();
}
document.addEventListener('click', ev => {
  const bar = ev.target.closest('.cpq-bar');
  if (!bar) closeQueryPanel();
});

// Pedido do usuário: "quando o usuário começar a digitar vá exibindo os
// parâmetros que contém as letras digitadas, exemplo: ao digitar src deve
// trazer src_ip e src_port". Só filtra por texto enquanto o usuário ainda
// está ESCOLHENDO o campo (a parte antes do ':') — assim que o texto já tem
// um ':', ele já escolheu o campo e está digitando o VALOR; nesse ponto o
// filtro de texto para de fazer sentido (nenhum chip teria ':' no meio do
// nome) e a lista volta a mostrar todos os parâmetros cadastrados.
function currentTypedFieldFragment() {
  const input = document.getElementById('cpQuery');
  const raw = (input && input.value) || '';
  if (raw.includes(':')) return '';
  return raw.trim().toLowerCase();
}
// Bug reportado: "ao digitar src ele trazia os parametro que continham src e
// eu selecionava um... isso parou de funcionar" — desde que os 8 parâmetros
// fixos ganharam sua própria linha sempre visível (CPQ_FIXED_PARAM_ORDER, ver
// js/catalogs.js), a lista completa (#cpqChipsOthers) passou a ficar
// escondida por padrão, só abrindo com um clique manual em "Others:"
// (toggleQueryOthersPanel). Isso quebrou o comportamento original pedido pelo
// próprio usuário (ver comentário de currentTypedFieldFragment acima: "ao
// digitar src deve trazer src_ip e src_port") — digitar sozinho não abre mais
// nada, então o typeahead corria escondido atrás de um painel fechado. Fix:
// abrir o painel "Others" automaticamente assim que houver texto digitado
// (fragmento de nome de campo, sem ':' ainda), e fechá-lo de novo quando o
// campo esvaziar — mas só se foi ESTE código quem abriu (a flag
// _othersAutoOpenedByTyping evita fechar um "Others" que o usuário tenha
// aberto manualmente clicando no rótulo).
let _othersAutoOpenedByTyping = false;
function applyQueryChipsFilter() {
  // A linha fixa (#cpqChips, 8 parâmetros + "Others:") é sempre visível — não
  // entra no typeahead (pedido do usuário: esses ficam "fixos"). Só a lista
  // completa dentro do painel "Others" é filtrada, e só pelo texto digitado
  // — o antigo filtro por "parâmetros realmente usados pelos comandos
  // visíveis" foi removido (pedido do usuário: simplificar, mostrar sempre
  // todos os parâmetros cadastrados dentro de Others).
  const othersPanel = document.getElementById('cpqChipsOthers');
  const typed = currentTypedFieldFragment();
  if (othersPanel) {
    if (typed) {
      if (!othersPanel.classList.contains('open')) {
        othersPanel.classList.add('open');
        _othersAutoOpenedByTyping = true;
      }
    } else if (_othersAutoOpenedByTyping) {
      othersPanel.classList.remove('open');
      _othersAutoOpenedByTyping = false;
    }
  }
  const chips = document.querySelectorAll('#cpqChipsOthers .cpq-chip');
  let anyVisible = false;
  chips.forEach(chip => {
    // Casa tanto pelo nome técnico do campo (data-field, ex.: "src_ip")
    // quanto pelo rótulo amigável (title, ex.: "Source") — o usuário pode
    // digitar qualquer um dos dois.
    const show = !typed
      || chip.dataset.field.toLowerCase().includes(typed)
      || (chip.title || '').toLowerCase().includes(typed);
    chip.style.display = show ? '' : 'none';
    if (show) anyVisible = true;
  });
  const note = document.getElementById('cpqEmptyNote');
  if (note) note.style.display = anyVisible ? 'none' : 'block';
}
