// ════════════════════════════════════════════════
// DB RENDER ENGINE — turns /api/commands rows (already language-resolved by
// the server: name/desc/about/tags/diffs text is in the requested language)
// into the same card()/section() HTML terminal-renderer.js has always produced.
//
// Two rendering paths:
//   1) ~24 plain commands (placeholder_resolver = null): straightforward
//      {{token}} substitution on the DB row's lines/raw_template/name/desc.
//   2) 10 "advanced" commands (placeholder_resolver set): dispatched to
//      RESOLVERS[id](row, values), which calls the exact same net-utils.js
//      helpers (buildFwMonitorFilters, combinedAddrRegex, tcpdumpClause,
//      expandAddrDiscrete, ...) the pre-migration commands.js used, so
//      list/range/CIDR-aware filter generation is preserved exactly.
//
// Scope note: the DB migration (server/seed.js) only captured the
// "standalone environment" default rendering — the per-environment dynamic
// wrapping commands.js used to do (cluster A/B duplication, vsx `vsenv`
// prefix, maestro `asg_cmd`, mds `mdsenv`) is NOT reproduced here for the
// ~24 plain commands or for the 10 resolvers; only the 5 dedicated
// "Ambiente: X" cards (topic='environment') still vary by environment.
// ════════════════════════════════════════════════

// Same {{key}} token syntax used throughout the templates. When a token has
// no value yet (nothing typed in the query bar / command parameter field),
// instead of collapsing to an empty string (which reads as a broken/truncated
// command, e.g. "cprinstall get "), fall back to a friendly "<Label>" hint —
// looked up from the parameters catalog so it matches whatever the field is
// called there (falls back to the raw key if the catalog hasn't loaded yet).
function resolveTokens(str, values) {
  if (str === null || str === undefined) return str;
  return String(str).replace(/\{\{(\w+)\}\}/g, (m, key) => {
    const v = values[key];
    if (v !== undefined && v !== null && v !== '') return v;
    const catalogParams = (typeof CATALOGS !== 'undefined' && CATALOGS.parameters) || [];
    const param = catalogParams.find(p => p.key === key);
    return `<${param ? param.label : key}>`;
  });
}

// Wraps a dynamic (user-supplied, or its "<Label>" hint) value in the
// VAR_OPEN/VAR_CLOSE sentinel (declared in js/syntax-highlight.js, loaded
// before this file) so safeHL() renders it as a distinct "variable" (k-var)
// token instead of leaving it uncoloured like the rest of the literal
// command syntax. No-op for empty/nullish values — nothing to highlight.
function markVar(v) {
  return (v === undefined || v === null || v === '') ? v : (VAR_OPEN + v + VAR_CLOSE);
}

// Same as resolveTokens(), but for text that will be displayed as a
// highlighted command line (safeHL) rather than copied to the clipboard or
// shown as plain UI text (name/desc/about/raw) — the resolved value (or its
// "<Label>" hint, when the field is still empty) is wrapped with markVar() so
// only the actual variable part of the line gets coloured, never the fixed
// command syntax around it.
function resolveTokensMarked(str, values) {
  if (str === null || str === undefined) return str;
  return String(str).replace(/\{\{(\w+)\}\}/g, (m, key) => {
    const v = values[key];
    if (v !== undefined && v !== null && v !== '') return markVar(v);
    const catalogParams = (typeof CATALOGS !== 'undefined' && CATALOGS.parameters) || [];
    const param = catalogParams.find(p => p.key === key);
    return markVar(`<${param ? param.label : key}>`);
  });
}

// DB line {line_type, prompt, content, supports_export} -> termRender()/card() line
// shape: {p, c} for a command line, {type, c} for an annotation line.
//
// Redirecionamento genérico "Exportar para arquivo": linhas marcadas com
// supports_export=1 (ver server/index.js shapeLine + schema.sql) recebem
// ' > <logFile>' anexado automaticamente quando o toggle da sidebar (FL.log) está
// ligado — sem precisar de um resolver dedicado nem de tokens manuais no texto do
// comando. Os 4 comandos com placeholder_resolver que já gerenciam seu próprio
// redirecionamento (fw monitor, tcpdump, zdebug, fw log/logexport) não passam por
// aqui com supports_export=1, então não há conflito/duplicação.
function dbLineToTerm(line, values) {
  if (line.line_type === 'cmd') {
    let content = resolveTokensMarked(line.content, values);
    if (line.supports_export && values.FL && values.FL.log && values.logFile) {
      content += ` > ${markVar(values.logFile)}`;
    }
    return { p: resolveTokens(line.prompt, values), c: content };
  }
  if (line.line_type === 'image') {
    // c = nome exibido no lugar do comando; imageData = data URI base64
    // (command_lines.image_data) mostrada em tamanho maior ao clicar (ver
    // openImageLightbox em terminal-renderer.js).
    return { type: 'image', c: resolveTokens(line.content, values), imageData: line.image_data || null };
  }
  // Linhas de anotação (note/warn/info/ok) não passam por safeHL — ver
  // termRender() em terminal-renderer.js — então usam a resolução "limpa"
  // (sem marcadores de variável, que apareceriam como caracteres de controle
  // soltos no texto corrido).
  return { type: line.line_type, c: resolveTokens(line.content, values) };
}
function dbLinesToTerm(lines, values) {
  return (lines || []).map(l => dbLineToTerm(l, values));
}
function dbDiffsToTerm(diffs, values) {
  return (diffs || []).map(d => ({ v: d.version, n: d.note || '', l: dbLinesToTerm(d.lines, values) }));
}

