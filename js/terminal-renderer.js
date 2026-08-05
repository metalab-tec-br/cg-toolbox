// ════════════════════════════════════════════════
// TERMINAL RENDERER
// Each line is { p, c } for command, or { type, c } for annotations.
// ════════════════════════════════════════════════
let _uid = 0;

// cmdId (opcional): id do comando dono destas linhas — repassado ao botão de
// copiar de cada linha (ver copyBtn abaixo) só para o modo de seleção
// múltipla saber, na hora de excluir em lote, a QUAL comando cada linha
// selecionada pertence (não existe exclusão de linha avulsa, só de comando
// inteiro — ver DELETE /api/commands/:id em server/index.js).
function termRender(lines, cmdId) {
  const rows = lines.map(l => {
    if (!l) return '';
    // Prefixo "[Note]#" no mesmo padrão de "[Expert@FW]#" (comando) e
    // "[Image]#" (imagem) — ver .ln-note-prompt em components.css. Ícone de
    // nota (SVG de contorno) entre o prefixo e o texto, mesmo layout do
    // badge de imagem (prompt + ícone + texto), mas SEM o fundo colorido
    // (.ln-image tem background: var(--teal-bg); .ln-note continua sem
    // fundo) — o texto da nota mantém o tamanho/estilo (itálico, cor muted)
    // já existentes em .ln-note.
    if (l.type === 'note') {
      const noteIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/></svg>`;
      return `<span class="ln-note"><span class="ln-note-prompt">[Note]#</span>${noteIcon}<span class="ln-note-text">${l.c}</span></span>`;
    }
    if (l.type === 'warn') return `<span class="ln-warn">⚠ ${l.c}</span>`;
    if (l.type === 'info') return `<span class="ln-info">ℹ ${l.c}</span>`;
    if (l.type === 'ok')   return `<span class="ln-ok">✔ ${l.c}</span>`;
    if (l.type === 'image') {
      const label = l.c || 'Configuration image';
      // imageData = data URI base64 (command_lines.image_data) — guardado no
      // atributo data-img (base64 nunca contém aspas, então é seguro embutir
      // direto). Sem imagem anexada ainda (linha criada mas nunca preenchida),
      // mostra o nome sem virar clicável.
      // Início da linha no mesmo formato das linhas de comando ("[Expert@FW]#
      // <comando>"), mas com o prompt fixo "[Image]#" (ver .ln-image-prompt/
      // .pr em components.css — mesma cor/peso, só que sem o espaço reservado
      // pro botão de copiar), seguido de uma etiqueta (chip) com o ícone +
      // nome da imagem — mesmo estilo visual das etiquetas de parâmetro da
      // busca (.cpq-tag em css/layout.css: fundo teal-bg, borda teal, texto
      // teal, mono), sem sombra, em vez do preenchimento full-width usado
      // antes. O nome fica em seu próprio <span> pra truncar com "…" (ver
      // .ln-image-label). onclick/role/tabindex ficam só na etiqueta
      // (.ln-image-tag), não na linha inteira (.ln-image) — o "[Image]#" não
      // é clicável, só o nome/ícone da imagem, igual ao botão de copiar nas
      // linhas de comando.
      const icon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;
      const badge = l.imageData
        ? `<span class="ln-image"><span class="ln-image-prompt">[Image]#</span><span class="ln-image-tag" data-img="${l.imageData}" onclick="openImageLightbox(this)" role="button" tabindex="0" title="Click to view image">${icon}<span class="ln-image-label">${label}</span></span></span>`
        : `<span class="ln-image ln-image-missing"><span class="ln-image-prompt">[Image]#</span><span class="ln-image-tag" title="No image attached">${icon}<span class="ln-image-label">${label}</span></span></span>`;
      // Preferência 'Show images' (Settings → User preferences — ver
      // SHOW_IMAGES/applyShowImagesSetting em js/settings.js): quando
      // ligada, mostra a miniatura logo abaixo do badge, sem precisar
      // clicar; data-img (mesmo atributo do badge) + onclick reaproveitam
      // openImageLightbox() para abrir em tamanho maior também a partir da
      // miniatura.
      const inline = (typeof SHOW_IMAGES !== 'undefined' && SHOW_IMAGES && l.imageData)
        ? `<img class="ln-image-inline" src="${l.imageData}" data-img="${l.imageData}" alt="${label}" onclick="openImageLightbox(this)" title="Click to view full size">`
        : '';
      return badge + inline;
    }
    const prompt = l.p || '[Expert@FW]#';
    // l.c pode conter os marcadores de variável (VAR_OPEN/VAR_CLOSE — ver
    // markVar() em db-render-engine.js) usados só para colorir o trecho no
    // safeHL(); o botão de copiar precisa do texto limpo, sem esses
    // caracteres de controle invisíveis.
    return `<span class="cmd-line"><span class="pr">${prompt} </span>${safeHL(l.c)}${copyBtn(stripVarMarkers(l.c), cmdId)}</span>`;
  }).join('');
  return `<div class="term">${rows}</div>`;
}

