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
    favoriteCount: row.favorite_count, favoritedBy: row.favorited_by,
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
    favoriteCount: row.favorite_count, favoritedBy: row.favorited_by,
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
