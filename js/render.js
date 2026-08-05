// ════════════════════════════════════════════════
// RENDER — now backed by /api/commands (api-client.js + db-render-engine.js)
// instead of the hardcoded buildStatic()/buildCmds() in commands.js.
// ════════════════════════════════════════════════
async function render() {
  const src  = gv('src_ip'), dst = gv('dst_ip');
  const sp   = gv('src_port') || '0', dp = gv('dst_port') || '0';
  const proto = gv('proto') || '0', iface = gv('iface'), vsid = gv('vsid') || '0';
  const logFile = gv('f-log') || '/tmp/fw_export.txt';
  const ip = gv('ip'), port = gv('port'); // genéricos, sem direção (ver query-bar.js) — "host X and port Y"
  const { v, e, t: topicSel } = ST;
  const hasIPs = !!(src && dst);
  // Chaves do objeto `values` = os próprios nomes de placeholder {{token}} usados
  // nos comandos (src_ip/dst_ip/src_port/dst_port — renomeados de src/dst/sp/dp
  // para ficarem autoexplicativos na tela de administração de Parâmetros).
  const values = { src_ip: src, dst_ip: dst, src_port: sp, dst_port: dp, proto, iface, vsid, ip, port, logFile, FL };
  // Parâmetros novos cadastrados no modo administrador (js/catalog-admin.js) —
  // os 9 originais acima ficam hardcoded de propósito (os ~10 comandos
  // "avançados" com placeholder_resolver e as flags requires_ips/
  // requires_ip_port em render.js/db-render-engine.js leem essas variáveis
  // diretamente, não o objeto values; ver server/index.js:
  // parameterStructuralDependencyCount). Um parâmetro novo só participa da
  // substituição genérica {{key}} feita por resolveTokens() nos comandos
  // "simples" (sem placeholder_resolver). Desde a simplificação do catálogo,
  // `key` é sempre o próprio id do <input type="hidden"> — sem input_id/
  // default_value separados.
  (CATALOGS.parameters || []).forEach(p => {
    if (!(p.key in values)) values[p.key] = gv(p.key) || '';
  });

  const out = document.getElementById('out');

  let commands;
  try {
    commands = await fetchCommands();
  } catch (err) {
    console.error('Failed to load commands from API', err);
    out.innerHTML = `<div class="empty"><div class="empty-ico">⚠️</div><p>Failed to load commands from the server. Check whether the backend (server/index.js) is running.</p></div>`;
    return;
  }

  // Preferência "System commands" (sidebar, seção Options — ver js/settings.js)
  // — quando desligada, some com os comandos de referência (created_by='System',
  // is_system=true) e mostra só os criados/duplicados por usuários. Exceção:
  // um comando System que o usuário guardou em alguma pasta continua aparecendo
  // mesmo assim — "desligar System commands" é para reduzir ruído, não para
  // esconder algo que a própria pessoa organizou como importante.
  if (typeof SHOW_SYSTEM_COMMANDS !== 'undefined' && !SHOW_SYSTEM_COMMANDS) {
    commands = commands.filter(c => !c.is_system || (c.folder_ids && c.folder_ids.length));
  }

  // Filtro real por Vendor/Sistema (topo da hierarquia multi-fabricante ESTRITA)
  // — ao contrário de Versão/Ambiente (que só parametrizam qual combo-block é
  // gerado, ver resolveMultiSelection abaixo), Vendor/Sistema já nascem com
  // comportamento de filtro de verdade (mesma semântica de Tópico): seleção
  // vazia (padrão — sem item mestre 'all' na lista, ver js/state.js) não
  // restringe nada; um comando sem vendor/sistema cadastrado
  // (command.vendors/systems vazio) "aplica a todos" (mesma convenção de
  // command_versions/command_environments); caso contrário precisa bater com
  // pelo menos um item marcado.
  if (ST.vd.length) {
    commands = commands.filter(c => !c.vendors || !c.vendors.length || c.vendors.some(v => ST.vd.includes(v)));
  }
  if (ST.sys.length) {
    commands = commands.filter(c => !c.systems || !c.systems.length || c.systems.some(s => ST.sys.includes(s)));
  }

  // Campo de busca unificado (src:/dst:/dport:/... — ver query-bar.js): só oferece o chip
  // "Adicionar filtro" de um campo se algum comando exibido para o Tópico/Ambiente atual
  // realmente usa aquele parâmetro.
  if (typeof computeUsedQueryTokens === 'function') {
    updateQueryChipsVisibility(computeUsedQueryTokens(commands, topicSel, e));
  }

  // Resolve a seleção de Versão/Ambiente numa lista de valores concretos a gerar. Nada
  // marcado (padrão — sem item mestre 'all' na lista, ver js/state.js) mantém o
  // comportamento único de sempre: gera com o padrão (R82 / Standalone), expandindo os
  // diffs de versão / avisando sobre a sintaxe por ambiente — sem explodir em vários
  // blocos. Um subconjunto específico marcado (mesmo que sejam todos os itens,
  // marcados um a um ou pelo botão "All" do rodapé) empilha um bloco completo de
  // comandos por item marcado (produto cartesiano Versão × Ambiente, com teto de segurança).
  function resolveMultiSelection(sel, allKeysOrdered, defaultVal) {
    if (sel.length === 0) return { values: [defaultVal], isAllMode: true };
    const values = allKeysOrdered.filter(k => sel.includes(k));
    return { values, isAllMode: false };
  }
  const versionSel = resolveMultiSelection(v, VERSION_KEYS, FALLBACK_VERSION);
  const envSel = resolveMultiSelection(e, ENV_KEYS, FALLBACK_ENV);
  AUTO_EXPAND_DIFFS = versionSel.isAllMode;

  const MAX_COMBOS = 8;
  let combos = [];
  for (const cv of versionSel.values) {
    for (const ce of envSel.values) combos.push({ v: cv, e: ce });
  }
  let combosTruncatedNote = '';
  if (combos.length > MAX_COMBOS) {
    combos = combos.slice(0, MAX_COMBOS);
    combosTruncatedNote = `<div class="env-note" style="border-color:rgba(251,191,36,.3);background:rgba(251,191,36,.06);color:var(--yellow);">⚠️ <span>Too many Version × Environment combinations checked — showing the first ${MAX_COMBOS}. Narrow the selection to see the rest.</span></div>`;
  }

  // Rótulo de Ambiente vem do catálogo administrável (js/catalogs.js), não
  // mais de mapas fixos aqui — assim um ambiente novo cadastrado aparece
  // corretamente em qualquer lugar sem editar este arquivo.
  function envLabel(key) {
    const env = (CATALOGS.environments || []).find(x => x.key === key);
    return env ? env.label : key;
  }
  const show = tp => VIEW_FOLDERS_HOME || VIEW_FOLDER_ID != null || topicSel.length === 0 || topicSel.includes(tp);

  const envNotesText = {
    all: 'All (all environments): commands are generated using the <strong>Standalone</strong> default. Switch the Environment to Cluster HA / VSX / Maestro / MDS when you need the specific syntax (<code>vsenv</code>, <code>asg_cmd</code>, <code>mdsenv</code>, etc.).',
    cluster: 'Cluster: run on <strong>both members</strong>. Check the active member with <code>cphaprob stat</code>.',
    vsx: `VSX: enter the VS with <code>vsenv ${vsid}</code> before running any command. <code>vsx stat -v</code> lists all IDs.`,
    maestro: 'Maestro: use <code>asg_cmd "..."</code> to broadcast to all SGMs. The <code>g_*</code> prefix aggregates output from all of them.',
    mds: 'MDS: use <code>mdsenv &lt;CMA-NAME&gt;</code> to enter the domain. <code>mdsstat</code> lists all CMAs.',
    gaia: 'Gaia Clish: commands run directly in the Gaia restricted shell (prompt <code>[Gaia]&gt;</code>), without entering Expert mode. Categories with no Clish equivalent (capture, kernel debug, SecureXL, tables, licensing, policy fetch) show a note indicating you need to type <code>expert</code> to access bash.',
    standalone: '',
  };

  // Um bloco completo de comandos por combinação Versão × Ambiente selecionada (normalmente 1).
  const comboBlocks = combos.map(combo => {
  const cv = combo.v, ce = combo.e;
  // Prefixo de chave dá identidade estável à seção de cada Tópico mesmo quando o mesmo
  // Tópico se repete em blocos de Versão/Ambiente empilhados (evita que o recolher/expandir
  // de um bloco afete o mesmo Tópico em outro bloco).
  const kp = `${cv}__${ce}__`;

  const envNote = envNotesText[ce] ? `<div class="env-note">ℹ️ <span>${envNotesText[ce]}</span></div>` : '';

  // Uma seção por Tópico do catálogo (js/catalogs.js) — antes eram 18 chamadas
  // fixas aqui; agora um tópico novo cadastrado no modo administrador já aparece
  // automaticamente, sem editar este arquivo. O tópico protegido 'environment'
  // fica de fora (tratado à parte, ver buildEnvSections abaixo). Ordenado
  // alfabeticamente pelo título da seção (não mais por sort_order do catálogo)
  // — mesmo critério (stripLeadingSymbols + localeCompare) já usado nos
  // dropdowns de filtro em js/state.js. Tópicos não têm mais ícone próprio
  // (removido do cadastro a pedido do usuário) — 2º arg '' em vez de tp.icon.
  const topicsSorted = (CATALOGS.topics || []).filter(tp => !tp.is_protected).slice().sort((a, b) =>
    stripLeadingSymbols(a.label).localeCompare(
      stripLeadingSymbols(b.label), undefined, { sensitivity: 'base' }
    )
  );
  // Monta as seções (Ambiente + Tópicos) para um subconjunto de `commands` —
  // extraído para função porque o modo "Created by" repete isso uma vez por
  // autor (ver mais abaixo), com `keyPrefix` distinto para manter o
  // recolher/expandir de cada seção independente entre autores.
  function buildSections(rows, keyPrefix) {
    const sections = [];
    const envCards = buildEnvCards(rows, ce, values);
    if (envCards.length) sections.push(section('🏗️', `Environment: ${envLabel(ce)}`, envCards, keyPrefix + 'environment'));
    topicsSorted.forEach(tp => {
      if (show(tp.key)) {
        sections.push(buildTopicSection(rows, tp.key, '', tp.label, values, hasIPs, keyPrefix + tp.key));
      }
    });
    return sections.join('');
  }

  // Rótulo do bloco Versão/Ambiente: quando Versão/Ambiente = All, a combinação
  // usada para gerar os comandos é só um valor padrão de referência (a maioria
  // dos comandos não muda entre versões/ambientes — ver command_versions vazio
  // no schema) — então o rótulo deve dizer "All", não o valor concreto
  // escolhido internamente (ex.: "R82"), para não sugerir um filtro que não existe.
  const cvLabel = versionSel.isAllMode ? 'All' : cv;
  const ceLabel = envSel.isAllMode ? 'All' : envLabel(ce);

  // "Created by": um agrupamento recolhível por autor (created_by), cada um
  // com as mesmas seções de Ambiente/Tópico de sempre, mas só com os comandos
  // daquele autor. Autores em ordem alfabética (comparação sem caixa); "—"
  // agrupa comandos sem created_by (registros antigos/sem autoria).
  if (GROUP_BY === 'creator') {
    const creators = [...new Set(commands.map(c => c.created_by || '—'))].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
    const creatorGroups = creators.map(creator => {
      const subset = commands.filter(c => (c.created_by || '—') === creator);
      // Chave da seção precisa ser um identificador "seguro" (sem \, ', etc.) —
      // usernames vêm no formato "DOMÍNIO\usuario" (ver NTLM em server/index.js),
      // e um backslash dentro do onclick="toggleSection('...')" gerado por
      // collapsibleGroup() quebraria a string JS (\u, \r etc. são sequências de
      // escape válidas). O nome de exibição continua o original (escAttr(creator)).
      const creatorKey = creator.replace(/[^a-zA-Z0-9_-]/g, '_');
      const body = buildSections(subset, `${kp}${creatorKey}__`);
      const cardCount = (body.match(/<div class="card"/g) || []).length;
      if (!cardCount) return '';
      return collapsibleGroup(`${cv}__${ce}__${creatorKey}`, `👤 <strong>${escAttr(creator)}</strong> <span class="sec-count">${cardCount}</span>`, body, 'section-creator');
    }).join('');
    if (!creatorGroups) return '';
    const comboHeader = combos.length > 1
      ? `<div class="combo-header">🔀 <strong>${cvLabel}</strong> / <strong>${ceLabel}</strong></div>`
      : '';
    return comboHeader + envNote + creatorGroups;
  }

  // "My folders": mesmo padrão do "Created by" acima, mas agrupando pelas
  // PASTAS do próprio usuário (command.folder_ids, ver server/index.js:
  // shapeCommand()) em vez de quem criou. Substituiu o antigo "User favorites"
  // (agrupamento cross-user por quem favoritou) — pastas são privadas, então
  // aqui só existe a perspectiva de quem está olhando a tela. Um comando
  // guardado em várias pastas aparece em mais de uma seção (uma por pasta);
  // comandos fora de qualquer pasta não aparecem em nenhum grupo (não existe
  // seção "sem pasta" — diferente do "—" do Created by).
  if (GROUP_BY === 'my-folders') {
    const folderNameById = new Map((typeof FOLDERS !== 'undefined' ? FOLDERS : []).map(f => [f.id, f.name]));
    const folderIdsInUse = [...new Set(commands.flatMap(c => c.folder_ids || []))]
      .filter(id => folderNameById.has(id))
      .sort((a, b) => folderNameById.get(a).localeCompare(folderNameById.get(b), undefined, { sensitivity: 'base' }));
    const folderGroups = folderIdsInUse.map(folderId => {
      const subset = commands.filter(c => (c.folder_ids || []).includes(folderId));
      const body = buildSections(subset, `${kp}folder${folderId}__`);
      const cardCount = (body.match(/<div class="card"/g) || []).length;
      if (!cardCount) return '';
      const folderName = folderNameById.get(folderId);
      return collapsibleGroup(`${cv}__${ce}__folder${folderId}`, `${folderIcon(true, 13)} <strong>${escAttr(folderName)}</strong> <span class="sec-count">${cardCount}</span>`, body, 'section-creator');
    }).join('');
    if (!folderGroups) return '';
    const comboHeader = combos.length > 1
      ? `<div class="combo-header">🔀 <strong>${cvLabel}</strong> / <strong>${ceLabel}</strong></div>`
      : '';
    return comboHeader + envNote + folderGroups;
  }

  const bodyHtml = envNote + buildSections(commands, kp);

  // "Agrupar por Versão": embrulha o bloco inteiro da combinação num agrupamento recolhível
  // próprio (rotulado com Versão/Ambiente), com as seções de Tópico aninhadas dentro. Sempre
  // exibido nesse modo — mesmo com uma única combinação — para dar o mesmo resultado visual
  // de agrupamento que o usuário teria com várias Versões marcadas.
  if (GROUP_BY === 'version') {
    const cardCount = (bodyHtml.match(/<div class="card"/g) || []).length;
    if (!cardCount) return '';
    const label = `<strong>${cvLabel}</strong> / <strong>${ceLabel}</strong>`;
    return collapsibleGroup(`${cv}__${ce}`, `🔀 ${label} <span class="sec-count">${cardCount}</span>`, bodyHtml, 'section-version');
  }

  const comboHeader = combos.length > 1
    ? `<div class="combo-header">🔀 <strong>${cvLabel}</strong> / <strong>${ceLabel}</strong></div>`
    : '';
  return comboHeader + bodyHtml;
  }); // fim do map de combos

  out.innerHTML = [combosTruncatedNote, ...comboBlocks].join('');
  if (VIEW_FOLDER_ID != null) applyFolderFilter();
  else if (VIEW_FOLDERS_HOME) applyAnyFolderFilter();
  applySearchFilter();
}

render().catch(err => console.error('render() failed', err));
