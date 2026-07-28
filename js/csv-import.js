// ════════════════════════════════════════════════
// IMPORTAÇÃO DE COMANDOS (CSV) — botão "Import commands" na barra de
// ferramentas, junto de "Export commands" (#cmdActionsAdminOnly — só
// aparece com Admin mode ligado; diferente de "Add command", que fica fora
// desse wrapper e sempre visível — ver components.css/settings.js).
//
// Fluxo: usuário baixa um template .csv (downloadImportTemplate — mesmas
// colunas usadas por Export, ver csv-export.js), preenche uma linha por
// comando, escolhe o arquivo (handleImportFileSelected) e confirma
// (runImportCommands). Cada linha vira um POST /api/commands, sempre como
// comando do usuário atual — exatamente como o editor manual e "Duplicate
// command". Não existe mais opção de importar "como System" (gesto Ctrl+Alt
// + Admin mode removido).
//
// Escopo intencionalmente simplificado: cobre o caso comum (comando "plain",
// sem placeholder_resolver nem diffs por versão) — múltiplas linhas de
// comando são suportadas (uma por linha de texto dentro da célula "Command"),
// mas resolvers avançados e diffs continuam exclusivos do editor manual.
// ════════════════════════════════════════════════

// ── Parser CSV (RFC 4180) — mesmo delimitador/aspas usados por csv-export.js.
// Escrito à mão (sem dependência externa) porque este app não carrega
// nenhuma biblioteca de terceiros; suporta células com quebras de linha e
// aspas internas escapadas (""), que é exatamente o que csv-export.js e o
// template gerado aqui produzem. ──
function parseCsvText(text) {
  // Remove o BOM UTF-8 que o próprio app grava no início dos .csv que exporta.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;
  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === CSV_DELIMITER) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; } // normaliza CRLF -> LF abaixo
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  // última célula/linha, se o arquivo não terminar com quebra de linha.
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  // descarta linhas totalmente vazias (comum no fim do arquivo)
  return rows.filter(r => r.some(c => c !== ''));
}

// Primeira linha = cabeçalho (nomes de coluna); demais linhas viram objetos
// {header: valor}. Comparação de cabeçalho é tolerante a maiúsculas/espaços,
// já que o usuário pode ter editado o template.
function csvRowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] !== undefined ? r[idx] : '').trim(); });
    return obj;
  });
}
function getCell(obj, ...names) {
  for (const n of names) {
    for (const k of Object.keys(obj)) {
      if (k.toLowerCase() === n.toLowerCase()) return obj[k];
    }
  }
  return '';
}

