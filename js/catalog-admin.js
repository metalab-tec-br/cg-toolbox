// ════════════════════════════════════════════════
// CATALOG ADMIN — "Manage Versions" / "Manage Environments" / "Manage Topics" /
// "Manage Parameters" screens (one separate window per item, not a single
// tabbed modal — see #catalogAdminVersionsOverlay, #catalogAdminEnvironmentsOverlay,
// #catalogAdminTopicsOverlay, #catalogAdminParametersOverlay in index.html).
// ════════════════════════════════════════════════
// Reachable by any user via Settings → Registration (see index.html,
// .settings-pane[data-pane="catalog"]) — the old "Admin mode" gate was
// removed; COMMAND_EDITING_ENABLED (js/settings.js) is now always true, kept
// only as a harmless defensive check below.
//
// Each item (version/environment/topic) has a stable `key` — the same one
// used in command_versions/command_environments/command_topics — which can
// NEVER be edited after creation, only label/color/icon/order. Deletion is
// blocked by the server (409) when the item is in use by at least one
// command, or when it's a protected topic (e.g. 'environment') — see
// server/index.js.
//
// After any create/edit/delete, catAdminRefreshCatalogs() fetches the updated
// catalogs from the server and propagates them to the rest of the app
// (sidebar, Settings modal, command editor, render()) without reloading the
// page — see js/catalogs.js (renderCatalogUI/ccApplyToLegacyArrays).

function _cat(id) { return document.getElementById(id); }
function _catEscAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function _catEscHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// `kind`: 'versions' | 'environments' | 'topics' | 'parameters' — each one is
// its own screen now (no tabs). The corresponding sidebar button calls
// openCatalogAdmin('environments') etc. — see index.html/#addCommandBlock.
const CAT_ADMIN_OVERLAY_IDS = {
  vendors: 'catalogAdminVendorsOverlay',
  systems: 'catalogAdminSystemsOverlay',
  versions: 'catalogAdminVersionsOverlay',
  environments: 'catalogAdminEnvironmentsOverlay',
  topics: 'catalogAdminTopicsOverlay',
  parameters: 'catalogAdminParametersOverlay',
};
// One message box per screen — catAdminMsg() below writes to all at once
// (only one is visible at a time, so this is always harmless and simpler
// than tracking "which screen is open now").
const CAT_ADMIN_MSG_IDS = ['catAdminMsgVendors', 'catAdminMsgSystems', 'catAdminMsgVersions', 'catAdminMsgEnvironments', 'catAdminMsgTopics', 'catAdminMsgParameters'];
// Preenche um <select> de catálogo (Vendor/Sistema) com as opções atuais,
// preservando/aplicando o valor selecionado — usado pelos formulários de
// Sistema (vendor) e Versão (sistema), que agora são FK obrigatória e direta
// (ver server/schema.sql) em vez de vínculo N:N.
// `placeholder` (opcional): rótulo da dependência (ex.: "Vendor", "System")
// mostrado como 1ª opção desabilitada — sem isso, um <select> nunca fica
// "em branco" de verdade quando não há nada selecionado (o navegador sempre
// escolhe a primeira opção da lista), o que deixava o campo parecendo vazio/
// sem explicação nenhuma (ex.: linha "+ Add system" antes de qualquer Vendor
// existir). Com o placeholder, sempre fica claro o que aquele dropdown
// representa, tanto vazio quanto já preenchido.
function _catPopulateSelect(selectId, items, selectedValue, placeholder) {
  const el = _cat(selectId);
  if (!el) return;
  const placeholderHtml = placeholder
    ? `<option value="" disabled${selectedValue ? '' : ' selected'}>${_catEscHtml(placeholder)}</option>`
    : '';
  el.innerHTML = placeholderHtml + (items || []).map(it => `<option value="${_catEscAttr(it.key)}">${_catEscHtml(it.label)}</option>`).join('');
  if (selectedValue != null) el.value = selectedValue;
}

function openCatalogAdmin(kind) {
  if (typeof COMMAND_EDITING_ENABLED !== 'undefined' && !COMMAND_EDITING_ENABLED) return; // safety lock, same as the command editor
  const overlayId = CAT_ADMIN_OVERLAY_IDS[kind];
  if (!overlayId) return;
  _cat(overlayId).classList.add('show');
  catAdminMsg('');
  renderCatAdminAll();
}
function closeCatalogAdmin(kind) {
  const overlayId = CAT_ADMIN_OVERLAY_IDS[kind];
  if (overlayId) _cat(overlayId).classList.remove('show');
}
Object.values(CAT_ADMIN_OVERLAY_IDS).forEach(overlayId => {
  const el = document.getElementById(overlayId);
  if (el) el.addEventListener('click', ev => { if (ev.target.id === overlayId) el.classList.remove('show'); });
});
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  Object.values(CAT_ADMIN_OVERLAY_IDS).forEach(overlayId => { const el = _cat(overlayId); if (el) el.classList.remove('show'); });
});