// For a DB line whose content contains a literal substring (still holding
// its own {{token}} placeholders) that needs to be swapped for a computed
// value (e.g. a full -F filter string), replace BEFORE token resolution so
// the substring can be matched literally, then resolve whatever tokens remain.
function buildLineWithOverride(line, values, overridePairs) {
  let content = line.content || '';
  (overridePairs || []).forEach(([pattern, replacement]) => {
    content = content.split(pattern).join(replacement);
  });
  if (line.line_type === 'cmd') {
    content = resolveTokensMarked(content, values);
    return { p: resolveTokens(line.prompt, values), c: content };
  }
  content = resolveTokens(content, values);
  return { type: line.line_type, c: content };
}

const RANGE_TOO_LARGE_NOTE = 'A range that is too large (more than 64 /24 blocks) was skipped in the filter — narrow the range or search in parts.';

// Raw (copy-button) text for commands whose "empty" state (IPs not filled, for
// requires_ips resolvers; or IP/Porta not filled, for requires_ip_port plain
// commands like tcpdumpipport) should show a clean literal command in the
// original app (not the template with blank tokens, which would produce
// broken syntax, e.g. "tcpdump -nni any host  and port ").
const EMPTY_RAW = {
  fwmonitor: 'fw monitor',
  tcpdump: 'tcpdump',
  zdebug: 'fw ctl zdebug + drop',
  fwlog: 'fw log -n',
  fetchlogs: 'fw fetchlogs',
  fwaccelconns: 'fwaccel conns',
  tcpdumpipport: 'tcpdump',
};

// kdebug is the one command whose "diffs" block is shown regardless of
// whether IPs are filled (S.kdDiffs in the pre-migration commands.js was
// always attached, unlike fwmonitor/zdebug which drop diffs when empty).
const ALWAYS_SHOW_DIFFS_WHEN_EMPTY = new Set(['kdebug']);

// ════════════════════════════════════════════════
// RESOLVERS — one per placeholder_resolver value. Each receives the API row
// (already language-resolved; row.lines.default/row.diffs still contain
// {{token}} placeholders) and the current filter values, and returns
// { lines, diffs, raw } in the exact shape card() expects.
// ════════════════════════════════════════════════
const RESOLVERS = {};

RESOLVERS.fwmonitor = function (row, values) {
  const { src_ip: src, dst_ip: dst, src_port: sp, dst_port: dp, proto, iface } = values;
  const fwmonFilters = buildFwMonitorFilters(src, dst, sp, dp, proto);
  const ifF = iface ? ` -i ${markVar(iface)}` : '';
  const fwmonCmd = `fw monitor${ifF} ${markVar(fwmonFilters.flagsStr)}`;
  const staticNote = (row.lines.default || []).find(l => l.line_type === 'note');
  const lines = [
    { p: '[Expert@FW]#', c: fwmonCmd },
    staticNote ? { type: 'note', c: resolveTokens(staticNote.content, values) } : null,
    ...fwmonFilters.notes.map(n => ({ type: 'warn', c: n })),
  ].filter(Boolean);

  const FLAG_PATTERN = '-F "{{src_ip}},{{src_port}},{{dst_ip}},{{dst_port}},{{proto}}" -F "{{dst_ip}},{{dst_port}},{{src_ip}},{{src_port}},{{proto}}"';
  const diffs = (row.diffs || []).map(d => ({
    v: d.version, n: d.note || '',
    l: d.lines.map(l => {
      if (l.line_type === 'cmd' && l.content.includes(FLAG_PATTERN)) {
        const c = resolveTokensMarked(l.content.split(FLAG_PATTERN).join(markVar(fwmonFilters.flagsStr)), values);
        return { p: resolveTokens(l.prompt, values), c };
      }
      return dbLineToTerm(l, values);
    }),
  }));

  return { lines, diffs, raw: fwmonCmd };
};

RESOLVERS.tcpdump = function (row, values) {
  const { src_ip: src, dst_ip: dst, src_port: sp, dst_port: dp, proto, iface } = values;
  const srcP = parseAddr(src), dstP = parseAddr(dst);
  const spP = parsePorts(sp), dpP = parsePorts(dp);
  const tcpProto = proto === '6' ? ' and tcp' : proto === '17' ? ' and udp' : proto === '1' ? ' and icmp' : '';
  const tcpIf = iface ? `-i ${markVar(iface)}` : '-i any';
  const srcClauseObj = tcpdumpClause(srcP);
  const dstClauseObj = tcpdumpClause(dstP);
  const tcpNotesArr = [...srcClauseObj.notes, ...dstClauseObj.notes];
  const spActive = spP.items.filter(p => p && p !== '0');
  const dpActive = dpP.items.filter(p => p && p !== '0');
  const spClause = spActive.length ? ` and (${spActive.map(p => `src port ${p}`).join(' or ')})` : '';
  const dpClause = dpActive.length ? ` and (${dpActive.map(p => `dst port ${p}`).join(' or ')})` : '';
  const tcpFlt = `"${srcClauseObj.clause || `host ${src}`} and ${dstClauseObj.clause || `host ${dst}`}${tcpProto}${spClause}${dpClause}"`;
  const tcpCmd = `tcpdump ${tcpIf} -nn -s 0 ${markVar(tcpFlt)}`;
  const staticNote = (row.lines.default || []).find(l => l.line_type === 'note');
  const lines = [
    { p: '[Expert@FW]#', c: tcpCmd },
    staticNote ? { type: 'note', c: resolveTokens(staticNote.content, values) } : null,
    ...tcpNotesArr.map(n => ({ type: 'warn', c: n })),
  ].filter(Boolean);
  return { lines, diffs: [], raw: tcpCmd };
};