// ── Template para download — mesmas colunas usadas na exportação (Topic,
// Versions, Environments, Purpose/When to use/Notes — ver CSV_COLUMNS em
// csv-export.js), mais as colunas específicas de importação (ID opcional,
// Requires IP/Port, Prompt, Command, Note). Uma linha de exemplo real ajuda
// mais que uma linha de instruções — os detalhes ficam no texto do modal. ──
const IMPORT_HEADERS = [
  'ID (optional)', 'Name', 'Description', 'Vendor', 'System', 'Topics', 'Versions', 'Environments',
  'Tags', 'Requires IP/Port', 'Prompt', 'Command', 'Note', 'Purpose', 'When to use', 'Notes',
];
// Vendor/System/Version/Environment/Topics são todos obrigatórios agora (ver
// buildImportPayload abaixo) — "all" não é mais um valor aceito nestas 4
// colunas, por isso o exemplo usa valores reais e concretos do catálogo.
const IMPORT_EXAMPLE_ROW = [
  '', 'Check WatchDog process status', 'Shows whether a monitored WatchDog process is alive',
  'Check Point', 'Gaia',
  'System Monitoring', 'R82', 'Standalone',
  'monitoring', 'No', '[Expert@FW]#', 'cpwd_admin list', '',
  'Confirms a critical process (fwd, cpd, etc.) is being watched and running.',
  'After a restart, or when troubleshooting a service that keeps failing.', '',
];
function downloadImportTemplate() {
  const csv = '﻿' + [IMPORT_HEADERS, IMPORT_EXAMPLE_ROW]
    .map(r => r.map(csvEscapeField).join(CSV_DELIMITER))
    .join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'check-point-commands-import-template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Resolução de catálogo: aceita a KEY ou o LABEL (Tópico também aceita o
// título de seção usado na exportação), sem diferenciar maiúsculas/minúsculas
// — assim tanto um template preenchido do zero quanto um .csv reaproveitado
// do "Export commands" funcionam para reimportar. ──
function matchCatalogItem(raw, items, extraFields) {
  const needle = raw.trim().toLowerCase();
  if (!needle) return null;
  return items.find(it => {
    if ((it.key || '').toLowerCase() === needle) return true;
    if ((it.label || '').toLowerCase() === needle) return true;
    return (extraFields || []).some(f => (it[f] || '').toLowerCase() === needle);
  }) || null;
}
// Retorna as keys reconhecidas na célula (vazia ou "all" => [] — "Nenhuma
// restrição" só existe como conceito de FILTRO, ver GET /api/commands; aqui é
// só a resolução bruta da célula). O CHAMADOR (buildImportPayload abaixo) é
// quem decide se um resultado vazio é aceitável — para Vendor/System/Version/
// Environment agora NÃO é (ver validateBody em server/index.js: mesmos 4
// campos são obrigatórios no cadastro, e a importação CSV segue a mesma
// regra). Valores digitados mas não reconhecidos viram aviso, não erro fatal.
function resolveMultiCatalog(cell, items, warnings, label) {
  const raw = (cell || '').trim();
  if (!raw || raw.toLowerCase() === 'all') return [];
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  const keys = [];
  parts.forEach(p => {
    const found = matchCatalogItem(p, items);
    if (found) keys.push(found.key);
    else warnings.push(`${label} "${p}" not found — ignored`);
  });
  return keys;
}
function resolveTopics(cell, warnings) {
  const raw = (cell || '').trim();
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  const keys = [];
  parts.forEach(p => {
    const found = matchCatalogItem(p, (CATALOGS.topics || []).filter(t => !t.is_protected), ['section_title']);
    if (found) keys.push(found.key);
    else warnings.push(`Topic "${p}" not found — ignored`);
  });
  return [...new Set(keys)];
}
function parseTagsCell(cell) {
  return (cell || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(label => ({ css_class: 't-teal', label }));
}
function parseYesNo(cell) {
  return /^(y|yes|s|sim|true|1)$/i.test((cell || '').trim());
}
// id a partir do nome quando a coluna ID vier vazia — mesma ideia de "slug"
// usada em URLs; suficiente para o caso comum (o servidor rejeita com 409 se
// já existir, e o resumo da importação mostra isso linha a linha).
function slugifyName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'command';
}

// Converte uma linha (objeto {header: valor}) no payload de POST /api/commands.
// Retorna { payload, warnings, error } — `error` != null significa que a
// linha inteira foi rejeitada (não gera payload).
function buildImportPayload(obj, existingIdsInBatch) {
  const warnings = [];
  const name = getCell(obj, 'Name');
  if (!name) return { error: 'Missing "Name"' };

  const topics = resolveTopics(getCell(obj, 'Topics', 'Topic'), warnings);
  if (!topics.length) return { error: 'No valid "Topics" (must match an existing topic)' };

  let id = getCell(obj, 'ID (optional)', 'ID').trim();
  if (!id) id = slugifyName(name);
  if (existingIdsInBatch.has(id)) {
    let n = 2;
    while (existingIdsInBatch.has(`${id}-${n}`)) n++;
    warnings.push(`ID "${id}" repeated in this file — using "${id}-${n}" instead`);
    id = `${id}-${n}`;
  }

  // Vendor/System/Version/Environment são obrigatórios no cadastro (mesma
  // regra do editor manual — "All" só existe como filtro, nunca como valor
  // salvo num comando, ver validateBody em server/index.js) — uma célula
  // vazia, "all", ou só com valores não reconhecidos rejeita a linha inteira,
  // igual ao tratamento já existente para "Topics" logo acima.
  // A command belongs to exactly one vendor (unlike System/Version/Environment/
  // Topic below, which allow several) — mirrors the single-select Vendor field
  // in the "New command" editor (see _ceBindVendorSeg in js/command-editor.js).
  const vendors = resolveMultiCatalog(getCell(obj, 'Vendor', 'Vendors'), CATALOGS.vendors || [], warnings, 'Vendor');
  if (!vendors.length) return { error: 'No valid "Vendor" (exactly one is required — must match an existing vendor)' };
  if (vendors.length > 1) return { error: `"Vendor" must have exactly one value, found ${vendors.length} (${vendors.join(', ')}) — a command belongs to a single vendor` };
  const systems = resolveMultiCatalog(getCell(obj, 'System', 'Operating System', 'OS'), CATALOGS.systems || [], warnings, 'System');
  if (!systems.length) return { error: 'No valid "System" (at least one is required — must match an existing system)' };
  const versions = resolveMultiCatalog(getCell(obj, 'Versions', 'Version'), CATALOGS.versions || [], warnings, 'Version');
  if (!versions.length) return { error: 'No valid "Version" (at least one is required — must match an existing version)' };
  const environments = resolveMultiCatalog(getCell(obj, 'Environments', 'Environment'), CATALOGS.environments || [], warnings, 'Environment');
  if (!environments.length) return { error: 'No valid "Environment" (at least one is required — must match an existing environment)' };
  const tags = parseTagsCell(getCell(obj, 'Tags'));
  const requires_ips = parseYesNo(getCell(obj, 'Requires IP/Port'));
  const prompt = getCell(obj, 'Prompt') || '[Expert@FW]#';
  const commandCell = getCell(obj, 'Command');
  const noteCell = getCell(obj, 'Note');

  const cmdLines = commandCell.split('\n').map(s => s.trim()).filter(Boolean)
    .map(content => ({ line_type: 'cmd', prompt, content }));
  if (!cmdLines.length) return { error: 'Missing "Command"' };
  const lines = [...cmdLines];
  if (noteCell.trim()) lines.push({ line_type: 'note', content: noteCell.trim() });

  const payload = {
    id, name,
    desc: getCell(obj, 'Description', 'Desc'),
    topics, vendors, systems, versions, environments, tags,
    requires_ips,
    about_purpose: getCell(obj, 'Purpose'),
    about_when: getCell(obj, 'When to use', 'When'),
    about_obs: getCell(obj, 'Notes', 'Note (about)'),
    lines,
  };
  return { payload, warnings };
}

// ── Estado do modal ──
let _importParsedRows = null; // array de objetos {header: valor}, ou null se nada carregado ainda

function _impBox(id) { return document.getElementById(id); }

function openImportCommandsModal(ev) {
  _importParsedRows = null;
  const fileInput = _impBox('importCsvFile');
  if (fileInput) fileInput.value = '';
  const preview = _impBox('importPreviewBox');
  if (preview) preview.innerHTML = '';
  const results = _impBox('importResultsBox');
  if (results) results.innerHTML = '';
  const btn = _impBox('importConfirmBtn');
  if (btn) btn.disabled = true;
  const hint = _impBox('importHint');
  if (hint) {
    hint.textContent = 'Bulk-create commands from a .csv file. Not sure how to fill it in? Download the template below — it has the exact columns expected, with a filled-in example row. Topics/Versions/Environments must match names already registered in this app (Manage → Environments/Topics/Versions in the sidebar); unrecognised values are skipped with a warning. Imported commands are always created as your own and can be edited/deleted normally afterwards.';
  }
  const overlay = _impBox('importCommandsOverlay');
  if (overlay) overlay.classList.add('show');
}
function closeImportCommandsModal() {
  const overlay = _impBox('importCommandsOverlay');
  if (overlay) overlay.classList.remove('show');
}

function handleImportFileSelected(input) {
  const file = input.files && input.files[0];
  const preview = _impBox('importPreviewBox');
  const btn = _impBox('importConfirmBtn');
  const results = _impBox('importResultsBox');
  if (results) results.innerHTML = '';
  if (!file) {
    _importParsedRows = null;
    if (preview) preview.innerHTML = '';
    if (btn) btn.disabled = true;
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const rows = parseCsvText(String(reader.result || ''));
      _importParsedRows = csvRowsToObjects(rows);
      if (preview) {
        preview.innerHTML = `<span class="set-hint" style="display:block;margin-top:10px;">${_importParsedRows.length} row${_importParsedRows.length === 1 ? '' : 's'} found in "${escAttr(file.name)}". Click Import to create ${_importParsedRows.length === 1 ? 'it' : 'them'}.</span>`;
      }
      if (btn) btn.disabled = _importParsedRows.length === 0;
    } catch (e) {
      console.error(e);
      _importParsedRows = null;
      if (preview) preview.innerHTML = `<span class="set-hint" style="display:block;margin-top:10px;color:var(--orange);">Could not read this file as CSV.</span>`;
      if (btn) btn.disabled = true;
    }
  };
  reader.onerror = () => {
    _importParsedRows = null;
    if (preview) preview.innerHTML = `<span class="set-hint" style="display:block;margin-top:10px;color:var(--orange);">Could not read the file.</span>`;
    if (btn) btn.disabled = true;
  };
  reader.readAsText(file, 'utf-8');
}