// Ícones do botão de copiar — o normal (dois retângulos sobrepostos) e o de
// confirmação (um "check"), trocados via innerHTML no momento do clique (ver
// copyBtn abaixo) e restaurados depois de COPY_BTN_FEEDBACK_MS.
const COPY_BTN_ICON = `<svg width="10" height="10" fill="none" viewBox="0 0 16 16">
      <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
      <path d="M3 10H2a1 1 0 01-1-1V2a1 1 0 011-1h7a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.5"/>
    </svg>`;
const COPY_BTN_ICON_OK = `<svg width="10" height="10" fill="none" viewBox="0 0 16 16">
      <path d="M2 8.5l3.5 3.5L14 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
const COPY_BTN_FEEDBACK_MS = 1400;
const COPY_BTN_ICON_ERR = `<svg width="10" height="10" fill="none" viewBox="0 0 16 16">
      <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`;

// navigator.clipboard (Clipboard API assíncrona) só existe em "contexto
// seguro" — HTTPS ou localhost. Enquanto o servidor estiver em HTTP puro
// (antes de um certificado TLS ser configurado — ver install-cgtoolbox.sh
// --tls-cert/--tls-key), navigator.clipboard normalmente é undefined no
// navegador, e chamar .writeText direto quebra silenciosamente (o clique
// nem chega a copiar nada). Aqui tentamos a API moderna primeiro e, se não
// existir ou falhar, caímos no método clássico (textarea temporário +
// document.execCommand('copy')), que funciona em HTTP também — assim o
// botão continua funcionando mesmo antes do HTTPS estar configurado.
function _copyToClipboard(text) {
  if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('execCommand(\'copy\') returned false'));
    } catch (err) {
      reject(err);
    }
  });
}

// Botão de copiar compacto, posicionado no final de cada linha de comando.
// Ao clicar (uma vez só): troca o ícone pelo "check" e mostra o texto
// "Copied" por COPY_BTN_FEEDBACK_MS, depois volta ao estado normal. Em caso
// de falha (raríssimo — nenhum dos dois métodos de cópia funcionou), mostra
// um "X" vermelho no lugar, para não falhar em silêncio. Extraído para
// _doSingleCopy() porque agora é só UM dos dois caminhos possíveis a partir
// de um clique — ver o modo de seleção múltipla logo abaixo.
function _doSingleCopy(el) {
  _copyToClipboard(el._copyText || '').then(() => {
    clearTimeout(el._copyRevertTimer); // clique repetido não deixa dois timers concorrendo
    el.classList.remove('err');
    el.classList.add('ok');
    el.innerHTML = `${COPY_BTN_ICON_OK}<span>Copied</span>`;
    el.title = 'Copied!';
    el._copyRevertTimer = setTimeout(() => {
      el.classList.remove('ok');
      el.innerHTML = COPY_BTN_ICON;
      el.title = 'Copy';
    }, COPY_BTN_FEEDBACK_MS);
  }).catch(err => {
    console.error('Copy failed', err);
    clearTimeout(el._copyRevertTimer);
    el.classList.remove('ok');
    el.classList.add('err');
    el.innerHTML = `${COPY_BTN_ICON_ERR}<span>Failed</span>`;
    el.title = 'Copy failed — select and copy manually';
    el._copyRevertTimer = setTimeout(() => {
      el.classList.remove('err');
      el.innerHTML = COPY_BTN_ICON;
      el.title = 'Copy';
    }, COPY_BTN_FEEDBACK_MS);
  });
}

// ════════════════════════════════════════════════
// MULTI-COPY SELECTION MODE — duplo clique em QUALQUER botão de copiar entra
// num modo em que um clique simples em qualquer linha (do mesmo comando ou de
// outro, em qualquer lugar da lista) apenas marca/desmarca aquela linha para
// uma cópia em lote, em vez de copiar na hora. Uma barra flutuante mostra
// quantas linhas estão marcadas e deixa copiar tudo junto (uma por linha, na
// ordem em que aparecem na página) ou cancelar. Pensado pra juntar vários
// comandos espalhados pela lista numa única colagem no terminal.
// Sair do modo: Escape, clicar fora (fora de botões copiar e da barra), ou o
// próprio botão "Copy"/"Cancel" da barra.
// ════════════════════════════════════════════════
let MULTI_COPY_MODE = false;
const MULTI_COPY_DBLCLICK_MS = 300; // janela pra distinguir clique único de duplo clique

function _mcBar() {
  let bar = document.getElementById('multiCopyBar');
  if (bar) return bar;
  bar = document.createElement('div');
  bar.id = 'multiCopyBar';
  bar.className = 'multi-copy-bar';
  // "Delete selected" só existe para admin (ver requireAdmin() no DELETE
  // /api/commands/:id em server/index.js — a API já recusaria de qualquer
  // forma, isto é só pra não mostrar um botão que vai falhar) — visibilidade
  // real controlada em _mcUpdateBar() (window.CG_IS_ADMIN só fica disponível
  // depois que /api/me responde, ver updateAccountUI em js/auth.js).
  bar.innerHTML = `
    <span class="multi-copy-count" id="multiCopyCount">0 selected</span>
    <button type="button" class="btn btn-danger btn-sm" id="multiCopyDeleteBtn" onclick="_mcDeleteSelected()" style="display:none;">Delete</button>
    <button type="button" class="btn btn-ghost btn-sm" onclick="_mcCancel()">Cancel</button>
    <button type="button" class="btn btn-primary btn-sm" id="multiCopyCopyBtn" onclick="_mcFinish()">Copy</button>
  `;
  document.body.appendChild(bar);
  return bar;
}
function _mcSelectedButtons() {
  return Array.from(document.querySelectorAll('.copy-btn.multi-on')); // ordem do DOM = ordem na página
}
// IDs de comando únicos entre as linhas selecionadas — várias linhas
// selecionadas do MESMO comando (ex.: duas linhas de um comando multi-linha)
// contam como um só para fins de exclusão, já que só existe DELETE por
// comando inteiro (server/index.js não tem exclusão de linha avulsa).
function _mcSelectedCommandIds() {
  return [...new Set(_mcSelectedButtons().map(b => b._cmdId).filter(Boolean))];
}
function _mcUpdateBar() {
  const bar = _mcBar();
  const n = _mcSelectedButtons().length;
  const countEl = document.getElementById('multiCopyCount');
  if (countEl) countEl.textContent = n === 1 ? '1 selected' : `${n} selected`;
  const copyBtnEl = document.getElementById('multiCopyCopyBtn');
  if (copyBtnEl) copyBtnEl.disabled = n === 0;
  const delBtnEl = document.getElementById('multiCopyDeleteBtn');
  if (delBtnEl) {
    delBtnEl.style.display = (typeof window !== 'undefined' && window.CG_IS_ADMIN) ? '' : 'none';
    delBtnEl.disabled = _mcSelectedCommandIds().length === 0;
  }
  bar.classList.toggle('show', MULTI_COPY_MODE);
}
function _mcToggle(el) {
  el.classList.toggle('multi-on');
  _mcUpdateBar();
}
// Chamado pelo 2º clique de um duplo clique — entra no modo já marcando a
// linha em que o usuário clicou (não é preciso marcá-la de novo depois).
function _mcEnter(el) {
  MULTI_COPY_MODE = true;
  document.body.classList.add('multi-copy-active');
  _mcToggle(el);
}
function _mcCancel() {
  MULTI_COPY_MODE = false;
  document.body.classList.remove('multi-copy-active');
  _mcSelectedButtons().forEach(b => b.classList.remove('multi-on'));
  _mcUpdateBar();
}
function _mcFinish() {
  const btns = _mcSelectedButtons();
  if (!btns.length) { _mcCancel(); return; }
  const text = btns.map(b => b._copyText || '').join('\n');
  _copyToClipboard(text).then(() => {
    _mcCancel();
  }).catch(err => {
    console.error('Multi-copy failed', err);
    alert('Failed to copy — please try again.');
  });
}
// Exclui de uma vez todos os comandos representados pelas linhas
// selecionadas (um comando pode ter mais de uma linha marcada, mas só conta
// uma vez — ver _mcSelectedCommandIds). Reaproveita deleteCommand()
// (js/api-client.js) e render() (js/render.js), o mesmo par usado pela
// exclusão individual no editor de comandos (ver cmdEditorDelete em
// js/command-editor.js).
function _mcDeleteSelected() {
  const ids = _mcSelectedCommandIds();
  if (!ids.length) return;
  const label = ids.length === 1 ? '1 selected command' : `${ids.length} selected commands`;
  if (typeof openConfirmModal !== 'function') return;
  openConfirmModal(`Delete ${label}? This action cannot be undone.`, { danger: true }).then(async ok => {
    if (!ok) return;
    try {
      await Promise.all(ids.map(id => deleteCommand(id)));
    } catch (err) {
      console.error('Bulk delete failed', err);
      alert('Failed to delete one or more of the selected commands. Please try again.');
    }
    _mcCancel();
    if (typeof render === 'function') render();
  });
}
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && MULTI_COPY_MODE) _mcCancel();
});
// Clicar em qualquer lugar que NÃO seja um botão de copiar nem a barra
// flutuante cancela o modo (sem copiar) — os cliques nos próprios botões de
// copiar/na barra são tratados pelos handlers deles, não chegam a cancelar
// aqui por causa do closest() abaixo.
document.addEventListener('click', ev => {
  if (!MULTI_COPY_MODE) return;
  if (ev.target.closest('.copy-btn') || ev.target.closest('.multi-copy-bar')) return;
  _mcCancel();
});

function copyBtn(text, cmdId) {
  const id = 'c' + (++_uid);
  const btn = `<button class="copy-btn copy-btn-inline" id="${id}" title="Copy (double-click to select multiple commands)">${COPY_BTN_ICON}</button>`;
  // store text via JS after insert
  setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el._copyText = text;
    el._cmdId = cmdId; // ver _mcSelectedCommandIds() / _mcDeleteSelected() acima
    let clickTimer = null;
    el.addEventListener('click', () => {
      if (MULTI_COPY_MODE) { _mcToggle(el); return; }
      if (clickTimer) {
        // 2º clique dentro da janela = era um duplo clique, não dois cliques
        // simples — cancela a cópia individual pendente do 1º clique.
        clearTimeout(clickTimer);
        clickTimer = null;
        _mcEnter(el);
        return;
      }
      clickTimer = setTimeout(() => {
        clickTimer = null;
        _doSingleCopy(el);
      }, MULTI_COPY_DBLCLICK_MS);
    });
    el.addEventListener('dblclick', ev => ev.preventDefault());
  }, 0);
  return btn;
}

// Escape simples para embutir texto (ex.: nomes de usuário) dentro de um atributo
// HTML comum (title="...") — diferente de jsAttrEscape (query-bar.js), que também
// escapa aspas simples para sobreviver dentro de um onclick="...('texto')".
function escAttr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Ícone de pasta (Folders, substitui a antiga estrela de Favoritos — ver
// js/folders.js) — contorno monocromático (currentColor), mesmo padrão dos
// demais ícones SVG do app (edit-btn/copy-btn acima; mesmo path usado no
// cabeçalho "Folders" da sidebar, ver index.html). `filled` decide entre a
// variante preenchida (comando está em pelo menos uma pasta) e a de contorno
// (não está em nenhuma); a cor em si (cinza vs. destaque) continua vindo do
// CSS (.fav-btn / .fav-btn.on), não do SVG.
function folderIcon(filled, size) {
  const s = size || 13;
  const fillAttr = filled ? 'currentColor' : 'none';
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="${fillAttr}" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.2h8.5A1.5 1.5 0 0 1 21 8.7v9.8A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5v-12z"/></svg>`;
}