RESOLVERS.zdebug = function (row, values) {
  const { src_ip: src, dst_ip: dst, FL, logFile } = values;
  const srcP = parseAddr(src), dstP = parseAddr(dst);
  const orRegex = combinedAddrRegex([srcP, dstP]);
  const orRegexStr = orRegex.regex || `${src}|${dst}`;
  const orRegexNotes = orRegex.rangeTooLarge ? [RANGE_TOO_LARGE_NOTE] : [];
  const zdCmd = `fw ctl zdebug + drop | grep -E "${markVar(orRegexStr)}"${FL.log ? ' > ' + markVar(logFile) : ''}`;
  const warnLine = (row.lines.default || []).find(l => l.line_type === 'warn');
  const lines = [
    { p: '[Expert@FW]#', c: zdCmd },
    warnLine ? { type: 'warn', c: resolveTokens(warnLine.content, values) } : null,
    ...orRegexNotes.map(n => ({ type: 'warn', c: n })),
  ].filter(Boolean);

  const PATTERN = 'grep -E "{{src_ip}}|{{dst_ip}}"';
  const REPLACEMENT = `grep -E "${markVar(orRegexStr)}"`;
  const diffs = (row.diffs || []).map(d => ({
    v: d.version, n: d.note || '',
    l: d.lines.map(l => {
      if (l.line_type === 'cmd' && l.content.includes(PATTERN)) {
        return { p: resolveTokens(l.prompt, values), c: resolveTokensMarked(l.content.split(PATTERN).join(REPLACEMENT), values) };
      }
      return dbLineToTerm(l, values);
    }),
  }));

  return { lines, diffs, raw: zdCmd };
};

RESOLVERS.fwlog = function (row, values) {
  const { src_ip: src, dst_ip: dst, FL, logFile } = values;
  const srcP = parseAddr(src), dstP = parseAddr(dst);
  const orRegex = combinedAddrRegex([srcP, dstP]);
  const orRegexStr = orRegex.regex || `${src}|${dst}`;
  const orRegexNotes = orRegex.rangeTooLarge ? [RANGE_TOO_LARGE_NOTE] : [];
  const logRedir = FL.log ? ` > ${markVar(logFile)}` : '';
  const fwlogUsesFallback = srcP.isMulti || dstP.isMulti;
  const fwlogCmd = fwlogUsesFallback
    ? `fw log -n | grep -E "${markVar(orRegexStr)}"${logRedir}`
    : `fw log -n -s ${markVar(src)} -d ${markVar(dst)}${logRedir}`;
  const fwlogCmdDrop = fwlogUsesFallback
    ? `fw log -n -c drop | grep -E "${markVar(orRegexStr)}"${logRedir}`
    : `fw log -n -s ${markVar(src)} -d ${markVar(dst)} -c drop${logRedir}`;
  const staticNote = (row.lines.default || []).find(l => l.line_type === 'note');
  const fallbackNote = fwlogUsesFallback
    ? [
        { type: 'info', c: 'SRC/DST with a list or range: -s/-d only accept a single exact IP, so we filter with grep -E instead.' },
        ...orRegexNotes.map(n => ({ type: 'warn', c: n })),
      ]
    : [];
  const lines = [
    { p: '[Expert@FW]#', c: fwlogCmd },
    { p: '[Expert@FW]#', c: fwlogCmdDrop },
    staticNote ? { type: 'note', c: resolveTokens(staticNote.content, values) } : null,
    ...fallbackNote,
  ].filter(Boolean);
  return { lines, diffs: [], raw: fwlogCmd };
};

RESOLVERS.logexport = function (row, values) {
  const { src_ip: src, dst_ip: dst, src_port: sp, dst_port: dp, FL, logFile } = values;
  const srcP = parseAddr(src), dstP = parseAddr(dst);
  const spP = parsePorts(sp), dpP = parsePorts(dp);
  const isMultiFilter = srcP.isMulti || dstP.isMulti || spP.isMulti || dpP.isMulti;
  const expOut = FL.log ? logFile : '/tmp/fw_export.txt';
  const dbLines = row.lines.default || [];
  const lines = dbLines.map(l => buildLineWithOverride(l, values, [['/tmp/fw_export.txt', markVar(expOut)]]));
  if (isMultiFilter) {
    lines.push({ type: 'info', c: 'logexport filters a single exact IP at a time in -s/-e — for a list/range, export once without a filter and trim the CSV, or repeat per IP.' });
  }
  return { lines, diffs: [], raw: resolveTokens(row.raw_template, values) };
};

RESOLVERS.fetchlogs = function (row, values) {
  const { src_ip: src } = values;
  const srcP = parseAddr(src);
  const fetchX = expandAddrDiscrete(srcP, 8, 5);
  const fetchList = fetchX.list.length ? fetchX.list : (fetchX.skippedRange ? [] : [src]);
  const staticNote = (row.lines.default || []).find(l => l.line_type === 'note');
  const lines = [
    ...(fetchList.length
      ? fetchList.map(ip => ({ p: '[Expert@SMS]#', c: `fw fetchlogs ${markVar(ip)}` }))
      : [{ type: 'info', c: 'Fill in a valid gateway IP, or a small list/range (up to 8 addresses), to generate the fw fetchlogs command(s).' }]),
    ...(fetchList.length && staticNote ? [{ type: 'note', c: resolveTokens(staticNote.content, values) }] : []),
    ...(fetchX.skippedRange ? [{ type: 'warn', c: 'Range too large to enumerate automatically (limit of 8 addresses) — repeat fw fetchlogs manually per IP.' }] : []),
    ...(fetchX.truncated ? [{ type: 'warn', c: `Showing the first ${fetchList.length} IPs — repeat the command for the rest.` }] : []),
  ];
  return { lines, diffs: [], raw: resolveTokens(row.raw_template, values) };
};