function catAdminMsg(text, kind) {
  CAT_ADMIN_MSG_IDS.forEach(id => {
    const el = _cat(id);
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('err', kind === 'err');
    el.classList.toggle('ok', kind === 'ok');
  });
}

// Turns a fetch error response (409 in-use/protected, 400 validation, etc.)
// into a friendly message.
async function catAdminHandleError(res) {
  let body = {};
  try { body = await res.json(); } catch (e) {}
  if (body.error === 'in_use') { catAdminMsg(`Cannot delete: in use by ${body.count != null ? body.count : '?'} command(s).`, 'err'); return; }
  if (body.error === 'protected') { catAdminMsg('This item is protected by the system and cannot be deleted.', 'err'); return; }
  if (body.error === 'structural_dependency') { catAdminMsg(`Cannot delete: ${body.count != null ? body.count : '?'} command(s) depend on this parameter directly in code (e.g. "Requires SRC/DST").`, 'err'); return; }
  if (body.error === 'conflict') { catAdminMsg('An item with this key already exists.', 'err'); return; }
  if (body.error === 'validation_error') { catAdminMsg(body.message || 'Something went wrong. Please try again.', 'err'); return; }
  catAdminMsg('Something went wrong. Please try again.', 'err');
}

// Fetches the updated catalogs from the server and propagates them to the
// rest of the app (sidebar, Settings modal, command editor, render()) — see js/catalogs.js.
async function catAdminRefreshCatalogs() {
  try {
    const res = await fetch('/api/catalogs');
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.versions)) {
      CATALOGS = Object.assign(
        { vendors: [], systems: [], version_environments: [], environment_topics: [] },
        data
      );
    }
    }
  } catch (e) { console.warn('Failed to reload catalogs', e); }
  if (typeof ccApplyToLegacyArrays === 'function') ccApplyToLegacyArrays();
  if (typeof renderCatalogUI === 'function') renderCatalogUI();
  if (typeof sortAllDropdowns === 'function') sortAllDropdowns();
  renderCatAdminAll();
  if (typeof render === 'function') render();
}

function renderCatAdminAll() {
  renderCatAdminVendors();
  renderCatAdminSystems();
  renderCatAdminVersions();
  renderCatAdminEnvironments();
  renderCatAdminTopics();
  renderCatAdminParameters();
}

// ── Vendors ──────────────────────────────────────
function renderCatAdminVendors() {
  const list = _cat('catVendorsList');
  if (!list) return;
  list.innerHTML = (CATALOGS.vendors || []).map(v => `
    <div class="tag-row">
      <input class="set-input" id="catVd_label_${_catEscAttr(v.key)}" value="${_catEscAttr(v.label)}" style="flex:1;min-width:80px;">
      <input type="color" class="cat-color-input" id="catVd_color_${_catEscAttr(v.key)}" value="${_catEscAttr(v.color || '#8B949E')}">
      <div class="cat-row-actions">
        <button type="button" class="edit-btn" onclick="catAdminSaveVendor('${_catEscAttr(v.key)}')" title="Save">💾</button>
        <button type="button" class="edit-btn" onclick="catAdminDeleteVendor('${_catEscAttr(v.key)}')" title="Delete">🗑️</button>
      </div>
    </div>`).join('');
}
async function catAdminSaveVendor(key) {
  const label = _cat('catVd_label_' + key).value.trim();
  const color = _cat('catVd_color_' + key).value;
  if (!label) { catAdminMsg('Fill in the required label(s).', 'err'); return; }
  try {
    const res = await fetch('/api/vendors/' + encodeURIComponent(key), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, color }),
    });
    if (!res.ok) return catAdminHandleError(res);
    catAdminMsg('Saved.', 'ok');
    catAdminRefreshCatalogs();
  } catch (e) { catAdminMsg('Something went wrong. Please try again.', 'err'); }
}
async function catAdminDeleteVendor(key) {
  const ok = await openConfirmModal(`Delete "${key}"? This action cannot be undone.`);
  if (!ok) return;
  try {
    const res = await fetch('/api/vendors/' + encodeURIComponent(key), { method: 'DELETE' });
    if (!res.ok) return catAdminHandleError(res);
    catAdminMsg('Deleted.', 'ok');
    catAdminRefreshCatalogs();
  } catch (e) { catAdminMsg('Something went wrong. Please try again.', 'err'); }
}
async function catAdminAddVendor() {
  const label = _cat('catVdNewLabel').value.trim();
  const color = _cat('catVdNewColor').value;
  if (!label) { catAdminMsg('Fill in the required label(s).', 'err'); return; }
  try {
    const res = await fetch('/api/vendors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, color }),
    });
    if (!res.ok) return catAdminHandleError(res);
    _cat('catVdNewLabel').value = ''; _cat('catVdNewColor').value = '#8B949E';
    catAdminMsg('Added.', 'ok');
    catAdminRefreshCatalogs();
  } catch (e) { catAdminMsg('Something went wrong. Please try again.', 'err'); }
}

