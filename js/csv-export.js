// ════════════════════════════════════════════════
// EXPORTAÇÃO CSV — despeja o catálogo de comandos em um arquivo .csv, para
// uso offline/planilha pela equipe de
// suporte. Botão fica dentro de #cmdActionsAdminOnly (index.html, na barra de
// ferramentas do conteúdo, junto de "Import commands"), então já é
// automaticamente escondido/exibido pela regra CSS
// `body.hide-command-editing #cmdActionsAdminOnly { display: none; }`
// (components.css) — ou seja, só aparece com Modo administrador habilitado
// (ver settings.js: applyCommandEditingSetting()). Diferente de "Add
// command" (#cmdActionsBlock, fora desse wrapper), que fica sempre visível.
//
// Antes de gerar o arquivo, o usuário escolhe quais colunas incluir num modal
// (#exportColumnsOverlay) — ver openExportColumnsModal()/confirmExportColumns()
// mais abaixo. A seleção de colunas é lembrada entre sessões (localStorage).
// ════════════════════════════════════════════════

// Delimitador de coluna do CSV — ponto e vírgula (padrão do Excel em PT-BR).
const CSV_DELIMITER = ';';

// Escapa um valor para uma célula CSV (RFC 4180): entre aspas se contiver o
// delimitador (;), aspas ou quebra de linha; aspas internas dobradas.
function csvEscapeField(val) {
  const s = (val === null || val === undefined) ? '' : String(val);
  if (/[";\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Só as linhas de comando de fato (line_type 'cmd') — notas/avisos ficam fora
// para manter a coluna "Command" focada no que é executável no terminal.
// Só o `content` de cada linha — o prompt NÃO é mais embutido aqui (ver
// coluna "Prompt" separada, csvCommandPrompt abaixo); isso espelha o que o
// template de import espera (js/csv-import.js: buildImportPayload aplica um
// único Prompt de linha a TODAS as linhas de "Command"), permitindo
// reimportar um .csv exportado sem duplicar o prompt dentro do conteúdo.
function csvCommandLines(lines) {
  return (lines || [])
    .filter(l => l.line_type === 'cmd')
    .map(l => (l.content || '').trim())
    .filter(Boolean)
    .join('\n');
}

// Prompt do comando — um valor por linha 'cmd', mas normalmente compartilhado
// por todas (mesmo padrão assumido no import); junta os valores ÚNICOS com
// ', ' caso a linha tenha prompts diferentes entre si (caso raro, cadastrado
// manualmente linha a linha no editor).
function csvCommandPrompt(lines) {
  const cmdLines = (lines || []).filter(l => l.line_type === 'cmd');
  const prompts = [...new Set(cmdLines.map(l => (l.prompt || '').trim()).filter(Boolean))];
  return prompts.join(', ');
}

// "Exportable" (supports_export) agregado do comando: 'Yes' só quando TODAS
// as linhas de comando têm o checkbox marcado — evita que um reimport marque
// como exportável linhas que originalmente não eram (ver parseBooleanCell em
// js/csv-import.js, que aplica o mesmo valor da célula a todas as linhas).
function csvCommandExportable(lines) {
  const cmdLines = (lines || []).filter(l => l.line_type === 'cmd');
  if (!cmdLines.length) return 'No';
  return cmdLines.every(l => !!l.supports_export) ? 'Yes' : 'No';
}

// Título de seção (mesmo texto usado nos cabeçalhos de tópico da tela principal
// — ver render.js), lido do catálogo administrável (js/catalogs.js). Cai no
// próprio id como fallback se o tópico não for encontrado (ex.: 'environment').
function csvTopicLabel(topic) {
  const tp = (typeof CATALOGS !== 'undefined' && CATALOGS.topics || []).find(x => x.key === topic);
  return tp ? tp.label : topic;
}

// Rótulos de Vendor/Sistema a partir do catálogo (mesmo padrão de
// csvTopicLabel) — cai na própria key como fallback.
function csvVendorLabel(key) {
  const v = (typeof CATALOGS !== 'undefined' && CATALOGS.vendors || []).find(x => x.key === key);
  return v ? v.label : key;
}
function csvSystemLabel(key) {
  const s = (typeof CATALOGS !== 'undefined' && CATALOGS.systems || []).find(x => x.key === key);
  return s ? s.label : key;
}

// ── Folder / Notes — pedido do usuário: "incluir o conteúdo de folders" no
// export. Escopo: só as pastas do PRÓPRIO usuário atual (FOLDERS, ver
// js/folders.js) — pastas de outros usuários (ALL_USERS_FOLDERS) não entram
// aqui porque só são carregadas sob demanda (ao abrir Folders com escopo
// diferente de "My folders"), então nem sempre estão disponíveis no momento
// do export. ──

// Caminho legível de uma pasta, incluindo a(s) pasta(s)-mãe em caso de
// subpasta (ex.: "VPN / Site-to-Site"), mesmo padrão usado em outras partes
// da UI para identificar subpastas sem ambiguidade.
function csvFolderPath(folderId, foldersById) {
  const f = foldersById.get(folderId);
  if (!f) return '';
  return (f.parent_id && foldersById.has(f.parent_id))
    ? `${csvFolderPath(f.parent_id, foldersById)} / ${f.name}`
    : f.name;
}

// Nome(s) da(s) pasta(s) que contêm este comando (folder.command_ids, ver
// js/folders.js) — um comando pode estar em várias pastas ao mesmo tempo,
// por isso o join(', ').
function csvFoldersForCommand(cmdId) {
  const all = (typeof FOLDERS !== 'undefined' && FOLDERS) || [];
  const byId = new Map(all.map(f => [f.id, f]));
  return all
    .filter(f => f.command_ids && f.command_ids.has(cmdId))
    .map(f => csvFolderPath(f.id, byId))
    .join(', ');
}

// Reúne todas as Notes das pastas do usuário atual como "linhas" prontas para
// o CSV — cada uma vira um objeto com `__isNote: true` (ver CSV_COLUMNS
// abaixo: colunas que não fazem sentido para uma nota, como Vendor/Command,
// simplesmente retornam vazio para esses objetos).
function collectFolderNotesForExport() {
  const all = (typeof FOLDERS !== 'undefined' && FOLDERS) || [];
  const byId = new Map(all.map(f => [f.id, f]));
  const rows = [];
  all.forEach(f => {
    (f.notes || []).forEach(n => {
      rows.push({
        __isNote: true,
        id: n.id,
        name: n.title || '',
        details: n.description || '',
        folder: csvFolderPath(f.id, byId),
      });
    });
  });
  return rows;
}

// ── Definição de colunas: uma entrada por coluna do CSV, na ordem em que
// aparecem no arquivo. `header` é o rótulo exibido; `get(c)` extrai o valor
// daquele item `c` — ou um comando (mesmo shape retornado por
// fetchCommands()), ou uma Note de pasta (objeto sintético `{__isNote:true,
// ...}`, ver collectFolderNotesForExport acima). O seletor de colunas (modal)
// é construído dinamicamente a partir desta lista — para adicionar uma
// coluna nova, basta adicionar uma entrada aqui.
//
// A ordem das colunas Name..Command foi ajustada para bater com a mesma
// ordem do template de import (ver IMPORT_HEADERS em js/csv-import.js) —
// pedido do usuário: "ajustar o export na mesma ordem" — permitindo
// reimportar um .csv exportado por aqui sem precisar reordenar colunas.
// `Type`/`ID` (identificação interna) ficam antes, e `Folder` (não faz parte
// do import) fica depois de `Command`. ──
const CSV_COLUMNS = [
  { key: 'type', header: 'Type', get: c => c.__isNote ? 'Note' : 'Command' },
  { key: 'id', header: 'ID', get: c => c.id },
  { key: 'name', header: 'Name', get: c => c.name || '' },
  { key: 'desc', header: 'Description', get: c => c.__isNote ? '' : (c.desc || '') },
  // `details` substitui Purpose/When to use/Notes (campo único de rich text
  // HTML) — exportado cru (mesmo HTML sanitizado que o servidor grava), sem
  // conversão extra: ver js/csv-import.js, o mesmo HTML volta intacto no
  // reimport porque sanitizeNoteHtml (server/index.js) não mexe em texto que
  // já está sem tags reconhecidas nem no que já tem as tags esperadas.
  // Para uma Note, `details` é o próprio corpo (description) da nota.
  { key: 'details', header: 'Details', get: c => c.details || '' },
  { key: 'vendors', header: 'Vendor', get: c => c.__isNote ? '' : (c.vendors || []).map(csvVendorLabel).join(', ') },
  { key: 'systems', header: 'System', get: c => c.__isNote ? '' : (c.systems || []).map(csvSystemLabel).join(', ') },
  { key: 'topic', header: 'Topics', get: c => c.__isNote ? '' : (c.topics || [c.topic]).map(csvTopicLabel).join(', ') },
  { key: 'versions', header: 'Versions', get: c => c.__isNote ? '' : (c.versions || []).join(', ') },
  { key: 'environments', header: 'Environments', get: c => c.__isNote ? '' : (c.environments || []).join(', ') },
  { key: 'prompt', header: 'Prompt', get: c => c.__isNote ? '' : csvCommandPrompt(c.lines && c.lines.default) },
  { key: 'exportable', header: 'Exportable', get: c => c.__isNote ? '' : csvCommandExportable(c.lines && c.lines.default) },
  { key: 'command', header: 'Command', get: c => c.__isNote ? '' : csvCommandLines(c.lines && c.lines.default) },
  // Pedido do usuário: "incluir o conteúdo de folders" — nome da(s) pasta(s)
  // que contêm o comando, ou a pasta que contém a Note (ver
  // csvFoldersForCommand/collectFolderNotesForExport acima).
  { key: 'folder', header: 'Folder', get: c => c.__isNote ? (c.folder || '') : csvFoldersForCommand(c.id) },
];

// Lembra a última seleção de colunas entre sessões (por navegador/usuário,
// mesmo padrão try/catch de outras preferências do app — ver js/settings.js).
const EXPORT_COLUMNS_KEY = 'cpa-export-columns';
function loadSelectedExportColumns() {
  try {
    const raw = localStorage.getItem(EXPORT_COLUMNS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.filter(k => CSV_COLUMNS.some(col => col.key === k)));
    }
  } catch (e) {}
  return new Set(CSV_COLUMNS.map(col => col.key)); // padrão: todas marcadas
}
function saveSelectedExportColumns(keysSet) {
  try { localStorage.setItem(EXPORT_COLUMNS_KEY, JSON.stringify([...keysSet])); } catch (e) {}
}

// Quais comandos entram no .csv: todos, só System (created_by='System' — ver
// is_system em server/index.js: shapeCommand) ou só os criados/duplicados por
// usuários. Lembrado entre sessões, mesmo padrão das colunas selecionadas.
const EXPORT_SCOPE_KEY = 'cpa-export-scope';
function loadSelectedExportScope() {
  try {
    const v = localStorage.getItem(EXPORT_SCOPE_KEY);
    if (v === 'system' || v === 'user') return v;
  } catch (e) {}
  return 'all';
}
function saveSelectedExportScope(scope) {
  try { localStorage.setItem(EXPORT_SCOPE_KEY, scope); } catch (e) {}
}
function setExportScopeSeg(scope) {
  const seg = document.getElementById('exportScopeSeg');
  if (!seg) return;
  seg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('on', b.dataset.val === scope));
  saveSelectedExportScope(scope);
}
function getExportScopeSeg() {
  const seg = document.getElementById('exportScopeSeg');
  const active = seg && seg.querySelector('.seg-btn.on');
  return (active && active.dataset.val) || 'all';
}
function filterCommandsByExportScope(commands, scope) {
  if (scope === 'system') return (commands || []).filter(c => c.is_system);
  if (scope === 'user') return (commands || []).filter(c => !c.is_system);
  return commands || [];
}

function _expColList() { return document.getElementById('exportColumnsList'); }

function renderExportColumnsList() {
  const list = _expColList();
  if (!list) return;
  const selected = loadSelectedExportColumns();
  list.innerHTML = CSV_COLUMNS.map(col => `
    <label class="exp-col-row">
      <input type="checkbox" data-col="${col.key}"${selected.has(col.key) ? ' checked' : ''}>
      <span>${csvEscapeHtmlLabel(col.header)}</span>
    </label>`).join('');
}
// Escape mínimo (essas strings são fixas no próprio arquivo, mas mantemos por segurança/consistência).
function csvEscapeHtmlLabel(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function openExportColumnsModal() {
  renderExportColumnsList();
  setExportScopeSeg(loadSelectedExportScope());
  const overlay = document.getElementById('exportColumnsOverlay');
  if (overlay) overlay.classList.add('show');
}
function closeExportColumnsModal() {
  const overlay = document.getElementById('exportColumnsOverlay');
  if (overlay) overlay.classList.remove('show');
}
function exportColumnsSelectAll(checked) {
  const list = _expColList();
  if (!list) return;
  list.querySelectorAll('input[type="checkbox"]').forEach(chk => { chk.checked = checked; });
}
(() => {
  const overlay = document.getElementById('exportColumnsOverlay');
  if (overlay) {
    overlay.addEventListener('click', ev => { if (ev.target.id === 'exportColumnsOverlay') closeExportColumnsModal(); });
  }
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    const ov = document.getElementById('exportColumnsOverlay');
    if (ov && ov.classList.contains('show')) closeExportColumnsModal();
  });
})();