RESOLVERS.conntable = function (row, values) {
  const { src_ip: src, dst_ip: dst } = values;
  const srcP = parseAddr(src), dstP = parseAddr(dst);
  const srcRes = combinedAddrRegex([srcP]);
  const dstRes = combinedAddrRegex([dstP]);
  const srcTerm = srcRes.regex || src;
  const dstTerm = dstRes.regex || dst;
  const notes = (srcRes.rangeTooLarge || dstRes.rangeTooLarge) ? [{ type: 'warn', c: RANGE_TOO_LARGE_NOTE }] : [];
  const subValues = Object.assign({}, values, { src_ip: srcTerm, dst_ip: dstTerm });
  const lines = [...dbLinesToTerm(row.lines.default, subValues), ...notes];
  return { lines, diffs: [], raw: resolveTokens(row.raw_template, values) };
};

RESOLVERS.nattable = function (row, values) {
  const { src_ip: src, dst_ip: dst } = values;
  const srcP = parseAddr(src), dstP = parseAddr(dst);
  const srcRes = combinedAddrRegex([srcP]);
  const dstRes = combinedAddrRegex([dstP]);
  const srcTerm = srcRes.regex || src;
  const dstTerm = dstRes.regex || dst;
  const notes = (srcRes.rangeTooLarge || dstRes.rangeTooLarge) ? [{ type: 'warn', c: RANGE_TOO_LARGE_NOTE }] : [];
  const subValues = Object.assign({}, values, { src_ip: srcTerm, dst_ip: dstTerm });
  const lines = [...dbLinesToTerm(row.lines.default, subValues), ...notes];
  return { lines, diffs: [], raw: resolveTokens(row.raw_template, values) };
};

RESOLVERS.routespecific = function (row, values) {
  const { dst_ip: dst } = values;
  const dstP = parseAddr(dst);
  const routeX = expandAddrDiscrete(dstP, 8, 5);
  const routeList = routeX.list.length ? routeX.list : (routeX.skippedRange ? [] : [dst]);
  const routeNotes = [];
  if (routeX.skippedRange) routeNotes.push({ type: 'warn', c: 'Range too large to enumerate automatically (limit of 8 addresses) — repeat ip route get manually per IP.' });
  if (routeX.truncated) routeNotes.push({ type: 'warn', c: `Showing the first ${routeList.length} IPs — repeat the command for the rest.` });
  const routeNetstatGrep = routeList.length ? `netstat -rn | grep ${markVar(routeList[0].split('.').slice(0, 3).join('.'))}` : 'netstat -rn';
  const dbLines = row.lines.default || [];
  const netstatNote = dbLines.find(l => l.line_type === 'note' && /netstat/.test(l.content || ''));
  const gaiaLines = dbLines.filter(l => l.prompt === '[Gaia]>');
  const lines = [
    ...(routeList.length
      ? routeList.flatMap(ip => [{ p: '[Expert@FW]#', c: `ip route get ${markVar(ip)}` }, { p: '[Expert@FW]#', c: `arp -n | grep ${markVar(ip)}` }])
      : [{ type: 'info', c: 'Fill in a valid destination IP, or a small list/range (up to 8 addresses), to generate the ip route get command(s).' }]),
    { p: '[Expert@FW]#', c: routeNetstatGrep },
    netstatNote ? { type: 'note', c: resolveTokens(netstatNote.content, values) } : null,
    ...gaiaLines.map(l => ({ p: l.prompt, c: resolveTokensMarked(l.content, values) })),
    ...routeNotes,
  ].filter(Boolean);
  return { lines, diffs: [], raw: resolveTokens(row.raw_template, values) };
};

RESOLVERS.fwaccelconns = function (row, values) {
  const { src_ip: src, dst_ip: dst } = values;
  const srcP = parseAddr(src), dstP = parseAddr(dst);
  const orRes = combinedAddrRegex([srcP, dstP]);
  const orRegexStr = orRes.regex || `${src}|${dst}`;
  const notes = orRes.rangeTooLarge ? [{ type: 'warn', c: RANGE_TOO_LARGE_NOTE }] : [];
  const fwaccelCmd = `fwaccel conns | grep -E "${markVar(orRegexStr)}"`;
  const staticNote = (row.lines.default || []).find(l => l.line_type === 'note');
  const lines = [
    { p: '[Expert@FW]#', c: fwaccelCmd },
    staticNote ? { type: 'note', c: resolveTokens(staticNote.content, values) } : null,
    ...notes,
  ].filter(Boolean);
  return { lines, diffs: [], raw: fwaccelCmd };
};

// ════════════════════════════════════════════════
// Row -> card() HTML
// ════════════════════════════════════════════════
function mapAbout(about, values) {
  if (!about) return null;
  return {
    icon: about.icon,
    purpose: resolveTokens(about.purpose, values),
    when: resolveTokens(about.when, values),
    obs: resolveTokens(about.obs, values),
  };
}