// ── Systems ──────────────────────────────────────
// Hierarquia ESTRITA: um Sistema pertence a exatamente um Vendor (FK direta —
// systems.vendor, ver server/schema.sql), por isso o Vendor é um campo
// obrigatório aqui (um <select> por linha + no formulário de novo sistema),
// diferente do antigo vínculo N:N opcional (vendor_os).
function renderCatAdminSystems() {
  const list = _cat('catSysList');
  if (!list) return;
  const systems = CATALOGS.systems || [];
  list.innerHTML = systems.map(s => `
    <div class="tag-row">
      <select class="set-input" id="catSys_vendor_${_catEscAttr(s.key)}" style="max-width:140px;"></select>
      <input class="set-input" id="catSys_label_${_catEscAttr(s.key)}" value="${_catEscAttr(s.label)}" style="flex:1;min-width:80px;">
      <input type="color" class="cat-color-input" id="catSys_color_${_catEscAttr(s.key)}" value="${_catEscAttr(s.color || '#8B949E')}">
      <div class="cat-row-actions">
        <button type="button" class="edit-btn" onclick="catAdminSaveSystem('${_catEscAttr(s.key)}')" title="Save">💾</button>
        <button type="button" class="edit-btn" onclick="catAdminDeleteSystem('${_catEscAttr(s.key)}')" title="Delete">🗑️</button>
      </div>
    </div>`).join('');
  systems.forEach(s => _catPopulateSelect('catSys_vendor_' + s.key, CATALOGS.vendors, s.vendor, 'Vendor'));
  _catPopulateSelect('catSysNewVendor', CATALOGS.vendors, null, 'Vendor');
}
async function catAdminSaveSystem(key) {
  const label = _cat('catSys_label_' + key).value.trim();
  const color = _cat('catSys_color_' + key).value;
  const vendor = _cat('catSys_vendor_' + key).value;
  if (!label) { catAdminMsg('Fill in the required label(s).', 'err'); return; }
  if (!vendor) { catAdminMsg('Choose a vendor.', 'err'); return; }
  try {
    const res = await fetch('/api/systems/' + encodeURIComponent(key), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, color, vendor }),
    });
    if (!res.ok) return catAdminHandleError(res);
    catAdminMsg('Saved.', 'ok');
    catAdminRefreshCatalogs();
  } catch (e) { catAdminMsg('Something went wrong. Please try again.', 'err'); }
}
async function catAdminDeleteSystem(key) {
  const ok = await openConfirmModal(`Delete "${key}"? This action cannot be undone.`);
  if (!ok) return;
  try {
    const res = await fetch('/api/systems/' + encodeURIComponent(key), { method: 'DELETE' });
    if (!res.ok) return catAdminHandleError(res);
    catAdminMsg('Deleted.', 'ok');
    catAdminRefreshCatalogs();
  } catch (e) { catAdminMsg('Something went wrong. Please try again.', 'err'); }
}
async function catAdminAddSystem() {
  const label = _cat('catSysNewLabel').value.trim();
  const color = _cat('catSysNewColor').value;
  const vendor = _cat('catSysNewVendor').value;
  if (!label) { catAdminMsg('Fill in the required label(s).', 'err'); return; }
  if (!vendor) { catAdminMsg('Choose a vendor.', 'err'); return; }
  try {
    const res = await fetch('/api/systems', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, color, vendor }),
    });
    if (!res.ok) return catAdminHandleError(res);
    _cat('catSysNewLabel').value = ''; _cat('catSysNewColor').value = '#8B949E';
    catAdminMsg('Added.', 'ok');
    catAdminRefreshCatalogs();
  } catch (e) { catAdminMsg('Something went wrong. Please try again.', 'err'); }
}

