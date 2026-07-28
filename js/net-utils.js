// ════════════════════════════════════════════════
// INPUTS
// ════════════════════════════════════════════════
function gv(id) { return (document.getElementById(id) || { value: '' }).value.trim(); }

// A barra de parâmetros agora usa um único campo de busca estilo Check Point (src:/dst:/
// dport:/...) com seu próprio "x" de limpar embutido — ver clearQuery() em js/query-bar.js.

// ════════════════════════════════════════════════
// MÚLTIPLOS ENDEREÇOS / PORTAS / FAIXAS
// Aceita nos campos de filtro: "10.9.8.7", "10.9.8.7,10.9.8.77" (lista),
// "10.9.8.10-10.9.8.50" (faixa) ou combinações. Portas: "80,443" (lista).
// ════════════════════════════════════════════════
function ipToLong(ip) {
  const p = String(ip).split('.').map(Number);
  if (p.length !== 4 || p.some(n => isNaN(n) || n < 0 || n > 255)) return null;
  return ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3];
}
function longToIp(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

// Parseia um campo de endereço em itens individuais + faixas (a-b).
function parseAddr(raw) {
  const s = (raw || '').trim();
  if (!s) return { items: [], ranges: [], raw: s, isMulti: false, isRange: false };
  const parts = s.split(',').map(x => x.trim()).filter(Boolean);
  const items = [];
  const ranges = [];
  parts.forEach(part => {
    const dashIdx = part.indexOf('-', 1); // ignora hífen inicial (não deveria ocorrer em IP)
    if (dashIdx > 0) {
      const a = part.slice(0, dashIdx).trim(), b = part.slice(dashIdx + 1).trim();
      if (ipToLong(a) !== null && ipToLong(b) !== null) { ranges.push({ start: a, end: b }); return; }
    }
    items.push(part);
  });
  // isMulti = "não é um único IP exato": mais de um item OU qualquer faixa (mesmo uma faixa
  // sozinha já não é um IP exato único e precisa do tratamento especial de lista/faixa).
  return { items, ranges, raw: s, isMulti: items.length > 1 || ranges.length > 0, isRange: ranges.length > 0 };
}

// Parseia um campo de porta em lista (sem suporte a faixa, conforme solicitado).
function parsePorts(raw) {
  const s = (raw || '').trim();
  if (!s) return { items: [], raw: s, isMulti: false };
  const items = s.split(',').map(x => x.trim()).filter(Boolean);
  return { items, raw: s, isMulti: items.length > 1 };
}

// Converte uma faixa numérica de octeto (0-255) numa alternativa regex ERE compacta.
// Ex.: (10,50) -> "1[0-9]|2[0-9]|3[0-9]|4[0-9]|50"
function octetRangeToRegex(min, max) {
  if (min > max) { const t = min; min = max; max = t; }
  min = Math.max(0, Math.min(255, min));
  max = Math.max(0, Math.min(255, max));
  const alts = [];
  let n = min;
  while (n <= max) {
    if (n % 10 === 0 && n + 9 <= max) {
      const tens = Math.floor(n / 10);
      alts.push(tens === 0 ? '[0-9]' : `${tens}[0-9]`);
      n += 10;
    } else {
      const blockEnd = Math.min(max, Math.floor(n / 10) * 10 + 9);
      if (n === blockEnd) {
        alts.push(String(n));
      } else {
        const tens = Math.floor(n / 10);
        const loU = n % 10, hiU = blockEnd % 10;
        alts.push(tens === 0 ? `[${loU}-${hiU}]` : `${tens}[${loU}-${hiU}]`);
      }
      n = blockEnd + 1;
    }
  }
  return alts.join('|');
}

// Se a faixa corresponder exatamente a um bloco CIDR alinhado, retorna "a.b.c.d/nn".
function cidrFromRange(startIp, endIp) {
  const s = ipToLong(startIp), e = ipToLong(endIp);
  if (s === null || e === null) return null;
  const lo = Math.min(s, e), hi = Math.max(s, e);
  const size = hi - lo + 1;
  if ((size & (size - 1)) !== 0) return null;
  if (lo % size !== 0) return null;
  const prefix = 32 - Math.log2(size);
  return `${longToIp(lo)}/${prefix}`;
}

// Decompõe uma faixa de IPs em termos regex por bloco /24 (cada termo já com o prefixo travado).
// Faixas muito grandes (>maxBlocks blocos /24) são sinalizadas como "grandes demais" ao invés de
// gerar um regex gigantesco.
function ipRangeTerms(startIp, endIp, maxBlocks) {
  maxBlocks = maxBlocks || 5;
  const s = ipToLong(startIp), e = ipToLong(endIp);
  if (s === null || e === null) return { terms: [], tooLarge: false, invalid: true };
  const lo = Math.min(s, e), hi = Math.max(s, e);
  const loBlock = Math.floor(lo / 256), hiBlock = Math.floor(hi / 256);
  const blockCount = hiBlock - loBlock + 1;
  if (blockCount > maxBlocks) return { terms: [], tooLarge: true, blockCount };
  const terms = [];
  for (let b = loBlock; b <= hiBlock; b++) {
    const blockStart = b * 256, blockEnd = b * 256 + 255;
    const rangeLo = Math.max(lo, blockStart) - blockStart;
    const rangeHi = Math.min(hi, blockEnd) - blockStart;
    const prefix = longToIp(blockStart).split('.').slice(0, 3).join('\\.');
    const octRegex = octetRangeToRegex(rangeLo, rangeHi);
    terms.push(`${prefix}\\.(${octRegex})`);
  }
  return { terms, tooLarge: false, blockCount };
}

// Termo regex para um IP exato, com fronteira à direita para não casar "10.9.8.5" dentro de "10.9.8.50".
function ipLiteralTerm(ip) {
  return ip.trim().replace(/\./g, '\\.') + '([^0-9]|$)';
}

// Constrói os termos regex (todos já com fronteira) para um parseAddr(); sinaliza faixa grande demais.
// maxBlocks é alto por padrão pois um regex de grep não tem o limite prático de -F/BPF.
function buildAddrTerms(parsed, maxBlocks) {
  const terms = [];
  let rangeTooLarge = false;
  parsed.items.forEach(ip => terms.push(ipLiteralTerm(ip)));
  parsed.ranges.forEach(r => {
    const res = ipRangeTerms(r.start, r.end, maxBlocks || 64);
    if (res.tooLarge || res.invalid) { rangeTooLarge = true; return; }
    res.terms.forEach(t => terms.push(`${t}([^0-9]|$)`));
  });
  return { terms, rangeTooLarge };
}

// Regex -E combinando N campos parseAddr() já prontos (ex.: src + dst juntos num só grep).
function combinedAddrRegex(parsedList, maxBlocks) {
  let terms = [];
  let rangeTooLarge = false;
  parsedList.forEach(p => {
    const r = buildAddrTerms(p, maxBlocks);
    terms = terms.concat(r.terms);
    if (r.rangeTooLarge) rangeTooLarge = true;
  });
  return { regex: terms.length ? terms.join('|') : null, rangeTooLarge };
}

// Expande uma lista de endereços (itens + faixas pequenas) em array de IPs discretos,
// para comandos que só aceitam um valor exato por vez (ip route get, fetchlogs...).
// Faixas com mais de `maxEnum` endereços não são enumeradas (ficam de fora, sinalizadas).
function expandAddrDiscrete(parsed, maxEnum, capTotal) {
  maxEnum = maxEnum || 8; capTotal = capTotal || 5;
  let list = [...parsed.items];
  let skippedRange = false;
  parsed.ranges.forEach(r => {
    const a = ipToLong(r.start), b = ipToLong(r.end);
    if (a === null || b === null) return;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (hi - lo + 1 <= maxEnum) {
      for (let n = lo; n <= hi; n++) list.push(longToIp(n));
    } else {
      skippedRange = true;
    }
  });
  const truncated = list.length > capTotal;
  return { list: list.slice(0, capTotal), skippedRange, truncated };
}

// Constrói cláusula tcpdump para um campo (host único / lista OR / net CIDR / faixa pequena OR / faixa grande = nota)
// Menor bloco CIDR (potência de 2, alinhado) que contém [lo,hi] — usado quando uma faixa
// pedida não é um bloco exato, para oferecer o filtro mais abrangente possível.
function smallestEnclosingCidr(lo, hi) {
  let blockSize = 1;
  while (true) {
    const blockStart = Math.floor(lo / blockSize) * blockSize;
    if (blockStart + blockSize - 1 >= hi) return { blockStart, blockSize, prefix: 32 - Math.log2(blockSize) };
    blockSize *= 2;
    if (blockSize > 4294967296) return { blockStart: 0, blockSize: 4294967296, prefix: 0 };
  }
}

function tcpdumpClause(parsed, maxOrList) {
  maxOrList = maxOrList || 16;
  const hostTerms = parsed.items.map(ip => `host ${ip}`);
  const notes = [];
  parsed.ranges.forEach(r => {
    const cidr = cidrFromRange(r.start, r.end);
    if (cidr) { hostTerms.push(`net ${cidr}`); return; }
    const a = ipToLong(r.start), b = ipToLong(r.end);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const size = hi - lo + 1;
    if (size <= maxOrList) {
      for (let n = lo; n <= hi; n++) hostTerms.push(`host ${longToIp(n)}`);
    } else {
      const { blockStart, prefix } = smallestEnclosingCidr(lo, hi);
      hostTerms.push(`net ${longToIp(blockStart)}/${prefix}`);
      notes.push(`Range ${r.start}-${r.end} is not an exact block — filter widened to subnet ${longToIp(blockStart)}/${prefix} (broader than requested; refine in Wireshark if you need the exact range).`);
    }
  });
  return { clause: hostTerms.length ? '(' + hostTerms.join(' or ') + ')' : null, notes };
}

// fw monitor -F exige um valor exato por posição (não aceita faixa/CIDR). Para listas e
// faixas pequenas, geramos múltiplas combinações -F (todas na mesma captura), com um teto
// para não gerar um comando gigante.
function buildFwMonitorFilters(srcRaw, dstRaw, spRaw, dpRaw, proto) {
  const MAX_ENUM = 4, MAX_COMBOS = 6;
  const srcP = parseAddr(srcRaw), dstP = parseAddr(dstRaw);
  const spP = parsePorts(spRaw), dpP = parsePorts(dpRaw);
  const srcX = expandAddrDiscrete(srcP, MAX_ENUM, 999);
  const dstX = expandAddrDiscrete(dstP, MAX_ENUM, 999);
  // Só cai para o valor bruto quando ele é um IP único simples (sem lista/faixa).
  // Se for faixa grande demais para enumerar, NÃO usar a string bruta (ex.: "10.9.8.10-10.9.8.50")
  // como se fosse um IP literal — isso geraria um filtro -F inválido.
  const srcList = srcX.list.length ? srcX.list : (srcX.skippedRange ? [] : [srcRaw]);
  const dstList = dstX.list.length ? dstX.list : (dstX.skippedRange ? [] : [dstRaw]);
  const spList = spP.items.length ? spP.items : [spRaw || '0'];
  const dpList = dpP.items.length ? dpP.items : [dpRaw || '0'];

  if (srcList.length === 0 || dstList.length === 0) {
    return {
      flagsStr: '',
      notes: ['fw monitor -F requires exact IPs and does not accept a range/subnet — the given range is too large to enumerate (limit of 4 addresses). No -F filter generated; use tcpdump (accepts net/CIDR) or narrow the range to up to 4 IPs.'],
    };
  }

  const combos = [];
  for (const s of srcList) {
    for (const d of dstList) {
      for (const sp2 of spList) {
        for (const dp2 of dpList) {
          if (combos.length >= MAX_COMBOS) break;
          combos.push({ s, d, sp: sp2, dp: dp2 });
        }
      }
    }
  }

  const flags = [];
  combos.forEach(c => {
    flags.push(`-F "${c.s},${c.sp},${c.d},${c.dp},${proto}"`);
    flags.push(`-F "${c.d},${c.dp},${c.s},${c.sp},${proto}"`);
  });

  const totalPossible = srcList.length * dstList.length * spList.length * dpList.length;
  const notes = [];
  if (srcX.skippedRange || dstX.skippedRange) {
    notes.push('fw monitor -F requires exact IPs — it does not accept a range/subnet. A range too large to enumerate was skipped; capture without this filter and refine with tcpdump -r + Wireshark, or repeat the command per IP.');
  }
  if (totalPossible > MAX_COMBOS) {
    notes.push(`Generated ${combos.length} of ${totalPossible} possible combinations (safety limit) — duplicate the -F pairs manually if you need the rest.`);
  }
  return { flagsStr: flags.join(' '), notes };
}