// Bloco "placeholder" compartilhado por requires_ips (SRC/DST vazios) e requires_ip_port
// (IP/Porta genéricos vazios) — mesma lógica de fallback (nome/desc/raw "vazio"), só muda
// a condição que dispara.
function buildEmptyStateCard(row, values, tags, about) {
  const emptyLines = (row.lines && row.lines.empty) || [];
  if (!emptyLines.length) return null; // e.g. conntable/nattable/routespecific: card omitido inteiramente
  const name = (row.name_empty !== null && row.name_empty !== undefined && row.name_empty !== '') ? row.name_empty : row.name;
  const desc = (row.desc_empty !== null && row.desc_empty !== undefined && row.desc_empty !== '') ? row.desc_empty : row.desc;
  const raw = Object.prototype.hasOwnProperty.call(EMPTY_RAW, row.id) ? EMPTY_RAW[row.id] : resolveTokens(row.raw_template, values);
  const diffs = (ALWAYS_SHOW_DIFFS_WHEN_EMPTY.has(row.id) && row.diffs && row.diffs.length) ? dbDiffsToTerm(row.diffs, values) : undefined;
  return card({
    id: row.id,
    name: resolveTokens(name, values),
    desc: resolveTokens(desc, values),
    about, tags,
    lines: dbLinesToTerm(emptyLines, values),
    diffs, raw,
    folderIds: row.folder_ids,
    createdBy: row.created_by, modifiedBy: row.modified_by, updatedAt: row.updated_at, isSystem: row.is_system,
    vendors: row.vendors, systems: row.systems, versions: row.versions, environments: row.environments,
  });
}

function buildCardHtmlForRow(row, values, hasIPs) {
  const tags = (row.tags || []).map(tg => [tg.css_class, tg.label]);
  const about = mapAbout(row.about, values);

  if (row.requires_ips && !hasIPs) {
    return buildEmptyStateCard(row, values, tags, about);
  }

  // IP/Porta genéricos (sem direção — ver query-bar.js): usados por comandos como
  // "host <IP> and port <PORT>" que não distinguem origem/destino, ao contrário de
  // SRC/DST. Gatilho independente de hasIPs, lido direto de values.ip/values.port.
  const hasIpPort = !!(values.ip && values.port);
  if (row.requires_ip_port && !hasIpPort) {
    return buildEmptyStateCard(row, values, tags, about);
  }

  let lines, diffs, raw;
  const resolver = row.placeholder_resolver && RESOLVERS[row.placeholder_resolver];
  if (resolver && hasIPs) {
    const res = resolver(row, values);
    lines = res.lines;
    diffs = (res.diffs && res.diffs.length) ? res.diffs : undefined;
    raw = res.raw;
  } else {
    lines = dbLinesToTerm(row.lines.default, values);
    diffs = (row.diffs && row.diffs.length) ? dbDiffsToTerm(row.diffs, values) : undefined;
    raw = resolveTokens(row.raw_template, values);
  }

  return card({
    id: row.id,
    name: resolveTokens(row.name, values),
    desc: resolveTokens(row.desc, values),
    about, tags, lines, diffs, raw,
    folderIds: row.folder_ids,
    createdBy: row.created_by, modifiedBy: row.modified_by, updatedAt: row.updated_at, isSystem: row.is_system,
    vendors: row.vendors, systems: row.systems, versions: row.versions, environments: row.environments,
  });
}

// The 5 "🏗️ Ambiente: X" cards — pinned via row.environments to one specific
// environment each (topic='environment'), shown at the top of a combo block
// when that combo's environment matches.
function buildEnvCards(rows, ce, values) {
  return rows
    .filter(r => (r.topics || [r.topic]).includes('environment') && Array.isArray(r.environments) && r.environments.includes(ce))
    .map(r => buildCardHtmlForRow(r, values, true))
    .filter(Boolean);
}

// One topic section (icon + title + its cards), mirroring render.js's per-topic blocks.
// `key` (optional) gives the collapsible section a stable identity — see section() in
// terminal-renderer.js — needed so collapse state doesn't collide across stacked
// Versão/Ambiente combo blocks that repeat the same topic.
function buildTopicSection(rows, topic, icon, title, values, hasIPs, key) {
  // Um comando pode pertencer a mais de um Tópico (row.topics) — aparece em cada
  // seção correspondente. `row.topic` (singular) é o fallback para linhas antigas
  // que por algum motivo não tragam o array `topics` do backend.
  const cards = rows
    .filter(r => (r.topics || [r.topic]).includes(topic))
    .map(r => buildCardHtmlForRow(r, values, hasIPs))
    .filter(Boolean);
  return section(icon, title, cards, key);
}

// Envolve cada card já pronto num ".folder-card-row" com uma alça de
// arrastar (⠿, ver _fcArmDrag em js/folders.js) — só usado dentro de uma
// pasta do PRÓPRIO usuário (reordenar a pasta de outra pessoa não é
// permitido pelo backend, ver PUT /api/folders/:id/reorder). `data-folder-id`
// na própria row (em vez de num wrapper comum) é o que o handler de
// dragend usa pra saber pra qual pasta mandar a nova ordem — mais simples
// que subir até o pai, e funciona igual estejamos numa única seção
// "Folders" ou numa sub-seção de "User folders". Funciona tanto para cards
// de comando (data-cmd-id) quanto de nota (data-note-id, ver
// buildNoteCardHtml abaixo) — o handler de dragend em js/folders.js lê
// qualquer um dos dois pra saber o tipo do item arrastado.
function wrapCardsForFolderDrag(cards, folderId) {
  return cards.map(html => `<div class="folder-card-row" data-folder-id="${folderId}">
    <span class="folder-drag-handle" onmousedown="_fcArmDrag(this)" title="Drag to reorder">⠿</span>
    <div class="folder-card-row-body">${html}</div>
  </div>`).join('');
}