// Formata timestamps do SQLite ('YYYY-MM-DD HH:MM:SS', sempre UTC — ver
// datetime('now') em schema.sql) para exibição local, sem depender de bibliotecas
// externas. Cai no texto original se o parsing falhar por algum motivo.
// Formato fixo dd/mm/aaaa hh:mm (24h), independente do locale do navegador
// (toLocaleString variava conforme o idioma do sistema do usuário).
function formatAuditDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return s;
  const p2 = n => String(n).padStart(2, '0');
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

// Popover de autoria/auditoria — mostrado ao passar o mouse sobre o ícone/badge de
// pastas (.fav-wrap:hover, ver components.css). Traz quem criou o comando e quem fez
// a última alteração (cai em createdBy enquanto ninguém editou — ver shapeCommand em
// server/index.js) e quando. Antes também listava "quem favoritou" (favoriteCount/
// favoritedBy) — removido junto com a migração para Folders (ver js/folders.js),
// já que pastas são privadas a cada usuário, sem lista cross-user para mostrar aqui.
function auditPopover({ createdBy, modifiedBy, updatedAt }) {
  return `<div class="fav-audit-pop">
    <div class="fav-audit-row"><span class="fav-audit-k">Created by:</span><span>${escAttr(createdBy || '—')}</span></div>
    <div class="fav-audit-row"><span class="fav-audit-k">Modified by:</span><span>${escAttr(modifiedBy || createdBy || '—')}</span></div>
    <div class="fav-audit-row"><span class="fav-audit-k">Modified on:</span><span>${escAttr(formatAuditDate(updatedAt))}</span></div>
  </div>`;
}

