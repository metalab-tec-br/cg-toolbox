// ════════════════════════════════════════════════
// IP CALCULATOR — botão no header (ao lado do menu de conta, ver
// #ipcOpenBtn em index.html), abre um modal (#ipCalcOverlay) com:
// 1) cálculo de rede a partir de IP + máscara (CIDR "/24" ou dotted
//    "255.255.255.0") — endereço de rede, broadcast, máscara, wildcard,
//    faixa de hosts utilizáveis, classe (A/B/C/D/E) e tipo (privado
//    RFC 1918 / público / loopback / link-local / multicast / etc.);
// 2) campo opcional "move to" — um segundo prefixo/máscara que tanto faz
//    SPLIT (prefixo mais longo/específico -> lista todas as sub-redes,
//    ex.: /24 em N x /25) quanto SUPERNET (prefixo mais curto -> recalcula
//    a rede que contém o mesmo endereço com uma máscara mais larga) — os
//    dois sentidos do mesmo campo, igual à calculadora de referência que o
//    usuário pediu pra seguir de estilo (rótulos verdes, valores em azul,
//    representação binária ponto-a-ponto com a máscara em vermelho);
// 3) tabela de referência fixa com as faixas privadas da RFC 1918.
// Reaproveita ipToLong/longToIp (js/net-utils.js, já carregado antes deste
// arquivo) e o par _copyToClipboard/_doSingleCopy/COPY_BTN_ICON
// (js/terminal-renderer.js) usado pelos botões de copiar em todo o app, em
// vez de duplicar essa lógica.
// ════════════════════════════════════════════════

// ── Máscara/prefixo ──────────────────────────────
// (32 - prefix) pode valer 32 quando prefix=0 — deslocamento de bits em JS
// usa o operando módulo 32, então "x << 32" NÃO desloca nada (bug clássico);
// por isso prefix<=0 é tratado à parte, devolvendo a máscara zerada certa.
function ipcPrefixToMaskLong(prefix) {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xFFFFFFFF >>> 0;
  return (0xFFFFFFFF << (32 - prefix)) >>> 0;
}