// Card de uma NOTE (task Notes) — 2º redesign (pedido mais recente: "em
// notes, remova a palavra NOTE, permita o usuário alterar o tamanho da
// fonte, a cor e alinha para esquerda, centro e direita; deixa a nota em
// uma caixa branca sem borda do mesmo tamanho da caixa do comando" —
// reverte parcialmente o pedido ANTERIOR de fundo transparente, ver
// comentário em components.css). Continua um bloco ÚNICO (sem cabeçalho/
// título separado, ver .note-flat-body abaixo) — só que agora com fundo
// branco/cinza igual ao comando (var(--surf), sem borda visível) em vez de
// transparente, e SEM o badge "Note" na frente do texto (removido a
// pedido) — a única forma de diferenciar nota de comando na tela passou a
// ser o próprio fundo (visualmente idêntico ao comando, sem cabeçalho)
// dentro da MESMA seção de pasta, o que é intencional (pedido do usuário).
// A "descrição" É o próprio conteúdo (HTML já sanitizado no servidor — ver
// sanitizeNoteHtml em server/index.js — então pode ser inserido cru aqui,
// inclusive <img> coladas/redimensionadas, e agora também <span
// style="..."> de tamanho de fonte/cor e blocos com text-align, todos
// aplicados pela barra de formatação do editor — ver neExec/neSetFontSize/
// neSetColor em js/folders.js).
// `note.title` (campo do banco, ver schema.sql) não é mostrado na tela —
// é só um resumo em texto puro derivado automaticamente do conteúdo (ver
// _deriveNoteTitle em js/folders.js), mantido só pra mensagens internas
// (confirmação de exclusão, sufixo " (copy)" ao clonar).
// `ownFolder` (= withActions da seção que contém a nota, sempre verdadeiro
// quando é uma pasta do usuário atual e falso quando é de outro usuário)
// decide se aparecem os botões de clonar/editar/excluir — uma nota só pode
// ser alterada por quem a escreveu, e como uma nota só existe dentro de uma
// pasta que já é sua (não há como criar nota na pasta de outra pessoa), a
// posse da PASTA já equivale à posse da nota — não precisa comparar
// note.username com CURRENT_USER separadamente. As ações viram um
// mini-toolbar absolute no canto superior direito, visível só no hover (ver
// .note-flat-actions em components.css) — sem faixa de cabeçalho pra
// "morarem" como antes.
function buildNoteCardHtml(note, ownFolder) {
  if (!note) return '';
  const jsEsc = typeof jsAttrEscapeCmdSearch === 'function' ? jsAttrEscapeCmdSearch(note.title || '') : escAttr(note.title || '');
  const actions = ownFolder ? `<span class="note-flat-actions">
    <button type="button" class="edit-btn" onclick="cloneNote(${note.id}, event)" title="Clone note">
      <svg width="11" height="11" fill="none" viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="9" height="9" rx="1.3" stroke="currentColor" stroke-width="1.4"/><path d="M3.2 10.5H2.3a.8.8 0 01-.8-.8v-7A.8.8 0 012.3 2h7a.8.8 0 01.8.8v.9" stroke="currentColor" stroke-width="1.4"/></svg>
    </button>
    <button type="button" class="edit-btn" onclick="openNoteEditor('edit', ${note.folder_id}, ${note.id}, event)" title="Edit note">
      <svg width="11" height="11" fill="none" viewBox="0 0 16 16"><path d="M11.3 1.7l3 3L5 14H2v-3l9.3-9.3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
    </button>
    <button type="button" class="edit-btn note-delete-btn" onclick="deleteNoteConfirm(${note.id}, '${jsEsc}', event)" title="Delete note">✕</button>
  </span>` : '';
  const content = (note.description || '').trim()
    ? note.description
    : '<span class="note-flat-empty">(empty note)</span>';
  // `class="card"` SEM sufixo próprio de propósito — várias contagens de
  // cards pela tela inteira (ver render.js: cardCount) casam com o texto
  // EXATO `<div class="card"` via regex; um classname extra aqui (ex.:
  // "card note-flat") quebraria esse match (a regex não acha a aspa de
  // fechamento logo depois de "card"), fazendo notas sumirem da contagem e,
  // em casos de pasta só com notas, a seção inteira sumir (cardCount==0).
  // O visual (ver .card[data-note-id] em components.css) é aplicado via
  // atributo `[data-note-id]`, não via classe extra — já dá seletor
  // específico o bastante sem mexer na classe.
  // `data-note-id` (em vez de data-cmd-id) também já é suficiente pra
  // distinguir nota de comando em qualquer seletor/handler que precise (ver
  // wrapCardsForFolderDrag/_fcArmDrag em js/folders.js).
  return `<div class="card" data-note-id="${note.id}">
    ${actions}
    <div class="note-flat-body">${content}</div>
  </div>`;
}