// ── Versions ─────────────────────────────────────
// A chave primária real agora é composta (system, key) — o mesmo `key` de
// versão pode existir sob sistemas diferentes (ex.: "R82" em dois sistemas
// distintos), só não dentro do MESMO vendor (ver comentário em
// server/schema.sql). Por isso os ids de DOM de cada linha incorporam o
// sistema (`${system}::${key}`) para não colidir, e save/delete recebem os
// dois valores e chamam /api/versions/:system/:key.
function renderCatAdminVersions() {
  const list = _cat('catVersionsList');
  if (!list) return;
  const versions = CATALOGS.versions || [];
  list.innerHTML = versions.map(v => {
    const rid = _catEscAttr(v.system) + '::' + _catEscAttr(v.key);
    return `
    <div class="tag-row">
      <select class="set-input" id="catV_system_${rid}" style="max-width:130px;"></select>
      <input class="set-input" id="catV_label_${rid}" value="${_catEscAttr(v.label)}" style="flex:1;min-width:80px;">
      <input type="color" class="cat-color-input" id="catV_color_${rid}" value="${_catEscAttr(v.color || '#8B949E')}">
      <div class="cat-row-actions">
        <button type="button" class="edit-btn" onclick="catAdminSaveVersion('${_catEscAttr(v.system)}','${_catEscAttr(v.key)}')" title="Save">💾</button>
        <button type="button" class="edit-btn" onclick="catAdminDeleteVersion('${_catEscAttr(v.system)}','${_catEscAttr(v.key)}')" title="Delete">🗑️</button>
      </div>
    </div>`;
  }).join('');
  versions.forEach(v => _catPopulateSelect('catV_system_' + v.system + '::' + v.key, CATALOGS.systems, v.system, 'System'));
  _catPopulateSelect('catVNewSystem', CATALOGS.systems, null, 'System');
}
async function catAdminSaveVersion(system, key) {
  const rid = system + '::' + key;
  const label = _cat('catV_label_' + rid).value.trim();
  const color = _cat('catV_color_' + rid).value;
  const newSystem = _cat('catV_system_' + rid).value;
  if (!label) { catAdminMsg('Fill in the required label(s).', 'err'); return; }
  if (!newSystem) { catAdminMsg('Choose a system.', 'err'); return; }
  try {
    const res = await fetch(`/api/versions/${encodeURIComponent(system)}/${encodeURIComponent(key)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, color, system: newSystem }),
    });
    if (!res.ok) return catAdminHandleError(res);
    catAdminMsg('Saved.', 'ok');
    catAdminRefreshCatalogs();
  } catch (e) { catAdminMsg('Something went wrong. Please try again.', 'err'); }
}
async function catAdminDeleteVersion(system, key) {
  const ok = await openConfirmModal(`Delete "${key}"? This action cannot be undone.`);
  if (!ok) return;
  try {
    const res = await fetch(`/api/versions/${encodeURIComponent(system)}/${encodeURIComponent(key)}`, { method: 'DELETE' });
    if (!res.ok) return catAdminHandleError(res);
    catAdminMsg('Deleted.', 'ok');
    catAdminRefreshCatalogs();
  } catch (e) { catAdminMsg('Something went wrong. Please try again.', 'err'); }
}
async function catAdminAddVersion() {
  const label = _cat('catVNewLabel').value.trim();
  const color = _cat('catVNewColor').value;
  const system = _cat('catVNewSystem').value;
  if (!label) { catAdminMsg('Fill in the required label(s).', 'err'); return; }
  if (!system) { catAdminMsg('Choose a system.', 'err'); return; }
  try {
    const res = await fetch('/api/versions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, color, system }),
    });
    if (!res.ok) return catAdminHandleError(res);
    _cat('catVNewLabel').value = ''; _cat('catVNewColor').value = '#8B949E';
    catAdminMsg('Added.', 'ok');
    catAdminRefreshCatalogs();
  } catch (e) { catAdminMsg('Something went wrong. Please try again.', 'err'); }
}

// ── Environments ─────────────────────────────────
function renderCatAdminEnvironments() {
  const list = _cat('catEnvironmentsList');
  if (!list) return;
  list.innerHTML = (CATALOGS.environments || []).map(e => `
    <div class="tag-row">
      <input class="set-input" id="catE_label_${_catEscAttr(e.key)}" value="${_catEscAttr(e.label)}" style="flex:1;min-width:120px;">
      <input type="color" class="cat-color-input" id="catE_color_${_catEscAttr(e.key)}" value="${_catEscAttr(e.color || '#8B949E')}">
      <div class="cat-row-actions">
        <button type="button" class="edit-btn" onclick="catAdminSaveEnvironment('${_catEscAttr(e.key)}')" title="Save">💾</button>
        <button type="button" class="edit-btn" onclick="catAdminDeleteEnvironment('${_catEscAttr(e.key)}')" title="Delete">🗑️</button>
      </div>
    </div>`).join('');
}
async function catAdminSaveEnvironment(key) {
  const label = _cat('catE_label_' + key).value.trim();
  const color = _cat('catE_color_' + key).value;
  if (!label) { catAdminMsg('Fill in the required label(s).', 'err'); return; }
  try {
    const res = await fetch('/api/environments/' + encodeURIComponent(key), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, color }),
    });
    if (!res.ok) return catAdminHandleError(res);
    catAdminMsg('Saved.', 'ok');
    catAdminRefreshCatalogs();
  } catch (e) { catAdminMsg('Something went wrong. Please try again.', 'err'); }
}
async function catAdminDeleteEnvironment(key) {
  const ok = await openConfirmModal(`Delete "${key}"? This action cannot be undone.`);
  if (!ok) return;
  try {
    const res = await fetch('/api/environments/' + encodeURIComponent(key), { method: 'DELETE' });
    if (!res.ok) return catAdminHandleError(res);
    catAdminMsg('Deleted.', 'ok');
    catAdminRefreshCatalogs();
  } catch (e) { catAdminMsg('Something went wrong. Please try again.', 'err'); }
}
async function catAdminAddEnvironment() {
  const label = _cat('catENewLabel').value.trim();
  const color = _cat('catENewColor').value;
  if (!label) { catAdminMsg('Fill in the required label(s).', 'err'); return; }
  try {
    const res = await fetch('/api/environments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, color }),
    });
    if (!res.ok) return catAdminHandleError(res);
    _cat('catENewLabel').value = ''; _cat('catENewColor').value = '#8B949E';
    catAdminMsg('Added.', 'ok');
    catAdminRefreshCatalogs();
  } catch (e) { catAdminMsg('Something went wrong. Please try again.', 'err'); }
}

// ── Topics ───────────────────────────────────────
// Mesmos campos de Environments (label/color) — sem section_title (removido
// a pedido do usuário, ver comentário em schema.sql); a única diferença real
// é is_protected (badge/gate de exclusão do tópico especial 'environment').
function renderCatAdminTopics() {
  const list = _cat('catTopicsList');
  if (!list) return;
  list.innerHTML = (CATALOGS.topics || []).map(tp => `
    <div class="tag-row">
      ${tp.is_protected ? `<span class="cat-protected-badge">${_catEscHtml('protected')}</span>` : ''}
      <input class="set-input" id="catT_label_${_catEscAttr(tp.key)}" value="${_catEscAttr(tp.label)}" style="flex:1;min-width:120px;">
      <input type="color" class="cat-color-input" id="catT_color_${_catEscAttr(tp.key)}" value="${_catEscAttr(tp.color || '#8B949E')}">
      <div class="cat-row-actions">
        <button type="button" class="edit-btn" onclick="catAdminSaveTopic('${_catEscAttr(tp.key)}')" title="Save">💾</button>
        ${tp.is_protected ? '' : `<button type="button" class="edit-btn" onclick="catAdminDeleteTopic('${_catEscAttr(tp.key)}')" title="Delete">🗑️</button>`}
      </div>
    </div>`).join('');
}
async function catAdminSaveTopic(key) {
  const label = _cat('catT_label_' + key).value.trim();
  const color = _cat('catT_color_' + key).value;
  if (!label) { catAdminMsg('Fill in the required label(s).', 'err'); return; }
  try {
    const res = await fetch('/api/topics/' + encodeURIComponent(key), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, color }),
    });
    if (!res.ok) return catAdminHandleError(res);
    catAdminMsg('Saved.', 'ok');
    catAdminRefreshCatalogs();
  } catch (e) { catAdminMsg('Something went wrong. Please try again.', 'err'); }
}
async function catAdminDeleteTopic(key) {
  const ok = await openConfirmModal(`Delete "${key}"? This action cannot be undone.`);
  if (!ok) return;
  try {
    const res = await fetch('/api/topics/' + encodeURIComponent(key), { method: 'DELETE' });
    if (!res.ok) return catAdminHandleError(res);
    catAdminMsg('Deleted.', 'ok');
    catAdminRefreshCatalogs();
  } catch (e) { catAdminMsg('Something went wrong. Please try again.', 'err'); }
}
async function catAdminAddTopic() {
  const label = _cat('catTNewLabel').value.trim();
  const color = _cat('catTNewColor').value;
  if (!label) { catAdminMsg('Fill in the required label(s).', 'err'); return; }
  try {
    const res = await fetch('/api/topics', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, color }),
    });
    if (!res.ok) return catAdminHandleError(res);
    _cat('catTNewLabel').value = ''; _cat('catTNewColor').value = '#8B949E';
    catAdminMsg('Added.', 'ok');
    catAdminRefreshCatalogs();
  } catch (e) { catAdminMsg('Something went wrong. Please try again.', 'err'); }
}

// ── Parameters (unified query bar + "Insert variable") ──
// Row layout: Order / Parameter (key, immutable) / Description — same
// in-line style (.tag-row) used for Versions/Environments/Topics. Single
// `label` field (no more PT/EN pair) — the whole app is English-only now.
function renderCatAdminParameters() {
  const list = _cat('catParametersList');
  if (!list) return;
  list.innerHTML = (CATALOGS.parameters || []).map(p => `
    <div class="tag-row">
      <input class="set-input" type="number" id="catP_order_${_catEscAttr(p.key)}" value="${_catEscAttr(p.sort_order)}" style="max-width:56px;" title="Order">
      <span class="cat-key-badge" title="{{${_catEscAttr(p.key)}}}">${_catEscHtml(p.key)}</span>
      <input class="set-input" id="catP_label_${_catEscAttr(p.key)}" value="${_catEscAttr(p.label)}" style="flex:1;min-width:140px;">
      <div class="cat-row-actions">
        <button type="button" class="edit-btn" onclick="catAdminSaveParameter('${_catEscAttr(p.key)}')" title="Save">💾</button>
        <button type="button" class="edit-btn" onclick="catAdminDeleteParameter('${_catEscAttr(p.key)}')" title="Delete">🗑️</button>
      </div>
    </div>`).join('');
}
async function catAdminSaveParameter(key) {
  const orderRaw = _cat('catP_order_' + key).value;
  const sort_order = orderRaw === '' ? 0 : parseInt(orderRaw, 10);
  const label = _cat('catP_label_' + key).value.trim();
  if (!label) { catAdminMsg('Fill in the required label(s).', 'err'); return; }
  try {
    const res = await fetch('/api/parameters/' + encodeURIComponent(key), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, sort_order }),
    });
    if (!res.ok) return catAdminHandleError(res);
    catAdminMsg('Saved.', 'ok');
    catAdminRefreshCatalogs();
  } catch (e) { catAdminMsg('Something went wrong. Please try again.', 'err'); }
}
async function catAdminDeleteParameter(key) {
  const ok = await openConfirmModal(`Delete "${key}"? This action cannot be undone.`);
  if (!ok) return;
  try {
    const res = await fetch('/api/parameters/' + encodeURIComponent(key), { method: 'DELETE' });
    if (!res.ok) return catAdminHandleError(res);
    catAdminMsg('Deleted.', 'ok');
    catAdminRefreshCatalogs();
  } catch (e) { catAdminMsg('Something went wrong. Please try again.', 'err'); }
}
async function catAdminAddParameter() {
  const key = _cat('catPNewKey').value.trim();
  const label = _cat('catPNewLabel').value.trim();
  const orderRaw = _cat('catPNewOrder').value;
  const sort_order = orderRaw === '' ? undefined : parseInt(orderRaw, 10);
  if (!key || !/^[A-Za-z0-9._-]{1,40}$/.test(key)) { catAdminMsg('Enter a valid key (letters, numbers, dot, hyphen).', 'err'); return; }
  if (!label) { catAdminMsg('Fill in the required label(s).', 'err'); return; }
  try {
    const res = await fetch('/api/parameters', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, label, sort_order }),
    });
    if (!res.ok) return catAdminHandleError(res);
    _cat('catPNewKey').value = ''; _cat('catPNewLabel').value = ''; _cat('catPNewOrder').value = '';
    catAdminMsg('Added.', 'ok');
    catAdminRefreshCatalogs();
  } catch (e) { catAdminMsg('Something went wrong. Please try again.', 'err'); }
}
