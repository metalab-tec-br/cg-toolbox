// ════════════════════════════════════════════════
// IP CALCULATOR — botão no header (ao lado do menu de conta, ver
// #ipcOpenBtn em index.html), abre um modal (#ipCalcOverlay) com:
// 1) cálculo de rede a partir de IP + máscara (CIDR "/24" ou dotted
//    "255.255.255.0") — endereço de rede, broadcast, máscara, wildcard,
//    faixa de hosts utilizáveis, classe (A/B/C/D/E) e tipo (privado
//    RFC 1918 / público / loopback / link-local / multicast / etc.);
// 2) split de uma rede em sub-redes menores (ex.: /24 em N /25, /26...);
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
// exaustiva de toda a IANA Special-Purpose Address Registry.
function ipcIpType(ipLong) {
  const a = (ipLong >>> 24) & 255, b = (ipLong >>> 16) & 255;
  if (a === 10) return 'Private (RFC 1918)';
  if (a === 172 && b >= 16 && b <= 31) return 'Private (RFC 1918)';
  if (a === 192 && b === 168) return 'Private (RFC 1918)';
  if (a === 127) return 'Loopback';
  if (a === 169 && b === 254) return 'Link-local (APIPA)';
  if (a === 100 && b >= 64 && b <= 127) return 'Shared / CGN (RFC 6598)';
  if (a >= 224 && a <= 239) return 'Multicast';
  if (a >= 240) return 'Reserved';
  return 'Public';
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
    prefix,
    networkLong,
    cidr: `${longToIp(networkLong)}/${prefix}`,
    maskDotted: longToIp(maskLong),
    wildcardDotted: longToIp(wildcardLong),
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
const IPC_MAX_SUBNETS = 1024;
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
      cidr: `${longToIp(subNet)}/${newPrefix}`,
      network: longToIp(subNet),
      broadcast: longToIp(subBcast),
      firstHost: longToIp(first),
      lastHost: longToIp(last),
      usableHosts: usable,
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
document.getElementById('ipCalcOverlay').addEventListener('click', ev => {
  if (ev.target.id === 'ipCalcOverlay') closeIpCalcModal();
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && document.getElementById('ipCalcOverlay').classList.contains('show')) closeIpCalcModal();
});

// ── UI: helpers de renderização ───────────────────
// Constrói uma linha <tr> de resultado (label + valor), com um botão de
// copiar opcional ao lado do valor — reaproveita _doSingleCopy/COPY_BTN_ICON
// (js/terminal-renderer.js), a mesma máquina usada nos botões de copiar das
// linhas de comando, em vez de duplicar a lógica de cópia aqui.
function _ipcResultRow(label, value, copyable) {
  const tr = document.createElement('tr');
  const tdLabel = document.createElement('td');
  tdLabel.textContent = label;
  tdLabel.className = 'ipc-info-label';
  const tdValue = document.createElement('td');
  tdValue.className = 'ipc-info-value';
  const valueSpan = document.createElement('span');
  valueSpan.textContent = value;
  tdValue.appendChild(valueSpan);
  if (copyable && typeof _doSingleCopy === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn copy-btn-inline';
    btn.title = 'Copy';
    btn.innerHTML = COPY_BTN_ICON;
    btn._copyText = value;
    btn.addEventListener('click', () => _doSingleCopy(btn));
    tdValue.appendChild(btn);
  }
  tr.appendChild(tdLabel);
  tr.appendChild(tdValue);
  return tr;
}

function ipcRunCalculate() {
  const errEl = document.getElementById('ipcError');
  const resultsGroup = document.getElementById('ipcResultsGroup');
  const splitGroup = document.getElementById('ipcSplitGroup');
  errEl.style.display = 'none';
  errEl.textContent = '';

  const ipRaw = document.getElementById('ipcIp').value;
  const maskRaw = document.getElementById('ipcMask').value;
  const result = ipcCalculate(ipRaw, maskRaw);
  if (result.error) {
    errEl.textContent = result.error;
    errEl.style.display = '';
    resultsGroup.style.display = 'none';
    splitGroup.style.display = 'none';
    return;
  }

  IPC_LAST_RESULT = result;

  const tbody = document.getElementById('ipcResultsTbody');
  tbody.innerHTML = '';
  tbody.appendChild(_ipcResultRow('IP address', result.ip, false));
  tbody.appendChild(_ipcResultRow('CIDR notation', result.cidr, true));
  tbody.appendChild(_ipcResultRow('Network address', result.network, true));
  tbody.appendChild(_ipcResultRow('Broadcast address', result.broadcast, true));
  tbody.appendChild(_ipcResultRow('Subnet mask', `${result.maskDotted} (/${result.prefix})`, true));
  tbody.appendChild(_ipcResultRow('Wildcard mask', result.wildcardDotted, true));
  tbody.appendChild(_ipcResultRow('Host range', `${result.firstHost} – ${result.lastHost}`, true));
  tbody.appendChild(_ipcResultRow('Total addresses', result.totalAddresses.toLocaleString('en-US'), false));
  tbody.appendChild(_ipcResultRow('Usable hosts', result.usableHosts.toLocaleString('en-US'), false));
  tbody.appendChild(_ipcResultRow('IP class', result.ipClass, false));
  tbody.appendChild(_ipcResultRow('Address type', result.ipType, false));
  resultsGroup.style.display = '';

  // Split: dropdown só com prefixos mais específicos que o atual (senão não
  // é split, é supernet — fora do escopo deste recurso).
  const splitSelect = document.getElementById('ipcSplitPrefix');
  splitSelect.innerHTML = '';
  for (let p = result.prefix + 1; p <= 32; p++) {
    const opt = document.createElement('option');
    opt.value = String(p);
    opt.textContent = `/${p}`;
    splitSelect.appendChild(opt);
  }
  document.getElementById('ipcSplitBaseLabel').textContent = `Split ${result.cidr} into:`;
  document.getElementById('ipcSplitWrap').style.display = 'none';
  document.getElementById('ipcSplitNote').textContent = '';
  document.getElementById('ipcSplitCopyAllBtn').style.display = 'none';
  splitGroup.style.display = result.prefix < 32 ? '' : 'none';
}