// Intercala comandos e notes de UMA pasta na ordem combinada que o usuário
// definiu (task Notes) — `orderTagged` é o array {type:'command'|'note', id}
// que o servidor já devolve pronto (ver GET /api/folders[/all] em
// server/index.js, e folder.order em js/folders.js). Itens sem posição
// salva (comando/nota nova, ou pasta antiga de antes desta feature) vão pro
// FIM, comandos antes de notes, nunca desaparecem — mesmo critério que
// buildFolderSection já usava só para comandos antes desta mudança.
// `cmdById`/`notesById` são Maps já filtrados para o conteúdo desta pasta
// especificamente (quem chama decide o que entra).
function buildFolderItemsCards(cmdById, notesById, orderTagged, values, hasIPs, ownFolder) {
  const seenCmd = new Set(), seenNote = new Set();
  (orderTagged || []).forEach(o => { if (o && o.type === 'note') seenNote.add(o.id); else if (o) seenCmd.add(o.id); });
  const extra = [
    ...[...cmdById.keys()].filter(id => !seenCmd.has(id)).map(id => ({ type: 'command', id })),
    ...[...notesById.keys()].filter(id => !seenNote.has(id)).map(id => ({ type: 'note', id })),
  ];
  const finalOrder = (orderTagged || [])
    .filter(o => o && (o.type === 'note' ? notesById.has(o.id) : cmdById.has(o.id)))
    .concat(extra);
  return finalOrder.map(o => o.type === 'note'
    ? buildNoteCardHtml(notesById.get(o.id), ownFolder)
    : buildCardHtmlForRow(cmdById.get(o.id), values, hasIPs)
  ).filter(Boolean);
}

// Cabeçalho + corpo de uma seção de PASTA a partir de uma lista de CARDS já
// prontos (comando OU nota — não filtra por folder_ids, quem chama já
// decidiu quais cards entram, e em que ORDEM). Extraído de
// buildFolderSection() para ser reaproveitado também pelo Group by "User
// folders" (cross-user, ver render.js) e pelo novo seletor de escopo de
// pastas dentro de Folders ("My folders" / escolher usuário / "All"), que
// montam os cards de uma pasta de OUTRO usuário a partir de
// ALL_USERS_FOLDERS em vez de folder_ids (que só reflete as pastas do
// usuário atual — ver server/index.js: shapeCommand()). `folderName` é
// texto livre cadastrado pelo usuário — passa por escAttr() antes de virar
// título (inserido como HTML cru) para não permitir HTML injection via nome
// de pasta malicioso.
// `withActions` controla se aparece o botão único "Edit folder" (task
// #463 — consolida o antigo trio ⇕/✎/✕ num só) e o botão "+ Add note" —
// só fazem sentido numa pasta que pertence ao usuário atual (o backend
// recusa as operações numa pasta de outra pessoa, e nem deixa criar nota
// fora da própria pasta). `copyable` (task #459) mostra em vez disso um
// único botão de copiar a pasta — usado quando é a pasta de OUTRO usuário;
// nunca junto com withActions. Notas de outro usuário aparecem no corpo
// (buildFolderItemsCards já foi chamado com ownFolder=false por quem monta
// `cards`), só que sem NENHUM botão de ação — ver buildNoteCardHtml.
// `editMode` (task #461/#463) — só dentro desse modo (toggle "✎ Edit
// folder" no cabeçalho) é que: (a) os cards ficam arrastáveis (embrulhados
// em .folder-card-row, ver wrapCardsForFolderDrag), e (b) aparece Excluir.
// Fora desse modo, mesmo numa pasta própria, a seção mostra só os cards +
// os botões sempre visíveis (✎ Edit / + Note) — arrastar/excluir por
// acidente não deveria ser possível sem o usuário ter entrado
// deliberadamente no modo de edição.
//
// Layout do cabeçalho (a pedido do usuário, ver mockup/print anexado): o
// botão de editar é um lápis (✎, antes uma engrenagem ⚙) um pouco maior que
// os demais (.sec-folder-edit-btn); Excluir usa o mesmo componente visual
// "tag" vermelha dos badges dos comandos (.tag.t-red) em vez de um ícone
// discreto, pra deixar a ação destrutiva mais chamativa; e o botão do canto
// direito (+ Add note na pasta própria, ⧉ Copy na de outro usuário) fica
// encostado na borda direita do cabeçalho — igual ao botão sólido "Add" da
// toolbar principal — separado dos botões da esquerda por um divisor
// explícito (`.sec-title-divider`, substitui o ::after padrão de
// `.sec-title` só nas seções de pasta, ver `.section-folder` em
// components.css) em vez de ficar espremido do lado do nome/contagem.
function buildFolderSectionFromCards(cards, folderId, folderName, key, withActions, copyable, editMode) {
  // Pastas do próprio usuário (withActions) SEMPRE aparecem, mesmo vazias
  // (0 comandos e 0 notas) — antes voltavam '' e a pasta recém-criada
  // simplesmente não aparecia em lugar nenhum até o usuário adicionar algo
  // a ela, o que parecia um bug ("criei a pasta e ela não aparece").
  // Pastas de OUTRO usuário (copyable, só leitura) continuam escondidas
  // quando vazias — não haveria nada útil pra fazer com elas ali.
  if (!cards.length && !withActions) return '';
  const nameEsc = escAttr(folderName);
  const jsEsc = typeof jsAttrEscapeCmdSearch === 'function' ? jsAttrEscapeCmdSearch(folderName) : nameEsc;

  const editBtn = withActions
    ? `<button type="button" class="sec-folder-btn sec-folder-edit-btn${editMode ? ' on' : ''}" onmousedown="event.preventDefault()" onclick="toggleFolderEditMode(${folderId}, event)" title="${editMode ? 'Done editing' : 'Edit folder'}">✎</button>`
    : '';
  const deleteTag = (withActions && editMode)
    ? `<button type="button" class="sec-folder-delete-btn" onmousedown="event.preventDefault()" onclick="deleteFolderConfirm(${folderId}, '${jsEsc}', event)" title="Delete folder">✕ Delete</button>`
    : '';
  const leftActions = (editBtn || deleteTag) ? `<span class="sec-folder-actions">${editBtn}${deleteTag}</span>` : '';

  // "Add note" voltou pro cabeçalho (2º giro: tinha saído pro corpo da
  // seção por ser pouco visível como botão pequeno "+" no canto — virou um
  // botão de linha inteira ABAIXO do nome; pedido mais recente do usuário:
  // "mover o botão de add note para o final da linha, na mesma direção do
  // add" — ou seja, de volta ao cabeçalho, colado na borda direita, igual
  // ⧉ Copy/posição do botão "Add" da toolbar principal). Fica no canto
  // direito do cabeçalho (rightAction), empurrado até a borda pelo mesmo
  // divisor explícito (.sec-title-divider) que já separava ✎ Edit/✕ Delete
  // de ⧉ Copy — nunca aparece junto com ⧉ Copy (mutuamente exclusivos:
  // withActions é sempre a pasta PRÓPRIA, copyable é sempre a de OUTRO
  // usuário). "Cores invertidas do Add conforme cada tema" (outro pedido
  // do usuário): o Add da toolbar é sólido (fundo --teal cheio, texto
  // branco — ver .ctb-cmd-btn.admin-highlight em layout.css); Add note usa
  // o padrão "tintado" oposto (fundo --teal-bg translúcido, texto e borda
  // --teal) — mesma cor de destaque em ambos, só com fundo/texto trocados,
  // e já correto em claro/escuro porque --teal-bg é um rgba() sobre --teal
  // (não uma cor fixa) — ver .sec-folder-add-note-btn em components.css.
  let rightAction = '';
  if (withActions) {
    rightAction = `<button type="button" class="btn sec-folder-add-note-btn" onclick="openNoteEditor('create', ${folderId}, null, event)"><svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><span>Add note</span></button>`;
  } else if (copyable) {
    rightAction = `<button type="button" class="sec-folder-btn" onmousedown="event.preventDefault()" onclick="copyFolderFromUser(${folderId}, '${jsEsc}', event)" title="Copy this folder to your own Folders">⧉</button>`;
  }
  const divider = (leftActions || rightAction) ? '<span class="sec-title-divider"></span>' : '';

  // Dentro do modo de edição, o nome deixa de ser texto estático e passa a
  // ser um <input> editável direto no cabeçalho (em vez de precisar clicar
  // num botão "✎ Rename" que abria um modal — ver _folderNameInputBlur/
  // _folderNameInputKeydown em js/folders.js). onclick/onmousedown
  // stopPropagation() evita que o clique pra focar o campo dispare o
  // toggle de recolher/expandir da seção (.sec-title tem
  // onclick="toggleSection(...)" — ver collapsibleGroup em
  // terminal-renderer.js). Enter salva (blur), Escape cancela e reverte.
  const nameHtml = (withActions && editMode)
    ? `<input type="text" class="sec-folder-name-input" value="${nameEsc}" data-folder-id="${folderId}" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()" onkeydown="_folderNameInputKeydown(event)" onblur="_folderNameInputBlur(event)">`
    : nameEsc;
  const headerHtml = `${folderIcon(true, 12)} ${nameHtml} <span class="sec-count">${cards.length}</span>${leftActions}${divider}${rightAction}`;
  // Pasta própria recém-criada, ainda sem nenhum comando/nota — mostra um
  // aviso discreto em vez de deixar o corpo da seção parecendo vazio/quebrado
  // (o botão "Add note" agora mora no cabeçalho, não mais aqui no corpo).
  const emptyMsg = (withActions && !cards.length)
    ? `<p class="sec-folder-empty-msg">This folder is empty — add a note or a command to it from the card's folder menu.</p>`
    : '';
  const active = withActions && editMode;
  const body = emptyMsg + (active ? wrapCardsForFolderDrag(cards, folderId) : cards.join(''));
  return collapsibleGroup(key || `folder${folderId}`, headerHtml, body, active ? 'section-folder section-editing' : 'section-folder');
}