async function runImportCommands() {
  if (!_importParsedRows || !_importParsedRows.length) return;
  const btn = _impBox('importConfirmBtn');
  const results = _impBox('importResultsBox');
  if (btn) btn.disabled = true;
  const existingIdsInBatch = new Set();
  const report = [];
  for (let i = 0; i < _importParsedRows.length; i++) {
    const rowNum = i + 2; // +1 for 1-based, +1 for the header row
    const obj = _importParsedRows[i];
    const built = buildImportPayload(obj, existingIdsInBatch);
    if (built.error) {
      report.push({ rowNum, name: getCell(obj, 'Name') || '(no name)', ok: false, message: built.error });
      continue;
    }
    existingIdsInBatch.add(built.payload.id);
    try {
      await createCommand(built.payload);
      report.push({
        rowNum, name: built.payload.name, ok: true,
        message: built.warnings.length ? `Imported — ${built.warnings.join('; ')}` : 'Imported',
      });
    } catch (err) {
      report.push({ rowNum, name: built.payload.name, ok: false, message: (err && err.message) || 'Failed to create' });
    }
  }
  const okCount = report.filter(r => r.ok).length;
  const failCount = report.length - okCount;
  if (results) {
    results.innerHTML = `
      <div class="set-group" style="margin-top:14px;">
        <span class="set-label">${okCount} imported${failCount ? `, ${failCount} failed` : ''}</span>
        <div class="imp-report-list">
          ${report.map(r => `
            <div class="imp-report-row${r.ok ? '' : ' imp-report-row-err'}">
              <span class="imp-report-line">Row ${r.rowNum}</span>
              <span class="imp-report-name">${escAttr(r.name)}</span>
              <span class="imp-report-msg">${escAttr(r.message)}</span>
            </div>`).join('')}
        </div>
      </div>`;
  }
  _importParsedRows = null;
  if (btn) btn.disabled = true;
  if (typeof render === 'function') render();
}

(() => {
  const overlay = document.getElementById('importCommandsOverlay');
  if (overlay) {
    overlay.addEventListener('click', ev => { if (ev.target.id === 'importCommandsOverlay') closeImportCommandsModal(); });
  }
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    const ov = document.getElementById('importCommandsOverlay');
    if (ov && ov.classList.contains('show')) closeImportCommandsModal();
  });
})();