let IPC_LAST_RESULT = null;
let IPC_LAST_SPLIT = null;

function ipcRunSplit() {
  if (!IPC_LAST_RESULT) return;
  const newPrefix = parseInt(document.getElementById('ipcSplitPrefix').value, 10);
  const res = ipcSplitSubnets(IPC_LAST_RESULT.networkLong, IPC_LAST_RESULT.prefix, newPrefix);
  const noteEl = document.getElementById('ipcSplitNote');
  const wrap = document.getElementById('ipcSplitWrap');
  const copyAllBtn = document.getElementById('ipcSplitCopyAllBtn');
  if (res.error) {
    noteEl.textContent = res.error;
    wrap.style.display = 'none';
    copyAllBtn.style.display = 'none';
    return;
  }
  IPC_LAST_SPLIT = res.subnets;
  const tbody = document.getElementById('ipcSplitTbody');
  tbody.innerHTML = '';
  res.subnets.forEach(sn => {
    const tr = document.createElement('tr');
    const tdCidr = document.createElement('td');
    tdCidr.style.fontFamily = 'var(--mono)';
    tdCidr.textContent = sn.cidr;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn copy-btn-inline';
    btn.title = 'Copy';
    btn.innerHTML = COPY_BTN_ICON;
    btn._copyText = sn.cidr;
    btn.addEventListener('click', () => _doSingleCopy(btn));
    tdCidr.appendChild(btn);
    const tdNet = document.createElement('td'); tdNet.style.fontFamily = 'var(--mono)'; tdNet.textContent = sn.network;
    const tdBcast = document.createElement('td'); tdBcast.style.fontFamily = 'var(--mono)'; tdBcast.textContent = sn.broadcast;
    const tdRange = document.createElement('td'); tdRange.style.fontFamily = 'var(--mono)'; tdRange.textContent = `${sn.firstHost} – ${sn.lastHost}`;
    const tdHosts = document.createElement('td'); tdHosts.textContent = sn.usableHosts.toLocaleString('en-US');
    tr.append(tdCidr, tdNet, tdBcast, tdRange, tdHosts);
    tbody.appendChild(tr);
  });
  wrap.style.display = '';
  noteEl.textContent = res.truncated
    ? `Showing the first ${res.generated} of ${res.count} subnets (safety limit) — narrow the split if you need the rest.`
    : `${res.generated} subnet${res.generated === 1 ? '' : 's'} of /${newPrefix}, ${res.subnets[0] ? res.subnets[0].usableHosts.toLocaleString('en-US') : 0} usable host(s) each.`;
  copyAllBtn.style.display = res.subnets.length ? '' : 'none';
}

// Copia todos os CIDRs da última divisão gerada, um por linha — mesmo
// _copyToClipboard usado no resto do app (js/terminal-renderer.js), com
// feedback simples trocando o texto do botão por um instante.
function ipcCopyAllSplit() {
  if (!IPC_LAST_SPLIT || !IPC_LAST_SPLIT.length) return;
  const btn = document.getElementById('ipcSplitCopyAllBtn');
  const text = IPC_LAST_SPLIT.map(sn => sn.cidr).join('\n');
  _copyToClipboard(text).then(() => {
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    clearTimeout(btn._ipcRevertTimer);
    btn._ipcRevertTimer = setTimeout(() => { btn.textContent = original; }, COPY_BTN_FEEDBACK_MS);
  }).catch(err => {
    console.error('Copy all failed', err);
    alert('Failed to copy — please try again.');
  });
}