// Dropdown de pastas de um card — checkbox por pasta do usuário (marcada = o
// comando já está nela) mais um item "+ New folder" no rodapé. Aberto/fechado
// via toggleFolderMenu() (ver js/folders.js), que fecha os demais dropdowns
// de pasta abertos antes de abrir este. Cada item chama
// toggleCommandInFolder(cmdId, folderId, itemEl) diretamente (sem esperar
// re-render — ver comentário em js/folders.js sobre a atualização otimista).
function folderMenuHtml(cmdId, folderIds) {
  const idSet = new Set(folderIds || []);
  const folders = (typeof FOLDERS !== 'undefined' ? FOLDERS : []).slice()
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const items = folders.map(f => {
    const on = idSet.has(f.id);
    return `<div class="folder-menu-item${on ? ' on' : ''}" onclick="toggleCommandInFolder('${cmdId}', ${f.id}, this)">
      <span class="folder-menu-chk">${on ? '✓' : ''}</span><span class="folder-menu-name">${escAttr(f.name)}</span>
    </div>`;
  }).join('');
  const emptyHtml = folders.length ? '' : `<div class="folder-menu-empty">No folders yet.</div>`;
  return `<div class="folder-menu-pop">
    ${emptyHtml}${items}
    <div class="folder-menu-divider"></div>
    <div class="folder-menu-item folder-menu-new" onclick="document.querySelectorAll('.folder-menu-pop.open').forEach(p=>p.classList.remove('open')); promptCreateFolder('${cmdId}')">
      <span class="folder-menu-chk"></span><span class="folder-menu-name">+ New folder</span>
    </div>
  </div>`;
}