// Uma seção de PASTA do usuário ATUAL (ícone de pasta + nome + seus
// comandos/notas) — mesmo papel de buildTopicSection acima, só que
// agrupando pela pasta do usuário (ver js/folders.js) em vez de um Tópico
// do catálogo. Usada quando a visão atual é Folders (VIEW_FOLDERS_HOME, ver
// render.js) com o escopo "My folders", para que cada pasta apareça como
// uma seção recolhível no mesmo estilo visual dos Tópicos.
//
// `notes` (task Notes, opcional): array de notas da pasta (folder.notes, ver
// js/folders.js). `order` (opcional, task #458, estendido pela task Notes):
// array combinado {type,id} na ordem própria da pasta (folder.order) — ver
// buildFolderItemsCards acima para os detalhes de fallback.
//
// A sidebar não lista mais as pastas individualmente (só o item combinado
// "Folders" — a pedido do usuário), então renomear/excluir/reordenar uma
// pasta só é possível aqui: os botões (+ / ⚙ sempre, ✎ / ✕ só em modo de
// edição) embutidos no próprio cabeçalho da seção (ver
// buildFolderSectionFromCards acima), visíveis só no hover (exceto ⚙
// quando já ativo — ver .section-editing em components.css).
// `editMode` (task #461/#463, opcional): repassado direto pra
// buildFolderSectionFromCards — ver comentário lá.
function buildFolderSection(rows, folderId, folderName, values, hasIPs, key, notes, order, editMode) {
  const cmdById = new Map(rows.filter(r => (r.folder_ids || []).includes(folderId)).map(r => [r.id, r]));
  const notesById = new Map((notes || []).map(n => [n.id, n]));
  const cards = buildFolderItemsCards(cmdById, notesById, order, values, hasIPs, true);
  return buildFolderSectionFromCards(cards, folderId, folderName, key, true, false, editMode);
}