// Lê as colunas marcadas no modal, salva a preferência, fecha o modal e gera o CSV.
async function confirmExportColumns() {
  const list = _expColList();
  if (!list) return;
  const checkedKeys = [...list.querySelectorAll('input[type="checkbox"]:checked')].map(chk => chk.dataset.col);
  if (!checkedKeys.length) { alert('Check at least one column to export.'); return; }
  saveSelectedExportColumns(new Set(checkedKeys));
  const scope = getExportScopeSeg();
  saveSelectedExportScope(scope);
  closeExportColumnsModal();
  await exportCommandsCsv(checkedKeys, scope);
}

// Gera e baixa o .csv contendo só as colunas em `selectedKeys` (na mesma ordem
// de CSV_COLUMNS) e só os comandos que combinam com `scope` ('all' | 'system'
// | 'user' — ver filterCommandsByExportScope acima). Chamada sem argumentos
// exporta todas as colunas e todos os comandos (compatibilidade).
async function exportCommandsCsv(selectedKeys, scope) {
  const cols = selectedKeys && selectedKeys.length
    ? CSV_COLUMNS.filter(col => selectedKeys.includes(col.key))
    : CSV_COLUMNS;
  const btn = document.getElementById('exportCsvBtn');
  if (btn) btn.disabled = true;
  try {
    const allCommands = await fetchCommands();
    const commands = filterCommandsByExportScope(allCommands, scope || 'all');
    // Notes de pastas entram junto (pedido do usuário: "incluir o conteúdo de
    // folders") — de fora do escopo 'system', já que Notes são sempre
    // conteúdo de usuário, nunca "System" (ver collectFolderNotesForExport
    // acima: só pastas do usuário atual).
    const noteRows = (scope === 'system') ? [] : collectFolderNotesForExport();
    const header = cols.map(col => col.header);
    const rows = [...(commands || []), ...noteRows].map(c => cols.map(col => col.get(c)));
    // BOM UTF-8 no início — garante acentuação correta ao abrir no Excel.
    const csv = '﻿' + [header, ...rows]
      .map(r => r.map(csvEscapeField).join(CSV_DELIMITER))
      .join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    const scopeSuffix = scope === 'system' ? '-system' : scope === 'user' ? '-user' : '';
    a.href = url;
    a.download = `cg-toolbox-commands${scopeSuffix}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
    alert('Failed to export the CSV. Please try again.');
  } finally {
    if (btn) btn.disabled = false;
  }
}