// Rótulo + cor de uma chave de catálogo (Vendor/Sistema/Versão/Ambiente) — mesmo
// padrão de csvVendorLabel/csvSystemLabel (js/csv-export.js), mas devolvendo também
// a cor cadastrada no catálogo (ver vendors/systems/versions/environments em
// schema.sql, todos com coluna `color`) para colorir o "pip" da tag de escopo.
function scopeLabelColor(catalogArr, key) {
  const it = (catalogArr || []).find(x => x.key === key);
  return it ? { label: it.label, color: it.color || '#8B949E' } : { label: key, color: '#8B949E' };
}

// Uma tag de escopo (Vendor/Sistema/Versão/Ambiente) para o cabeçalho do card —
// array vazio = "aplica a todos" (mesma convenção de command_vendors/command_versions/
// command_environments, ver render.js), mostrado como um rótulo neutro em vez de listar
// tudo. Com 1+ valores, mostra os rótulos (separados por vírgula) com um "pip" colorido
// (mesmo elemento .sb-pip usado nas listas da sidebar, ver ccBuildSidebarPanel em
// catalogs.js) na cor do primeiro item cadastrado no catálogo.
function buildScopeTag(keys, catalogArr, allLabel) {
  if (!keys || !keys.length) return `<span class="tag scope-tag scope-tag-empty">${allLabel}</span>`;
  const items = keys.map(k => scopeLabelColor(catalogArr, k));
  const label = items.map(it => it.label).join(', ');
  return `<span class="tag scope-tag"><span class="sb-pip" style="background:${items[0].color}"></span>${label}</span>`;
}