// Aceita "/24", "24" (CIDR/prefixo) ou "255.255.255.0" (máscara decimal
// pontuada) — devolve o prefixo (0-32) ou null se inválido. Uma máscara
// pontuada só é válida se for contígua (1s seguidos de 0s, sem "buracos").
function ipcParseMaskInput(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  s = s.replace(/^\//, '');
  if (/^\d{1,2}$/.test(s)) {
    const n = parseInt(s, 10);
    return (n >= 0 && n <= 32) ? n : null;
  }
  const maskLong = ipToLong(s);
  if (maskLong === null) return null;
  const bin = (maskLong >>> 0).toString(2).padStart(32, '0');
  if (!/^1*0*$/.test(bin)) return null; // máscara não-contígua (ex.: 255.0.255.0) é inválida
  return (bin.match(/1/g) || []).length;
}

// ── Classificação do endereço ────────────────────
function ipcIpClass(ipLong) {
  const first = (ipLong >>> 24) & 255;
  if (first < 128) return 'A';
  if (first < 192) return 'B';
  if (first < 224) return 'C';
  if (first < 240) return 'D (Multicast)';
  return 'E (Experimental)';
}
// Só as faixas mais relevantes pro dia a dia de suporte — não é uma lista
// exaustiva de toda a IANA Special-Purpose Address Registry. Nomes curtos
// de propósito — aparecem entre parênteses na mesma linha do resultado.
function ipcIpType(ipLong) {
  const a = (ipLong >>> 24) & 255, b = (ipLong >>> 16) & 255;
  if (a === 10) return 'Private Internet';
  if (a === 172 && b >= 16 && b <= 31) return 'Private Internet';
  if (a === 192 && b === 168) return 'Private Internet';
  if (a === 127) return 'Loopback';
  if (a === 169 && b === 254) return 'Link-Local';
  if (a === 100 && b >= 64 && b <= 127) return 'Shared Address Space';
  if (a >= 224 && a <= 239) return 'Multicast';
  if (a >= 240) return 'Reserved';
  return 'Public Internet';
}

// ── Cálculo principal ─────────────────────────────
// Trata /31 (RFC 3021 — link ponto-a-ponto, ambos endereços são
// utilizáveis, sem conceito de rede/broadcast na prática) e /32 (host
// único) como casos especiais — a fórmula genérica (total-2) daria hosts
// negativos ou zero pra esses dois prefixos.
function ipcCalculate(ipRaw, maskRaw) {
  const ipLong = ipToLong(String(ipRaw || '').trim());
  if (ipLong === null) return { error: 'Invalid IP address.' };
  const prefix = ipcParseMaskInput(maskRaw);
  if (prefix === null) return { error: 'Invalid mask — use CIDR (e.g. /24 or 24) or a dotted mask (e.g. 255.255.255.0).' };

  const maskLong = ipcPrefixToMaskLong(prefix);
  const wildcardLong = (~maskLong) >>> 0;
  const networkLong = (ipLong & maskLong) >>> 0;
  const broadcastLong = (networkLong | wildcardLong) >>> 0;
  const totalAddresses = Math.pow(2, 32 - prefix);

  let usableHosts, firstHostLong, lastHostLong;
  if (prefix === 32) {
    usableHosts = 1;
    firstHostLong = networkLong;
    lastHostLong = networkLong;
  } else if (prefix === 31) {
    usableHosts = 2;
    firstHostLong = networkLong;
    lastHostLong = broadcastLong;
  } else {
    usableHosts = totalAddresses - 2;
    firstHostLong = networkLong + 1;
    lastHostLong = broadcastLong - 1;
  }

  return {
    ip: longToIp(ipLong),
    ipLong,
    prefix,
    networkLong,
    broadcastLong,
    firstHostLong,
    lastHostLong,
    cidr: `${longToIp(networkLong)}/${prefix}`,
    maskDotted: longToIp(maskLong),
    maskLong,
    wildcardDotted: longToIp(wildcardLong),
    wildcardLong,
    network: longToIp(networkLong),
    broadcast: longToIp(broadcastLong),
    firstHost: longToIp(firstHostLong),
    lastHost: longToIp(lastHostLong),
    totalAddresses,
    usableHosts,
    ipClass: ipcIpClass(ipLong),
    ipType: ipcIpType(ipLong),
  };
}

// ── Split de sub-rede ─────────────────────────────
// Divide a rede [networkLong, basePrefix] em blocos iguais de prefixo
// newPrefix (ex.: /24 -> N x /25, /26...). MAX_SUBNETS é um teto de
// segurança (mesmo espírito do MAX_ENUM/MAX_COMBOS em js/net-utils.js) pra
// não travar a tela caso o usuário peça algo como /8 -> /30.
const IPC_MAX_SUBNETS = 512;
function ipcSplitSubnets(networkLong, basePrefix, newPrefix) {
  if (!(newPrefix > basePrefix)) return { error: 'The new prefix must be longer (a bigger number) than the current one.' };
  if (newPrefix > 32) return { error: 'Prefix cannot exceed /32.' };
  const count = Math.pow(2, newPrefix - basePrefix);
  const genCount = Math.min(count, IPC_MAX_SUBNETS);
  const blockSize = Math.pow(2, 32 - newPrefix);
  const subnets = [];
  for (let i = 0; i < genCount; i++) {
    const subNet = (networkLong + i * blockSize) >>> 0;
    const subBcast = (subNet + blockSize - 1) >>> 0;
    let usable, first, last;
    if (newPrefix === 32) { usable = 1; first = subNet; last = subNet; }
    else if (newPrefix === 31) { usable = 2; first = subNet; last = subBcast; }
    else { usable = blockSize - 2; first = subNet + 1; last = subBcast - 1; }
    subnets.push({
      networkLong: subNet,
      broadcastLong: subBcast,
      firstHostLong: first,
      lastHostLong: last,
      cidr: `${longToIp(subNet)}/${newPrefix}`,
      network: longToIp(subNet),
      broadcast: longToIp(subBcast),
      firstHost: longToIp(first),
      lastHost: longToIp(last),
      usableHosts: usable,
      ipClass: ipcIpClass(subNet),
      ipType: ipcIpType(subNet),
    });
  }
  return { subnets, count, truncated: count > genCount, generated: genCount };
}

// ── UI: abrir/fechar modal ────────────────────────
function openIpCalcModal() {
  document.getElementById('ipCalcOverlay').classList.add('show');
  const ipEl = document.getElementById('ipcIp');
  if (ipEl) setTimeout(() => ipEl.focus(), 0);
}
function closeIpCalcModal() {
  document.getElementById('ipCalcOverlay').classList.remove('show');
}
// Pedido do usuário: fechar SOMENTE pelo botão "✕" do cabeçalho — ao
// contrário dos outros modais do app, aqui não há fechamento por clique
// fora (overlay) nem por Esc, propositalmente (evita perder os dados
// calculados/o "move to" digitado com um clique ou tecla acidental).

// ── UI: saída em estilo "calculadora de terminal" ──
// Pedido do usuário: reproduzir o estilo de uma calculadora de sub-rede
// clássica (rótulo em verde + valor + a mesma dotted-quad em BINÁRIO ao
// lado, com a porção de rede/host separada por um espaço extra bem na
// fronteira do prefixo, e a máscara em vermelho) em vez da tabela simples
// usada antes.
// Cada linha é um <div class="ipc-line"> com colunas flex de largura FIXA
// em `ch` (ver .ipc-label/.ipc-val/.ipc-copy-slot em css/components.css) —
// não mais uma string monoespaçada com padEnd()/'\n'. Isso garante que a
// coluna do binário comece sempre no mesmo x em toda linha, existindo ou
// não um botão de copiar (um <button> real tem largura em pixels, não em
// caracteres — padEnd() não conseguia alinhar em torno dele, era o motivo
// do "hexadecimal" desalinhado que o usuário reportou).

function _ipcBits32(long) {
  return (long >>> 0).toString(2).padStart(32, '0');
}

// Monta a representação binária pontuada (8.8.8.8 bits) de `long`, com um
// espaço extra logo após o bit `prefix` (fronteira rede/host) — mesmo
// quando esse ponto coincide com um dos pontos fixos entre octetos (nesse
// caso o espaço vem ANTES do ponto, ex.: "...00000000 .00000001" pra /24).
// Devolve { str, splitIdx } — splitIdx é o índice de caractere logo após a
// porção "de rede" dentro de `str`, usado por ipcBinHtml pra colorir os
// dois pedaços separadamente.
function _ipcDottedBinary(long, prefix) {
  const bits = _ipcBits32(long);
  let out = '';
  let splitIdx = (prefix <= 0) ? 0 : null;
  for (let i = 1; i <= 32; i++) {
    out += bits[i - 1];
    if (i === prefix && prefix > 0 && prefix < 32) { out += ' '; splitIdx = out.length; }
    if (i % 8 === 0 && i < 32) out += '.';
  }
  if (splitIdx === null) splitIdx = out.length; // prefix >= 32
  return { str: out, splitIdx };
}

// mode: 'net' (padrão — porção de rede em destaque, porção de host
// esmaecida), 'mask' (porção de rede inteira em vermelho — usado só nas
// linhas Netmask, pra saltar aos olhos onde a máscara "corta"), ou 'plain'
// (sem cor — usado na linha Wildcard, que já é auto-explicativa).
function ipcBinHtml(long, prefix, mode) {
  const { str, splitIdx } = _ipcDottedBinary(long, prefix);
  if (mode === 'plain') return `<span class="ipc-bin">${str}</span>`;
  const netPart = str.slice(0, splitIdx);
  const hostPart = str.slice(splitIdx);
  const netClass = mode === 'mask' ? 'ipc-bin ipc-bin-mask' : 'ipc-bin ipc-bin-net';
  return `<span class="${netClass}">${netPart}</span><span class="ipc-bin ipc-bin-host">${hostPart}</span>`;
}

// Botão de copiar embutido inline no texto — os únicos valores que passam
// por aqui são IPs/CIDRs já validados (só dígitos, pontos e "/"), então é
// seguro embuti-los direto num atributo onclick com aspas simples.
// IMPORTANTE: a classe base ".copy-btn" é "display:flex" (bloco), pensada
// pro botão ficar no final de uma linha de comando isolada — dentro do
// bloco de texto monoespaçado do IPCalc (white-space:pre) isso quebrava a
// linha ao meio, empurrando o botão pra uma linha própria logo abaixo (com
// um vão vazio enorme no meio). ".copy-btn-inline" é o modificador que já
// existe no app pra isso (ver css/components.css), tornando o botão
// "inline-flex" de verdade, fluindo junto do texto sem quebrar a linha.
function ipcCopyBtnHtml(text) {
  return `<button type="button" class="copy-btn copy-btn-inline ipc-copy-btn" title="Copy" onclick="ipcCopyInline(this,'${text}')">${COPY_BTN_ICON}</button>`;
}
function ipcCopyInline(btn, text) {
  if (typeof _doSingleCopy !== 'function') return;
  btn._copyText = text;
  _doSingleCopy(btn);
}

// Uma linha "Label: valor[copiar] binário (nota)", como um <div> flex — o
// valor e o botão de copiar (quando existe) ficam juntos dentro de
// .ipc-valwrap, colados um no outro — pedido do usuário ("o botão de
// copiar deve ficar logo após os endereços"). .ipc-valwrap tem largura
// FIXA (ver css/components.css) MESMO quando não há botão, pra coluna do
// binário não deslocar entre linhas com/sem botão de copiar.
function ipcLine(label, value, binHtml, note, copyText) {
  let html = `<div class="ipc-line">`;
  html += `<span class="ipc-label">${label}:</span>`;
  html += `<span class="ipc-valwrap"><span class="ipc-val">${value}</span>`;
  if (copyText) html += ipcCopyBtnHtml(copyText);
  html += `</span>`;
  if (binHtml) html += `<span class="ipc-bin-wrap">${binHtml}</span>`;
  if (note) html += ` <span class="ipc-note">(${note})</span>`;
  html += `</div>`;
  return html;
}

// Linha "Netmask" — caso especial: pedido do usuário é mostrar a máscara
// pontuada (255.255.255.0) com o SEU PRÓPRIO botão de copiar, um espaço, e
// o prefixo (/24) com OUTRO botão de copiar independente — em vez de um
// texto único "255.255.255.0 = 24" sem botão nenhum (como as demais linhas
// via ipcLine()). Ainda usa .ipc-valwrap (mesma largura fixa reservada nas
// outras linhas) pra manter a coluna do binário alinhada.
function ipcNetmaskLine(maskDotted, prefix, binHtml) {
  let html = `<div class="ipc-line">`;
  html += `<span class="ipc-label">Netmask:</span>`;
  html += `<span class="ipc-valwrap">`;
  html += `<span class="ipc-val">${maskDotted}</span>${ipcCopyBtnHtml(maskDotted)}`;
  html += `<span class="ipc-val">/${prefix}</span>${ipcCopyBtnHtml('/' + prefix)}`;
  html += `</span>`;
  if (binHtml) html += `<span class="ipc-bin-wrap">${binHtml}</span>`;
  html += `</div>`;
  return html;
}

// Bloco de 5 linhas comum a qualquer rede já calculada (rede/base, sub-rede
// individual de um split, ou supernet) — Network/HostMin/HostMax/Broadcast/
// Hosts+tipo, com botão de copiar em todos os endereços (Network/HostMin/
// HostMax/Broadcast) — pedido do usuário. Recebe um objeto com os *Long
// (networkLong, broadcastLong, firstHostLong, lastHostLong) +
// prefix/usableHosts/ipClass/ipType/cidr. Envolto num .ipc-block, que dá o
// espaçamento vertical entre blocos (rede base, cada sub-rede do split etc.)
function ipcRenderNetworkBlock(n) {
  let out = '<div class="ipc-block">';
  out += ipcLine('Network', n.cidr, ipcBinHtml(n.networkLong, n.prefix, 'net'), `Class ${n.ipClass}`, n.cidr);
  out += ipcLine('HostMin', longToIp(n.firstHostLong), ipcBinHtml(n.firstHostLong, n.prefix, 'net'), null, longToIp(n.firstHostLong));
  out += ipcLine('HostMax', longToIp(n.lastHostLong), ipcBinHtml(n.lastHostLong, n.prefix, 'net'), null, longToIp(n.lastHostLong));
  out += ipcLine('Broadcast', longToIp(n.broadcastLong), ipcBinHtml(n.broadcastLong, n.prefix, 'net'), null, longToIp(n.broadcastLong));
  out += ipcLine('Hosts/Net', n.usableHosts.toLocaleString('pt-BR'), '', n.ipType);
  out += '</div>';
  return out;
}

let IPC_LAST_RESULT = null;
let IPC_LAST_SUBNETS_TEXT = null;

function ipcRunCalculate() {
  const errEl = document.getElementById('ipcError');
  const moveToErrEl = document.getElementById('ipcMoveToError');
  const resultsGroup = document.getElementById('ipcResultsGroup');
  errEl.style.display = 'none'; errEl.textContent = '';
  moveToErrEl.style.display = 'none'; moveToErrEl.textContent = '';

  const ipRaw = document.getElementById('ipcIp').value;
  const maskRaw = document.getElementById('ipcMask').value;
  const moveToRaw = document.getElementById('ipcMoveTo').value;

  const r = ipcCalculate(ipRaw, maskRaw);
  if (r.error) {
    errEl.textContent = r.error;
    errEl.style.display = '';
    resultsGroup.style.display = 'none';
    return;
  }
  IPC_LAST_RESULT = r;
  IPC_LAST_SUBNETS_TEXT = null;

  let out = '<div class="ipc-block">';
  out += ipcLine('Address', r.ip, ipcBinHtml(r.ipLong, r.prefix, 'net'), null, r.ip);
  out += ipcNetmaskLine(r.maskDotted, r.prefix, ipcBinHtml(r.maskLong, r.prefix, 'mask'));
  out += ipcLine('Wildcard', r.wildcardDotted, ipcBinHtml(r.wildcardLong, r.prefix, 'plain'));
  out += '</div>';
  out += ipcRenderNetworkBlock(r);

  const copyAllWrap = document.getElementById('ipcCopyAllWrap');
  copyAllWrap.style.display = 'none';

  const moveTo = String(moveToRaw || '').trim();
  if (moveTo) {
    const newPrefix = ipcParseMaskInput(moveTo);
    if (newPrefix === null) {
      moveToErrEl.textContent = 'Invalid netmask/prefix for "move to".';
      moveToErrEl.style.display = '';
    } else if (newPrefix === r.prefix) {
      out += `<div class="ipc-note-line"><span class="ipc-note">Same prefix as the netmask above — nothing to move to.</span></div>`;
    } else if (newPrefix > r.prefix) {
      // Prefixo mais longo/específico = SPLIT: divide a rede atual em N
      // sub-redes menores (ex.: /24 -> 4 x /26).
      const res = ipcSplitSubnets(r.networkLong, r.prefix, newPrefix);
      out += '<div class="ipc-subnets-header-row"><span class="ipc-subnets-header">Subnets</span></div>';
      out += '<div class="ipc-block">';
      out += ipcNetmaskLine(longToIp(ipcPrefixToMaskLong(newPrefix)), newPrefix, ipcBinHtml(ipcPrefixToMaskLong(newPrefix), newPrefix, 'mask'));
      out += ipcLine('Wildcard', longToIp((~ipcPrefixToMaskLong(newPrefix)) >>> 0), ipcBinHtml((~ipcPrefixToMaskLong(newPrefix)) >>> 0, newPrefix, 'plain'));
      out += '</div>';
      res.subnets.forEach(sn => {
        out += ipcRenderNetworkBlock({ ...sn, prefix: newPrefix });
      });
      if (res.truncated) {
        out += `<div class="ipc-note-line"><span class="ipc-note">Showing the first ${res.generated} of ${res.count} subnets (safety limit).</span></div>`;
      }
      const totalHosts = res.subnets.reduce((sum, sn) => sum + sn.usableHosts, 0);
      out += '<div class="ipc-block">';
      out += ipcLine('Subnets', res.generated.toLocaleString('pt-BR'));
      out += ipcLine('Hosts', totalHosts.toLocaleString('pt-BR'));
      out += '</div>';
      IPC_LAST_SUBNETS_TEXT = res.subnets.map(sn => sn.cidr).join('\n');
      copyAllWrap.style.display = '';
    } else {
      // Prefixo mais curto/genérico = SUPERNET: recalcula a rede que
      // contém o MESMO endereço, só que com uma máscara mais larga.
      const sr = ipcCalculate(r.ip, String(newPrefix));
      out += '<div class="ipc-subnets-header-row"><span class="ipc-subnets-header">Supernet</span></div>';
      out += '<div class="ipc-block">';
      out += ipcNetmaskLine(sr.maskDotted, sr.prefix, ipcBinHtml(sr.maskLong, sr.prefix, 'mask'));
      out += ipcLine('Wildcard', sr.wildcardDotted, ipcBinHtml(sr.wildcardLong, sr.prefix, 'plain'));
      out += '</div>';
      out += ipcRenderNetworkBlock(sr);
    }
  }

  document.getElementById('ipcTermOutput').innerHTML = out;
  resultsGroup.style.display = '';
}

// Copia todos os CIDRs da última divisão (split) gerada, um por linha —
// mesmo _copyToClipboard usado no resto do app (js/terminal-renderer.js),
// com feedback simples trocando o texto do botão por um instante.
function ipcCopyAllSubnets() {
  if (!IPC_LAST_SUBNETS_TEXT) return;
  const btn = document.getElementById('ipcCopyAllBtn');
  _copyToClipboard(IPC_LAST_SUBNETS_TEXT).then(() => {
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    clearTimeout(btn._ipcRevertTimer);
    btn._ipcRevertTimer = setTimeout(() => { btn.textContent = original; }, COPY_BTN_FEEDBACK_MS);
  }).catch(err => {
    console.error('Copy all failed', err);
    alert('Failed to copy — please try again.');
  });
}