// As 4 tags de escopo (Vendor/Sistema/Versão/Ambiente) exibidas logo após o nome do
// comando no cabeçalho do card — ver card() abaixo. `scope` traz os arrays já
// resolvidos do comando (row.vendors/systems/versions/environments, ver
// db-render-engine.js); os catálogos (rótulo/cor) vêm de CATALOGS (js/catalogs.js).
function scopeTagsHtml(scope) {
  if (!scope) return '';
  const cat = (typeof CATALOGS !== 'undefined' && CATALOGS) || {};
  const vd = buildScopeTag(scope.vendors, cat.vendors, 'All vendors');
  const sy = buildScopeTag(scope.systems, cat.systems, 'All systems');
  const ve = buildScopeTag(scope.versions, cat.versions, 'All versions');
  const en = buildScopeTag(scope.environments, cat.environments, 'All environments');
  return `<span class="scope-tags">${vd}${sy}${ve}${en}</span>`;
}

function card({ id, name, desc, about, tags = [], lines, diffs, folderIds = [], createdBy, modifiedBy, updatedAt, isSystem = false, vendors, systems, versions, environments }) {
  const did = 'd' + (++_uid);
  const tagHtml = tags.map(([cls, lbl]) => `<span class="tag ${cls}">${lbl}</span>`).join('');
  const scopeHtml = scopeTagsHtml({ vendors, systems, versions, environments });
  const inAnyFolder = !!(folderIds && folderIds.length);
  // O botão agora abre um dropdown de pastas (toggleFolderMenu, ver
  // js/folders.js/js/terminal-renderer.js: folderMenuHtml) em vez de
  // favoritar/desfavoritar direto no clique — cada pasta marcada/desmarcada
  // individualmente dentro do dropdown. O popover de autoria continua
  // aparecendo ao passar o mouse sobre .fav-wrap, independente do dropdown.
  const favHtml = id ? `<span class="fav-wrap">
    <button class="fav-btn${inAnyFolder ? ' on' : ''}" onclick="toggleFolderMenu(event, this)" title="${inAnyFolder ? 'In folders' : 'Add to folder'}">${folderIcon(inAnyFolder)}</button>
    ${folderMenuHtml(id, folderIds)}
    ${auditPopover({ createdBy, modifiedBy, updatedAt })}
  </span>` : '';
  // Um usuário comum só pode editar o PRÓPRIO comando (createdBy ===
  // CURRENT_USER) — o de outro usuário, ou um comando de referência
  // (created_by='System'), só mostra o botão Duplicate, que cria uma cópia
  // própria e editável (ver PUT /api/commands/:id em server/index.js, que
  // repete essa mesma checagem no servidor). Admins não têm essa restrição:
  // podem editar/excluir qualquer comando, inclusive System. Cada alteração
  // fica registrada no log de auditoria do servidor (audit_log, ver botão
  // "View audit log" em Configurações).
  const isOwnCommand = typeof CURRENT_USER !== 'undefined' && CURRENT_USER === createdBy;
  const canEdit = window.CG_IS_ADMIN || (!isSystem && isOwnCommand);
  const editHtml = (id && canEdit && typeof openCommandEditor === 'function') ? `<button class="edit-btn" onclick="openCommandEditor('edit','${id}',event)" title="Edit command">
    <svg width="11" height="11" fill="none" viewBox="0 0 16 16">
      <path d="M11.3 1.7l3 3L5 14H2v-3l9.3-9.3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>
  </button>` : '';
  const duplicateHtml = (id && typeof openCommandEditor === 'function') ? `<button class="edit-btn" onclick="openCommandEditor('duplicate','${id}')" title="Duplicate command">
    <svg width="11" height="11" fill="none" viewBox="0 0 16 16">
      <rect x="5.5" y="5.5" width="9" height="9" rx="1.3" stroke="currentColor" stroke-width="1.4"/>
      <path d="M3.2 10.5H2.3a.8.8 0 01-.8-.8v-7A.8.8 0 012.3 2h7a.8.8 0 01.8.8v.9" stroke="currentColor" stroke-width="1.4"/>
    </svg>
  </button>` : '';
  const aboutHtml = about ? `<div class="card-about">
    <div class="about-body">
      <span class="about-purpose">${about.purpose}</span>
      ${about.when ? `<span class="about-when"><strong>When to use:</strong> ${about.when}</span>` : ''}
      ${about.obs ? `<span class="about-when"><strong>Note:</strong> ${about.obs}</span>` : ''}
    </div>
  </div>` : '';
  const diffOpenCls = AUTO_EXPAND_DIFFS ? ' open' : '';
  const diffHtml = diffs ? `
    <div class="diff">
      <div class="diff-hd${diffOpenCls}" onclick="toggleDiff('${did}')">
        <svg width="6" height="10" fill="none" viewBox="0 0 6 10">
          <path d="M1 1l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>⚡ Differences by version / platform
      </div>
      <div class="diff-body${diffOpenCls}" id="${did}">
        ${diffs.map(d => `
          <div class="diff-ver">
            <div class="diff-ver-hd"><span class="diff-ver-tag">${d.v}</span>${d.n || ''}</div>
            ${termRender(d.l, id)}
          </div>`).join('')}
      </div>
    </div>` : '';

  return `<div class="card" data-cmd-id="${id || ''}">
    <div class="card-head">
      <span class="card-name">${name}</span>
      ${scopeHtml}
      <span class="card-desc">${desc || ''}</span>
      ${tagHtml}
      <span class="card-actions">${favHtml}${duplicateHtml}${editHtml}</span>
    </div>
    ${aboutHtml}
    ${termRender(lines, id)}
    ${diffHtml}
  </div>`;
}

// ── Agrupamentos recolhíveis (seções por tópico e, no modo "Versão", o bloco
// por Versão/Ambiente) — mesmo estilo de accordion do Check Point SmartConsole
// (rulebase com seções recolhíveis + botões "recolher tudo"/"expandir tudo"). ──
const COLLAPSED_SECTIONS_KEY = 'cpa-collapsed-sections';
function loadCollapsedSections() {
  try {
    const raw = localStorage.getItem(COLLAPSED_SECTIONS_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch (e) {}
  return new Set();
}
function persistCollapsedSections() {
  try { localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify([...COLLAPSED_SECTIONS])); } catch (e) {}
}
let COLLAPSED_SECTIONS = loadCollapsedSections();

// Bloco recolhível genérico — usado tanto para a seção de um Tópico quanto,
// no modo "Agrupar por Versão", para o bloco inteiro de uma combinação Versão/Ambiente.
function collapsibleGroup(key, headerHtml, bodyHtml, extraClass) {
  const collapsed = COLLAPSED_SECTIONS.has(key);
  return `<div class="section${extraClass ? ' ' + extraClass : ''}${collapsed ? ' collapsed' : ''}" data-sec-key="${key}">
    <div class="sec-title" onclick="toggleSection('${key}')">
      <svg class="sec-chevron" width="8" height="8" viewBox="0 0 10 10" fill="none"><path d="M1 2l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      ${headerHtml}
    </div>
    <div class="sec-body">${bodyHtml}</div>
  </div>`;
}

// `key` identifica a seção de forma estável entre re-renders (ex.: o próprio tópico,
// ou "R82__standalone__capture" quando aninhada dentro de um bloco de Versão) para que
// o estado recolhido/expandido sobreviva a filtros e reaberturas do app.
function section(icon, title, cards, key) {
  if (!cards.length) return '';
  const k = key || title;
  const iconHtml = icon ? `${icon} ` : '';
  return collapsibleGroup(k, `${iconHtml}${title} <span class="sec-count">${cards.length}</span>`, cards.join(''));
}

function toggleSection(key) {
  const el = document.querySelector(`.section[data-sec-key="${key}"]`);
  if (!el) return;
  const willCollapse = !el.classList.contains('collapsed');
  el.classList.toggle('collapsed', willCollapse);
  if (willCollapse) COLLAPSED_SECTIONS.add(key); else COLLAPSED_SECTIONS.delete(key);
  persistCollapsedSections();
}
// Botões da barra de ferramentas — recolhe/expande todas as seções (e blocos de
// Versão) atualmente na tela, inclusive na visão de Favoritos.
function collapseAllSections() {
  document.querySelectorAll('#out .section').forEach(el => {
    el.classList.add('collapsed');
    if (el.dataset.secKey) COLLAPSED_SECTIONS.add(el.dataset.secKey);
  });
  persistCollapsedSections();
}
function expandAllSections() {
  document.querySelectorAll('#out .section').forEach(el => {
    el.classList.remove('collapsed');
    if (el.dataset.secKey) COLLAPSED_SECTIONS.delete(el.dataset.secKey);
  });
  persistCollapsedSections();
}

function toggleDiff(id) {
  const body = document.getElementById(id);
  const hd = body.previousElementSibling;
  body.classList.toggle('open');
  hd.classList.toggle('open');
}

// ════════════════════════════════════════════════
// IMAGE LIGHTBOX — abre em tamanho maior a imagem de uma linha do tipo
// 'image' (screenshot de configuração, ver command_lines.image_data e
// termRender() acima). O base64 fica só no atributo data-img do badge
// clicado; só é copiado para o <img> do lightbox no momento do clique
// (e removido ao fechar), para não manter uma cópia extra na memória.
// ════════════════════════════════════════════════
function openImageLightbox(el) {
  const src = el.getAttribute('data-img');
  if (!src) return;
  const overlay = document.getElementById('imageLightboxOverlay');
  const img = document.getElementById('imageLightboxImg');
  if (!overlay || !img) return;
  img.src = src;
  overlay.classList.add('show');
}
function closeImageLightbox() {
  const overlay = document.getElementById('imageLightboxOverlay');
  const img = document.getElementById('imageLightboxImg');
  if (overlay) overlay.classList.remove('show');
  if (img) img.src = '';
}
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('imageLightboxOverlay');
  if (overlay) overlay.addEventListener('click', ev => { if (ev.target.id === 'imageLightboxOverlay') closeImageLightbox(); });
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') closeImageLightbox();
});
// Acessibilidade: a etiqueta da imagem (.ln-image-tag, não a linha .ln-image
// inteira) é focável (tabindex) e tem role="button" (ver termRender acima) —
// Enter/Espaço ativam igual a um clique.
document.addEventListener('keydown', ev => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList && ev.target.classList.contains('ln-image-tag')) {
    ev.preventDefault();
    openImageLightbox(ev.target);
  }
});

