// seed.js — one-off, re-runnable migration of the ~29 topic commands + 5
// environment-specific cards that used to be hardcoded in js/render.js,
// js/commands.js and js/i18n.js, into the SQLite database (schema.sql).
//
// Re-running this script is safe: it clears existing `commands` rows (cascade
// deletes all child rows via FK) and re-inserts everything from scratch.
//
// Content notes (see server README / migration report for details):
// - Lines represent the "standalone environment / R82 version / single IP"
//   rendering — the version-and-environment-agnostic default. Version-specific
//   syntax is captured in command_diffs where the original app had a diffs
//   block; Version/Environment applicability tables are left empty for these
//   (they apply to all), except the 5 "Ambiente: X" cards which are pinned to
//   one specific environment each.
// - Commands flagged with a placeholder_resolver use a single-IP fallback
//   template; the real CIDR/list/range logic lives in js/net-utils.js and is
//   out of scope for this migration (frontend phase 2 wires it up).
// - note/warn/info line prose has no English source in the current app
//   (commands.js only ever wrote Portuguese for these) — English text below
//   was translated for this migration.

const db = require('./db');

const cmdLine = (p, c) => ({ line_type: 'cmd', prompt: p, content_pt: c, content_en: c });
const note = (pt, en) => ({ line_type: 'note', prompt: null, content_pt: pt, content_en: en });
const warn = (pt, en) => ({ line_type: 'warn', prompt: null, content_pt: pt, content_en: en });
const info = (pt, en) => ({ line_type: 'info', prompt: null, content_pt: pt, content_en: en });

const PR = { FW: '[Expert@FW]#', VS: '[VS{{vsid}}]#', MHO: '[Expert@MHO]#', MDS: '[Expert@MDS]#', CMA: '[Expert@CMA]#', SMS: '[Expert@SMS]#', GAIA: '[Gaia]>' };

const COMMANDS = [
  // ════════════════════════════════════ CAPTURE ════════════════════════════════════
  {
    id: 'fwmonitor', topic: 'capture', icon: '📡', sort_order: 1, requires_ips: 1,
    placeholder_resolver: 'fwmonitor',
    raw_template: 'fw monitor -F "{{src_ip}},{{src_port}},{{dst_ip}},{{dst_port}},{{proto}}" -F "{{dst_ip}},{{dst_port}},{{src_ip}},{{src_port}},{{proto}}"',
    name_pt: 'fw monitor', name_en: 'fw monitor',
    desc_pt: 'Captura nativa CP — visibilidade i/I/o/O', desc_en: 'Native CP capture — i/I/o/O visibility',
    desc_empty_pt: 'Preencha SRC e DST para gerar o filtro -F automaticamente', desc_empty_en: 'Fill in SRC and DST to automatically generate the -F filter',
    about_icon: '📡',
    about_purpose_pt: 'Captura tráfego em nível de kernel do Check Point com visibilidade nos 4 pontos do firewall: i (pré-inbound), I (pós-inbound), o (pré-outbound), O (pós-outbound). Permite ver se o pacote chega, é inspecionado e sai pelo firewall.',
    about_purpose_en: "Captures traffic at the Check Point kernel level with visibility at the firewall's 4 inspection points: i (pre-inbound), I (post-inbound), o (pre-outbound), O (post-outbound). Lets you see whether the packet arrives, gets inspected, and leaves through the firewall.",
    about_when_pt: 'Diagnóstico de conectividade, verificar se pacotes chegam ao firewall, identificar em qual ponto o tráfego é descartado ou modificado por NAT.',
    about_when_en: 'Connectivity diagnostics, verifying whether packets reach the firewall, identifying at which point traffic is dropped or modified by NAT.',
    about_obs_pt: 'Pacote aparece em i mas não em I = bloqueado pela policy. Aparece em I mas não em o = problema de roteamento. Salve com -w e analise no Wireshark.',
    about_obs_en: 'Packet appears in i but not in I = blocked by policy. Appears in I but not in o = routing problem. Save with -w and analyze in Wireshark.',
    tags: [['t-teal', 'PRINCIPAL', 'MAIN'], ['t-blue', 'NGFW', 'NGFW']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'fw monitor -F "{{src_ip}},{{src_port}},{{dst_ip}},{{dst_port}},{{proto}}" -F "{{dst_ip}},{{dst_port}},{{src_ip}},{{src_port}},{{proto}}"'),
      note('Pontos: i=pre-in · I=post-in · o=pre-out · O=post-out', 'Points: i=pre-in · I=post-in · o=pre-out · O=post-out'),
    ],
    linesEmpty: [
      info('Preencha IP Origem e IP Destino acima para gerar o comando completo com filtros -F', 'Fill in Source IP and Destination IP above to generate the full command with -F filters'),
      cmdLine(PR.FW, 'fw monitor -F "<SRC>,<SP>,<DST>,<DP>,<PROTO>" -F "<DST>,<DP>,<SRC>,<SP>,<PROTO>" -w /tmp/capture.pcap'),
      note('Pontos: i=pre-in · I=post-in · o=pre-out · O=post-out', 'Points: i=pre-in · I=post-in · o=pre-out · O=post-out'),
    ],
    diffs: [
      { version: 'R81.10 / R81.20', note_pt: 'Filtro -F bidirecional; flags -e/-i (legacy) não filtram tráfego SecureXL acelerado', note_en: 'Bidirectional -F filter; legacy -e/-i flags do not filter SecureXL-accelerated traffic',
        lines: [ cmdLine(PR.FW, 'fw monitor -F "{{src_ip}},{{src_port}},{{dst_ip}},{{dst_port}},{{proto}}" -F "{{dst_ip}},{{dst_port}},{{src_ip}},{{src_port}},{{proto}}"') ] },
      { version: 'R82 / R82.10 — flag -count (novo)', note_pt: 'Limita número de pacotes capturados para não encher disco', note_en: 'Limits the number of captured packets so as not to fill up disk space',
        lines: [
          cmdLine(PR.FW, 'fw monitor -F "{{src_ip}},{{src_port}},{{dst_ip}},{{dst_port}},{{proto}}" -F "{{dst_ip}},{{dst_port}},{{src_ip}},{{src_port}},{{proto}}" -count 500'),
          note('Não combine -e/-i com -F no R82+ — são incompatíveis (Admin Guide R82 p.320)', 'Do not combine -e/-i with -F on R82+ — they are incompatible (Admin Guide R82 p.320)'),
          cmdLine(PR.MHO, 'asg_cmd "fw monitor -F \\"{{src_ip}},{{src_port}},{{dst_ip}},{{dst_port}},{{proto}}\\" -F \\"{{dst_ip}},{{dst_port}},{{src_ip}},{{src_port}},{{proto}}\\" -w /tmp/cap_sgm.pcap"'),
        ] },
      { version: 'VSX — captura por Virtual System', note_pt: '', note_en: '',
        lines: [
          cmdLine(PR.FW, 'vsenv {{vsid}}'),
          cmdLine(PR.VS, 'fw monitor -F "{{src_ip}},{{src_port}},{{dst_ip}},{{dst_port}},{{proto}}" -F "{{dst_ip}},{{dst_port}},{{src_ip}},{{src_port}},{{proto}}"'),
          note('VS0 = contexto físico (chassis). fw monitor captura apenas no VS especificado.', 'VS0 = physical (chassis) context. fw monitor only captures within the specified VS.'),
        ] },
    ],
  },
  {
    id: 'tcpdump', topic: 'capture', icon: '🔬', sort_order: 2, requires_ips: 1,
    placeholder_resolver: 'tcpdump',
    raw_template: 'tcpdump -i {{iface}} -nn -s 0 "host {{src_ip}} and host {{dst_ip}}"',
    name_pt: 'tcpdump', name_en: 'tcpdump',
    desc_pt: 'Captura nível OS — complementar ao fw monitor', desc_en: 'OS-level capture — complements fw monitor',
    desc_empty_pt: 'Preencha SRC e DST para gerar o filtro de host', desc_empty_en: 'Fill in SRC and DST to generate the host filter',
    about_icon: '🔬',
    about_purpose_pt: 'Captura pacotes no nível da interface de rede do SO Gaia, antes da inspeção do kernel Check Point. Complementar ao fw monitor para comparar o que chega na interface vs o que o FW processa.',
    about_purpose_en: "Captures packets at the Gaia OS network interface level, before Check Point kernel inspection. Complements fw monitor for comparing what arrives at the interface vs. what the FW processes.",
    about_when_pt: 'Quando quiser confirmar que o pacote chegou fisicamente na interface, antes da inspeção do Check Point. Útil também para capturar tráfego de gerenciamento.',
    about_when_en: 'When you want to confirm the packet physically arrived at the interface, before Check Point inspection. Also useful for capturing management traffic.',
    about_obs_pt: 'tcpdump NÃO vê tráfego acelerado pelo SecureXL. Para tráfego de produção acelerado, use fw monitor.',
    about_obs_en: 'tcpdump does NOT see traffic accelerated by SecureXL. For accelerated production traffic, use fw monitor.',
    tags: [['t-yellow', 'OS-LEVEL', 'OS-LEVEL']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'tcpdump -i {{iface}} -nn -s 0 "host {{src_ip}} and host {{dst_ip}}"'),
      note('-nn = sem resolução DNS/porta · -s 0 = captura pacote completo', '-nn = no DNS/port resolution · -s 0 = capture full packet'),
    ],
    linesEmpty: [
      info('Preencha IP Origem e IP Destino acima para gerar o comando completo', 'Fill in Source IP and Destination IP above to generate the full command'),
      cmdLine(PR.FW, 'tcpdump -i any -nn -s 0 "host <SRC> and host <DST>"'),
      note('-nn = sem resolução DNS/porta · -s 0 = captura pacote completo', '-nn = no DNS/port resolution · -s 0 = capture full packet'),
    ],
    diffs: [],
  },

  // ════════════════════════════════════ DEBUG ════════════════════════════════════
  {
    id: 'zdebug', topic: 'debug', icon: '🚫', sort_order: 1, requires_ips: 1,
    placeholder_resolver: 'zdebug',
    raw_template: 'fw ctl zdebug + drop | grep -E "{{src_ip}}|{{dst_ip}}"',
    name_pt: 'fw ctl zdebug + drop', name_en: 'fw ctl zdebug + drop',
    desc_pt: 'Drops em tempo real — {{src_ip}} / {{dst_ip}}', desc_en: 'Real-time drops — {{src_ip}} / {{dst_ip}}',
    desc_empty_pt: 'Preencha SRC e DST para adicionar filtro grep automático', desc_empty_en: 'Fill in SRC and DST to add an automatic grep filter',
    about_icon: '🚫',
    about_purpose_pt: 'Exibe em tempo real os pacotes que estão sendo descartados pelo kernel do Check Point, com o motivo do drop. Essencial para identificar por que conexões estão sendo bloqueadas sem aparecer no log.',
    about_purpose_en: 'Shows in real time the packets being dropped by the Check Point kernel, along with the drop reason. Essential for identifying why connections are being blocked without appearing in the log.',
    about_when_pt: 'Quando fw log não mostra o drop, quando o cliente reclama de conectividade mas não aparece log, ou para identificar drops de SecureXL.',
    about_when_en: "When fw log doesn't show the drop, when the customer reports connectivity issues but nothing shows in the log, or to identify SecureXL drops.",
    about_obs_pt: 'Impacta performance em produção. Use em janela de manutenção ou em ambiente de homologação. Sempre encerre com: fw ctl debug 0',
    about_obs_en: 'Impacts performance in production. Use during a maintenance window or in a staging environment. Always finish with: fw ctl debug 0',
    tags: [['t-red', 'CUIDADO', 'CAUTION'], ['t-orange', 'KERNEL', 'KERNEL']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'fw ctl zdebug + drop | grep -E "{{src_ip}}|{{dst_ip}}"'),
      warn('zdebug impacta performance em produção — use em janela de manutenção!', 'zdebug impacts performance in production — use during a maintenance window!'),
    ],
    linesEmpty: [
      info('Preencha IP Origem e Destino acima para adicionar grep automático no output', 'Fill in Source and Destination IP above to add an automatic grep filter to the output'),
      cmdLine(PR.FW, 'fw ctl zdebug + drop'),
      warn('zdebug impacta performance em produção — use em janela de manutenção!', 'zdebug impacts performance in production — use during a maintenance window!'),
    ],
    diffs: [
      { version: 'R81.10 / R81.20 — fw ctl zdebug clássico', note_pt: '', note_en: '',
        lines: [ cmdLine(PR.FW, 'fw ctl zdebug + drop | grep -E "{{src_ip}}|{{dst_ip}}"') ] },
      { version: 'R82 / R82.10 — g_fw ctl zdebug (Maestro)', note_pt: 'Prefixo g_ propaga para todos SGMs (Admin Guide R82 p.335)', note_en: 'The g_ prefix propagates to all SGMs (Admin Guide R82 p.335)',
        lines: [
          cmdLine(PR.MHO, 'g_fw ctl zdebug + drop | grep -E "{{src_ip}}|{{dst_ip}}"'),
          note('Standalone/Cluster: use fw ctl zdebug sem prefixo g_', 'Standalone/Cluster: use fw ctl zdebug without the g_ prefix'),
        ] },
    ],
  },
  {
    id: 'kdebug', topic: 'debug', icon: '🐛', sort_order: 2, requires_ips: 1,
    placeholder_resolver: null,
    raw_template: 'fw ctl debug 0',
    name_pt: 'Kernel Debug — Procedimento Completo', name_en: 'Kernel Debug — Full Procedure',
    desc_pt: 'fw ctl kdebug / ndebug (R82+) — sequência oficial Admin Guide', desc_en: 'fw ctl kdebug / ndebug (R82+) — official Admin Guide sequence',
    about_icon: '🐛',
    about_purpose_pt: 'Coleta debug detalhado do módulo de firewall no kernel para análise de problemas complexos de conectividade, policy, NAT ou VPN. Gera arquivo de texto com o fluxo interno do pacote no kernel.',
    about_purpose_en: "Collects detailed debug from the kernel firewall module for analyzing complex connectivity, policy, NAT or VPN issues. Generates a text file with the packet's internal flow through the kernel.",
    about_when_pt: 'Quando zdebug não é suficiente, quando o TAC solicita kernel debug, ou para problemas de VPN, NAT incorreto e comportamentos inesperados de policy.',
    about_when_en: "When zdebug isn't enough, when TAC requests a kernel debug, or for VPN issues, incorrect NAT, and unexpected policy behavior.",
    about_obs_pt: 'No R82+, buffer reduziu de 32000 para 8200. Em GWs com 72+ cores, o debug vai para /var/log/debug.log* sem aparecer no terminal. Sempre execute fw ctl debug 0 ao terminar.',
    about_obs_en: 'On R82+, the buffer was reduced from 32000 to 8200. On GWs with 72+ cores, debug goes to /var/log/debug.log* without appearing in the terminal. Always run fw ctl debug 0 when finished.',
    tags: [['t-red', 'AVANÇADO', 'ADVANCED'], ['t-orange', 'MANUTENÇÃO', 'MAINTENANCE']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'fw ctl debug 0'),
      cmdLine(PR.FW, 'fwaccel dbg resetall'),
      cmdLine(PR.FW, 'fw ctl set int simple_debug_filter_off 1'),
      cmdLine(PR.FW, 'fw ctl debug -buf 8200'),
      cmdLine(PR.FW, 'fw ctl debug -m fw + conn drop'),
      cmdLine(PR.FW, 'fw ctl kdebug -T -f > /tmp/kdebug_{{src_ip}}.txt'),
      warn('Reproduza tráfego {{src_ip}} → {{dst_ip}}, pare com Ctrl+C e execute: fw ctl debug 0', 'Reproduce the {{src_ip}} → {{dst_ip}} traffic, stop with Ctrl+C and run: fw ctl debug 0'),
    ],
    linesEmpty: [
      cmdLine(PR.FW, 'fw ctl debug 0'),
      cmdLine(PR.FW, 'fwaccel dbg resetall'),
      cmdLine(PR.FW, 'fw ctl set int simple_debug_filter_off 1'),
      cmdLine(PR.FW, 'fw ctl debug -buf 8200'),
      cmdLine(PR.FW, 'fw ctl debug -m fw + conn drop'),
      cmdLine(PR.FW, 'fw ctl kdebug -T -f > /tmp/kdebug.txt'),
      warn('Reproduza o tráfego, pare com Ctrl+C e execute: fw ctl debug 0', 'Reproduce the traffic, stop with Ctrl+C and run: fw ctl debug 0'),
    ],
    diffs: [
      { version: 'R81.10 / R81.20 — buffer 32000 (legacy)', note_pt: '', note_en: '',
        lines: [
          cmdLine(PR.FW, 'fw ctl debug 0'),
          cmdLine(PR.FW, 'fw ctl debug -buf 32000'),
          cmdLine(PR.FW, 'fw ctl debug -m fw + conn drop'),
          cmdLine(PR.FW, 'fw ctl kdebug -T -f > /tmp/kdebug.txt'),
        ] },
      { version: 'R82 / R82.10 — buffer 8200 + ndebug', note_pt: 'Admin Guide R82 p.335-338 / R82.10 p.306-308', note_en: 'Admin Guide R82 p.335-338 / R82.10 p.306-308',
        lines: [
          cmdLine(PR.FW, 'fw ctl debug 0'),
          cmdLine(PR.FW, 'fwaccel dbg resetall'),
          cmdLine(PR.FW, 'fw ctl set int simple_debug_filter_off 1'),
          cmdLine(PR.FW, 'fw ctl debug -buf 8200'),
          cmdLine(PR.FW, 'fw ctl debug -m fw + conn drop'),
          cmdLine(PR.FW, 'fw ctl kdebug -T -f > /tmp/kdebug.txt'),
          note('GWs >=72 cores: saída vai para /var/log/debug.log* (nao aparece na tela em tempo real)', 'GWs with >=72 cores: output goes to /var/log/debug.log* (does not appear on screen in real time)'),
          note('GWs <72 cores: use fw ctl ndebug -T em vez de kdebug (disponível no R82+)', 'GWs with <72 cores: use fw ctl ndebug -T instead of kdebug (available in R82+)'),
        ] },
    ],
  },

  // ════════════════════════════════════ LOGS ════════════════════════════════════
  {
    id: 'fwlog', topic: 'logs', icon: '📋', sort_order: 1, requires_ips: 1,
    placeholder_resolver: 'fwlog',
    raw_template: 'fw log -n -s {{src_ip}} -d {{dst_ip}}',
    name_pt: 'fw log — Consulta com filtro SRC/DST', name_en: 'fw log — Query with SRC/DST filter',
    name_empty_pt: 'fw log — Consulta', name_empty_en: 'fw log — Query',
    desc_pt: 'Filtra conexões {{src_ip}} → {{dst_ip}} nos logs', desc_en: 'Filters {{src_ip}} → {{dst_ip}} connections in the logs',
    desc_empty_pt: 'Preencha SRC e DST para filtrar por IP automaticamente', desc_empty_en: 'Fill in SRC and DST to automatically filter by IP',
    about_icon: '📋',
    about_purpose_pt: 'Consulta os logs de firewall diretamente na linha de comando, filtrando por IP de origem e destino. Retorna conexões permitidas, negadas e drops com detalhes de regra, horário e ação.',
    about_purpose_en: 'Queries firewall logs directly from the command line, filtering by source and destination IP. Returns allowed, denied and dropped connections with rule, timestamp and action details.',
    about_when_pt: 'Verificar se uma conexão específica foi permitida ou negada, qual regra foi aplicada, e levantar histórico de comunicação entre dois hosts.',
    about_when_en: 'Checking whether a specific connection was allowed or denied, which rule was applied, and reviewing communication history between two hosts.',
    about_obs_pt: 'Use -c drop para ver apenas drops. Use -b e -e para limitar o intervalo de tempo. Em ambientes com muito volume de log, prefira o SmartConsole.',
    about_obs_en: 'Use -c drop to see only drops. Use -b and -e to limit the time range. In environments with high log volume, prefer SmartConsole.',
    tags: [['t-blue', 'CONSULTA', 'QUERY'], ['t-teal', 'LOGS', 'LOGS']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'fw log -n -s {{src_ip}} -d {{dst_ip}}'),
      cmdLine(PR.FW, 'fw log -n -s {{src_ip}} -d {{dst_ip}} -c drop'),
      note('-n · -s SRC · -d DST · -c drop · -b "DD-Mon-YYYY 00:00:00" -e "DD-Mon-YYYY 23:59:59"', '-n · -s SRC · -d DST · -c drop · -b "DD-Mon-YYYY 00:00:00" -e "DD-Mon-YYYY 23:59:59"'),
    ],
    linesEmpty: [
      info('Preencha IP Origem e Destino para gerar filtros -s / -d automáticos', 'Fill in Source and Destination IP to generate automatic -s / -d filters'),
      cmdLine(PR.FW, 'fw log -n'),
      note('-n=sem resolução · -c drop=apenas drops · -b/-e=intervalo de datas', '-n=no resolution · -c drop=drops only · -b/-e=date range'),
    ],
    diffs: [],
  },
  {
    id: 'lslogs', topic: 'logs', icon: '📂', sort_order: 2, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'fw lslogs',
    name_pt: 'fw lslogs — Listar arquivos de log', name_en: 'fw lslogs — List log files',
    desc_pt: 'Lista todos os arquivos de log disponíveis', desc_en: 'Lists all available log files',
    about_icon: '📂',
    about_purpose_pt: 'Lista todos os arquivos de log disponíveis no diretório $FWDIR/log/, incluindo logs ativos e rotacionados, com data e tamanho.',
    about_purpose_en: 'Lists all log files available in the $FWDIR/log/ directory, including active and rotated logs, with date and size.',
    about_when_pt: 'Antes de usar fw log ou fwm logexport, para identificar o arquivo correto de log de um período específico.',
    about_when_en: 'Before using fw log or fwm logexport, to identify the correct log file for a specific period.',
    about_obs_pt: 'O arquivo ativo é sempre fw.log. Arquivos rotacionados têm o formato YYYY-MM-DD_HHMMSSfwlog.log',
    about_obs_en: 'The active file is always fw.log. Rotated files use the format YYYY-MM-DD_HHMMSSfwlog.log',
    tags: [['t-yellow', 'LIST', 'LIST']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'fw lslogs'),
      cmdLine(PR.FW, 'ls -lh $FWDIR/log/*.log*'),
      note('fw lslogs: lista arquivos de log disponíveis em $FWDIR/log/', 'fw lslogs: lists available log files in $FWDIR/log/'),
    ],
    diffs: [],
  },
  {
    id: 'logswitch', topic: 'logs', icon: '🔄', sort_order: 3, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'fw logswitch',
    name_pt: 'fw logswitch — Rotacionar log ativo', name_en: 'fw logswitch — Rotate active log',
    desc_pt: 'Fecha o log ativo e abre um novo (log rotation)', desc_en: 'Closes the active log and opens a new one (log rotation)',
    about_icon: '🔄',
    about_purpose_pt: 'Força a rotação do log ativo: fecha o arquivo fw.log atual e abre um novo. Útil antes de exportar logs ou quando o arquivo ficou muito grande.',
    about_purpose_en: 'Forces rotation of the active log: closes the current fw.log file and opens a new one. Useful before exporting logs or when the file has grown too large.',
    about_when_pt: 'Antes de exportar logs de um período específico, ou quando o arquivo de log ativo cresceu demais e está impactando o disco.',
    about_when_en: 'Before exporting logs for a specific period, or when the active log file has grown too much and is impacting disk space.',
    about_obs_pt: 'Cria um gap mínimo de log durante a rotação. Use fw logswitch -audit para rotacionar o log de auditoria administrativo.',
    about_obs_en: 'Creates a minimal log gap during rotation. Use fw logswitch -audit to rotate the administrative audit log.',
    tags: [['t-orange', 'ROTATE', 'ROTATE'], ['t-yellow', 'MANUTENÇÃO', 'MAINTENANCE']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'fw logswitch'),
      cmdLine(PR.FW, 'fw logswitch -audit'),
      note('fw logswitch: fecha o log ativo e abre um novo · -audit rotaciona o log de auditoria', 'fw logswitch: closes the active log and opens a new one · -audit rotates the audit log'),
      warn('Cria gap mínimo de log durante a rotação — use em janela de manutenção', 'Creates a minimal log gap during rotation — use during a maintenance window'),
    ],
    diffs: [],
  },
  {
    id: 'logexport', topic: 'logs', icon: '📤', sort_order: 4, requires_ips: 1,
    placeholder_resolver: 'logexport',
    raw_template: 'fwm logexport -n -i $FWDIR/log/fw.log -o /tmp/export.txt -p -d ";"',
    name_pt: 'fwm logexport — Exportar log para texto/CSV', name_en: 'fwm logexport — Export log to text/CSV',
    desc_pt: 'Exporta log binário CP para CSV/texto legível', desc_en: 'Exports the binary CP log to readable CSV/text',
    about_icon: '📤',
    about_purpose_pt: 'Exporta os logs binários do Check Point para um arquivo texto ou CSV delimitado, permitindo análise em Excel, SIEM ou scripts. Com SRC e DST preenchidos, adiciona filtro por IP de origem e destino.',
    about_purpose_en: "Exports Check Point's binary logs to a delimited text or CSV file, enabling analysis in Excel, SIEM or scripts. With SRC and DST filled in, it adds a source/destination IP filter.",
    about_when_pt: 'Extrair logs para análise externa, envio ao cliente, integração com SIEM, ou quando o SmartConsole não está disponível.',
    about_when_en: "Extracting logs for external analysis, sending to the customer, SIEM integration, or when SmartConsole isn't available.",
    about_obs_pt: 'Use -d ; para separar por ponto-e-vírgula (compatível com Excel pt-BR). Use -n para evitar resolução DNS que pode ser lenta.',
    about_obs_en: 'Use -d ; to separate with semicolons (compatible with pt-BR Excel). Use -n to avoid DNS resolution, which can be slow.',
    tags: [['t-teal', 'EXPORT', 'EXPORT']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'fwm logexport -n -i $FWDIR/log/fw.log -o /tmp/fw_export.txt -p -d ";"'),
      note('-n=sem resolução · -i=arquivo de log · -o=saída · -p=cabeçalho · -d=delimitador', '-n=no resolution · -i=log file · -o=output · -p=header · -d=delimiter'),
      cmdLine(PR.FW, 'fwm logexport -n -i $FWDIR/log/fw.log -o /tmp/fw_export.txt -p -d ";" -s {{src_ip}} -e {{dst_ip}}'),
      note('-s/-e: filtro por IP de origem/destino durante a exportação', '-s/-e: filter by source/destination IP during export'),
    ],
    linesEmpty: [
      cmdLine(PR.FW, 'fwm logexport -n -i $FWDIR/log/fw.log -o /tmp/fw_export.txt -p -d ";"'),
      note('-n=sem resolução · -i=arquivo de log · -o=saída · -p=cabeçalho · -d=delimitador', '-n=no resolution · -i=log file · -o=output · -p=header · -d=delimiter'),
    ],
    diffs: [],
  },
  {
    id: 'fetchlogs', topic: 'logs', icon: '📥', sort_order: 5, requires_ips: 1,
    placeholder_resolver: 'fetchlogs',
    raw_template: 'fw fetchlogs {{src_ip}}',
    name_pt: 'fw fetchlogs — Buscar logs do GW (SMS)', name_en: 'fw fetchlogs — Fetch GW logs (SMS)',
    desc_pt: 'Busca logs pendentes do gateway {{src_ip}}', desc_en: 'Fetches pending logs from gateway {{src_ip}}',
    desc_empty_pt: 'Preencha IP Origem com o IP do gateway', desc_empty_en: "Fill in Source IP with the gateway's IP",
    about_icon: '📥',
    about_purpose_pt: 'Executa no Management Server para buscar logs pendentes que o gateway ainda não enviou. Sincroniza o log local do gateway com o servidor de logs.',
    about_purpose_en: "Runs on the Management Server to fetch pending logs the gateway hasn't sent yet. Syncs the gateway's local log with the log server.",
    about_when_pt: 'Quando o gateway ficou offline por um período e os logs do intervalo não aparecem no SmartConsole, ou após recuperação de uma queda de link.',
    about_when_en: "When the gateway was offline for a period and the logs from that interval don't appear in SmartConsole, or after recovering from a link outage.",
    about_obs_pt: 'Execute no SMS ou MDS, não no gateway. O IP informado é o endereço do gateway de onde se quer buscar os logs.',
    about_obs_en: "Run on the SMS or MDS, not on the gateway. The IP provided is the address of the gateway you want to fetch logs from.",
    tags: [['t-purple', 'FETCH', 'FETCH'], ['t-blue', 'SMS', 'SMS']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.SMS, 'fw fetchlogs {{src_ip}}'),
      note('Execute no Management Server para buscar logs pendentes do gateway', 'Run on the Management Server to fetch pending logs from the gateway'),
    ],
    linesEmpty: [
      info('Preencha IP Origem com o IP do gateway para completar o comando', "Fill in Source IP with the gateway's IP to complete the command"),
      cmdLine(PR.SMS, 'fw fetchlogs <IP-DO-GATEWAY>'),
      note('Execute no Management Server para buscar logs pendentes do gateway', 'Run on the Management Server to fetch pending logs from the gateway'),
    ],
    diffs: [],
  },
  {
    id: 'services', topic: 'logs', icon: '⚙️', sort_order: 6, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'cpwd_admin list',
    name_pt: 'cpstop / cpstart / cprestart — Serviços CP', name_en: 'cpstop / cpstart / cprestart — CP Services',
    desc_pt: 'Start, stop e restart (incluindo Log Daemon FWD)', desc_en: 'Start, stop and restart (including the Log Daemon FWD)',
    about_icon: '⚙️',
    about_purpose_pt: 'Controla todos os serviços do Check Point no gateway: cpstop para tudo (tráfego bloqueado), cpstart inicia tudo, cprestart faz restart graceful sem interromper tráfego imediatamente.',
    about_purpose_en: 'Controls all Check Point services on the gateway: cpstop stops everything (traffic blocked), cpstart starts everything, cprestart performs a graceful restart without immediately interrupting traffic.',
    about_when_pt: 'Após mudanças de configuração que exigem restart, troubleshooting de processos travados, ou para aplicar novas licenças.',
    about_when_en: 'After configuration changes that require a restart, troubleshooting stuck processes, or to apply new licenses.',
    about_obs_pt: 'Em cluster, execute no membro standby primeiro. cpstop derruba o tráfego instantaneamente — prefira cprestart em produção.',
    about_obs_en: 'On a cluster, run on the standby member first. cpstop drops traffic instantly — prefer cprestart in production.',
    tags: [['t-red', 'CUIDADO', 'CAUTION'], ['t-orange', 'SERVIÇOS', 'SERVICES']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'cpstop'),
      cmdLine(PR.FW, 'cpstart'),
      warn('cpstop bloqueia TODOS os tráfegos. Em cluster pode causar failover! (Admin Guide R82.10 p.96)', 'cpstop blocks ALL traffic. On a cluster it can cause a failover! (Admin Guide R82.10 p.96)'),
      cmdLine(PR.FW, 'cprestart'),
      note('cprestart: restart graceful dos serviços CP (Admin Guide R82 p.96)', 'cprestart: graceful restart of CP services (Admin Guide R82 p.96)'),
    ],
    diffs: [
      { version: 'R82 / R82.10 — Scalable Platform (Maestro/Chassis)', note_pt: 'Admin Guide R82 p.115', note_en: 'Admin Guide R82 p.115',
        lines: [ cmdLine(PR.MHO, 'g_all cprestart'), warn('g_all cprestart bloqueia tráfego em todos os SGMs simultaneamente', 'g_all cprestart blocks traffic on all SGMs simultaneously') ] },
      { version: 'R82 — após mudança em fwauthd.conf', note_pt: 'Admin Guide R82 p.235', note_en: 'Admin Guide R82 p.235',
        lines: [
          cmdLine(PR.FW, 'vi $FWDIR/conf/fwauthd.conf'),
          cmdLine(PR.FW, 'cpstop ; cpstart'),
          note('Após qualquer mudança em fwauthd.conf o restart é obrigatório', 'A restart is required after any change to fwauthd.conf'),
        ] },
    ],
  },
  {
    id: 'watchdog', topic: 'logs', icon: '🐕', sort_order: 7, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'cpwd_admin list',
    name_pt: 'cpwd_admin — WatchDog & Processos', name_en: 'cpwd_admin — WatchDog & Processes',
    desc_pt: 'Status e controle de processos individuais (FWD, FWSSD...)', desc_en: 'Status and control of individual processes (FWD, FWSSD...)',
    about_icon: '🐕',
    about_purpose_pt: 'Controla o WatchDog do Check Point, que monitora e reinicia processos automaticamente. Permite listar, iniciar e parar processos individuais (FWD, FWSSD, CPCA) sem derrubar todos os serviços.',
    about_purpose_en: 'Controls the Check Point WatchDog, which monitors and automatically restarts processes. Lets you list, start and stop individual processes (FWD, FWSSD, CPCA) without bringing down all services.',
    about_when_pt: 'Quando um processo específico travou ou está consumindo recursos, e você quer reiniciá-lo sem executar cpstop/cpstart completo.',
    about_when_en: 'When a specific process is stuck or consuming resources and you want to restart it without running a full cpstop/cpstart.',
    about_obs_pt: 'cpwd_admin list mostra o estado de cada processo. MONITOR = processo monitorado pelo WatchDog. DEAD = processo que o WatchDog nao conseguiu iniciar.',
    about_obs_en: 'cpwd_admin list shows the state of each process. MONITOR = process monitored by WatchDog. DEAD = process WatchDog was unable to start.',
    tags: [['t-yellow', 'WATCHDOG', 'WATCHDOG']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'cpwd_admin list'),
      cmdLine(PR.FW, 'cpwd_admin start -name FWD -path "$FWDIR/bin/fwd" -command "fwd"'),
      cmdLine(PR.FW, 'cpwd_admin stop -name FWD -path "$FWDIR/bin/fwd"'),
      note('cpwd_admin list: lista processos gerenciados pelo WatchDog e seus status', 'cpwd_admin list: lists processes managed by the WatchDog and their status'),
      note('FWD = processo pai dos Security Servers (Log Daemon)', 'FWD = parent process of the Security Servers (Log Daemon)'),
    ],
    diffs: [],
  },
  {
    id: 'syslog', topic: 'logs', icon: '📡', sort_order: 8, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'show syslog all',
    name_pt: 'Syslog Gaia — Configuração via Clish', name_en: 'Syslog Gaia — Configuration via Clish',
    desc_pt: 'set syslog, show syslog, envio ao Management Server', desc_en: 'set syslog, show syslog, sending to the Management Server',
    about_icon: '📡',
    about_purpose_pt: 'Configura o envio de logs do sistema operacional Gaia para servidores externos (SIEM, syslog server) e para o Management Server. Controla quais eventos são enviados.',
    about_purpose_en: 'Configures sending Gaia OS logs to external servers (SIEM, syslog server) and to the Management Server. Controls which events are sent.',
    about_when_pt: 'Integração com SIEM, auditoria de acesso administrativo ao Gaia, ou quando o cliente precisa de logs de sistema centralizados.',
    about_when_en: 'SIEM integration, auditing administrative access to Gaia, or when the customer needs centralized system logs.',
    about_obs_pt: 'set syslog cplogs on envia logs CP ao Management. set syslog mgmtauditlogs on envia mudanças de config. Sempre execute save config após alterar.',
    about_obs_en: 'set syslog cplogs on sends CP logs to Management. set syslog mgmtauditlogs on sends config changes. Always run save config after making changes.',
    tags: [['t-blue', 'SYSLOG', 'SYSLOG'], ['t-green', 'GAIA', 'GAIA']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.GAIA, 'show syslog all'),
      cmdLine(PR.GAIA, 'set syslog cplogs on'),
      cmdLine(PR.GAIA, 'set syslog mgmtauditlogs on'),
      cmdLine(PR.GAIA, 'set syslog filename /var/log/system_logs.txt'),
      cmdLine(PR.GAIA, 'set syslog log-remote-address 192.168.1.1 level all'),
      cmdLine(PR.GAIA, 'save config'),
      note('set syslog cplogs on: envia syslog Gaia ao Management Server (Admin Guide R81.10 p.379)', 'set syslog cplogs on: sends Gaia syslog to the Management Server (Admin Guide R81.10 p.379)'),
    ],
    diffs: [],
  },
  {
    id: 'logfiles', topic: 'logs', icon: '🗂️', sort_order: 9, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'ls -lh $FWDIR/log/',
    name_pt: 'Arquivos de Log do Sistema', name_en: 'System Log Files',
    desc_pt: 'Localização dos principais arquivos de log e debug', desc_en: 'Location of the main log and debug files',
    about_icon: '🗂️',
    about_purpose_pt: 'Localização e acesso direto aos principais arquivos de log do sistema Gaia e do Check Point: syslog, debug de kernel, logs de processos (.elg) e kernel firewall.',
    about_purpose_en: 'Location and direct access to the main Gaia system and Check Point log files: syslog, kernel debug, process logs (.elg), and FW kernel.',
    about_when_pt: 'Análise de falhas de processos CP, problemas de inicialização, erros de instalação de policy, ou quando o TAC solicita arquivos de log específicos.',
    about_when_en: 'Analyzing CP process failures, startup issues, policy installation errors, or when TAC requests specific log files.',
    about_obs_pt: 'Arquivos .elg contêm logs de processos CP individuais. O arquivo fwk.elg é o log interno do kernel FW. Em produção, monitore o tamanho desses arquivos.',
    about_obs_en: '.elg files contain individual CP process logs. The fwk.elg file is the internal FW kernel log. In production, monitor the size of these files.',
    tags: [['t-purple', 'FILES', 'FILES']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'ls -lh $FWDIR/log/*.log*'),
      cmdLine(PR.FW, 'tail -f /var/log/messages'),
      cmdLine(PR.FW, 'tail -f /var/log/kernel_debug.txt'),
      cmdLine(PR.FW, 'ls -lh $FWDIR/log/*.elg'),
      note('$FWDIR/log/fwk.elg: log interno do kernel FW (Admin Guide R82 p.341)', '$FWDIR/log/fwk.elg: internal FW kernel log (Admin Guide R82 p.341)'),
      note('*.elg = log de processos CP (fwd, ahttpd, aftpd ...) — Admin Guide R82 p.237-246', '*.elg = CP process logs (fwd, ahttpd, aftpd ...) — Admin Guide R82 p.237-246'),
    ],
    diffs: [],
  },

  // ════════════════════════════════════ POLICY ════════════════════════════════════
  {
    id: 'policy', topic: 'policy', icon: '📜', sort_order: 1, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'fw stat',
    name_pt: 'fw stat / fw fetch', name_en: 'fw stat / fw fetch',
    desc_pt: 'Policy instalada e re-install do management', desc_en: 'Installed policy and management re-install',
    about_icon: '📜',
    about_purpose_pt: 'fw stat mostra o nome da policy instalada atualmente e o timestamp de instalação. fw fetch local reinstala a policy do Management local sem precisar abrir o SmartConsole.',
    about_purpose_en: 'fw stat shows the name of the currently installed policy and the installation timestamp. fw fetch local reinstalls the policy from the local Management without needing to open SmartConsole.',
    about_when_pt: 'Verificar qual policy está ativa no gateway, confirmar se a última instalação funcionou, ou reinstalar após falha de comunicação com o Management.',
    about_when_en: 'Checking which policy is active on the gateway, confirming the last install worked, or reinstalling after a communication failure with Management.',
    about_obs_pt: 'Se fw stat retornar vazio ou policy errada, execute fw fetch local. Em cluster, execute em ambos os membros.',
    about_obs_en: "If fw stat returns empty or the wrong policy, run fw fetch local. On a cluster, run on both members.",
    tags: [['t-yellow', 'POLICY', 'POLICY']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'fw stat'),
      cmdLine(PR.FW, 'fw fetch local'),
      note('fw stat: nome da policy + timestamp · fw fetch local: reinstala do Management local', 'fw stat: policy name + timestamp · fw fetch local: reinstalls from the local Management'),
    ],
    diffs: [],
  },

  // ════════════════════════════════════ TABLES ════════════════════════════════════
  {
    id: 'conntable', topic: 'tables', icon: '🗄️', sort_order: 1, requires_ips: 1,
    placeholder_resolver: 'conntable',
    raw_template: 'fw tab -t connections -f',
    name_pt: 'fw tab — Conexões (filtro SRC/DST)', name_en: 'fw tab — Connections (SRC/DST filter)',
    desc_pt: 'Filtra {{src_ip}} ↔ {{dst_ip}} na tabela de conexões', desc_en: 'Filters {{src_ip}} ↔ {{dst_ip}} in the connections table',
    about_icon: '🗄️',
    about_purpose_pt: 'Consulta a tabela de estado de conexões no kernel do Check Point. Com filtro SRC/DST mostra apenas as entradas correspondentes ao par informado. Conexões presentes aqui estão ativas no kernel em tempo real.',
    about_purpose_en: 'Queries the connections state table in the Check Point kernel. With an SRC/DST filter it shows only the entries matching the given pair. Connections present here are active in the kernel in real time.',
    about_when_pt: 'Verificar se uma conexão específica está estabelecida no kernel, confirmar que o estado TCP está correto, ou ver quantas sessões existem entre dois hosts.',
    about_when_en: 'Checking whether a specific connection is established in the kernel, confirming the TCP state is correct, or seeing how many sessions exist between two hosts.',
    about_obs_pt: 'Tabela de conexões é no kernel, independente do que o log mostra. Se aparece aqui mas não no log, pode ser tráfego acelerado pelo SecureXL.',
    about_obs_en: "The connections table lives in the kernel, independent of what the log shows. If it appears here but not in the log, it may be traffic accelerated by SecureXL.",
    tags: [['t-blue', 'ESTADO', 'STATE']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'fw tab -t connections -f | grep -E "({{src_ip}}).*({{dst_ip}})|({{dst_ip}}).*({{src_ip}})"'),
      note('fw tab -t connections -s: estatísticas (tamanho, limite, uso atual)', 'fw tab -t connections -s: statistics (size, limit, current usage)'),
    ],
    diffs: [],
  },
  {
    id: 'nattable', topic: 'tables', icon: '🔀', sort_order: 2, requires_ips: 1,
    placeholder_resolver: 'nattable',
    raw_template: 'fw tab -t fwx_cache -f',
    name_pt: 'fw tab — NAT com filtro SRC/DST', name_en: 'fw tab — NAT with SRC/DST filter',
    desc_pt: 'Traduções NAT ativas no kernel filtradas por IP', desc_en: 'Active NAT translations in the kernel, filtered by IP',
    about_icon: '🔀',
    about_purpose_pt: 'Consulta a tabela fwx_cache que armazena as traduções NAT ativas no kernel. Com filtro SRC/DST mostra o IP original e traduzido. Sem filtro mostra estatísticas gerais da tabela de NAT.',
    about_purpose_en: 'Queries the fwx_cache table that stores active NAT translations in the kernel. With an SRC/DST filter it shows the original and translated IP. Without a filter it shows general NAT table statistics.',
    about_when_pt: 'Verificar se NAT está sendo aplicado corretamente, identificar qual IP traduzido está sendo usado, ou debugar problemas de NAT assimétrico.',
    about_when_en: 'Checking whether NAT is being applied correctly, identifying which translated IP is being used, or debugging asymmetric NAT issues.',
    about_obs_pt: 'Se a entrada NAT aparece aqui mas a conexão não funciona, verifique roteamento de retorno. NAT Hide aparece como uma entrada por conexão.',
    about_obs_en: "If the NAT entry appears here but the connection doesn't work, check the return routing. NAT Hide appears as one entry per connection.",
    tags: [['t-blue', 'NAT', 'NAT']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'fw tab -t fwx_cache -f | grep -E "{{src_ip}}|{{dst_ip}}"'),
      note('fwx_cache: tabela de traduções NAT ativas no kernel', 'fwx_cache: table of active NAT translations in the kernel'),
    ],
    diffs: [],
  },
  {
    id: 'connstats', topic: 'tables', icon: '📊', sort_order: 3, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'fw tab -t connections -s',
    name_pt: 'fw tab — Estatísticas de Conexões', name_en: 'fw tab — Connection Statistics',
    desc_pt: 'Total de conexões, limite e pico — sem filtro de IP', desc_en: 'Total connections, limit and peak — no IP filter',
    about_icon: '📊',
    about_purpose_pt: 'Mostra as estatísticas gerais da tabela de conexões: total de entradas atuais, limite máximo, pico histórico e uso percentual. Não requer filtragem por IP.',
    about_purpose_en: "Shows general connections table statistics: current total entries, maximum limit, historical peak, and percentage usage. Doesn't require IP filtering.",
    about_when_pt: 'Monitorar uso da tabela de conexões, verificar se o gateway está próximo do limite — o que pode causar drops por out of connections.',
    about_when_en: 'Monitoring connections table usage, checking whether the gateway is near the limit — which can cause out-of-connections drops.',
    about_obs_pt: 'Se o valor atual estiver próximo do limite, há risco de drops por capacidade da tabela. Aumente via fw ctl set int fw_conn_table_limit (temporário) ou pelo SmartConsole.',
    about_obs_en: "If the current value is close to the limit, there's a risk of drops due to table capacity. Increase it via fw ctl set int fw_conn_table_limit (temporary) or through SmartConsole.",
    tags: [['t-blue', 'ESTADO', 'STATE']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'fw tab -t connections -s'),
      cmdLine(PR.FW, 'fw tab -t connections -s | grep -E "limit|peak|val"'),
      note('-s: estatísticas (tamanho, limite, pico). Para filtrar por IP preencha SRC e DST acima.', '-s: statistics (size, limit, peak). To filter by IP, fill in SRC and DST above.'),
    ],
    diffs: [],
  },
  {
    id: 'natstats', topic: 'tables', icon: '🔀', sort_order: 4, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'fw tab -t fwx_cache -s',
    name_pt: 'fw tab — Estatísticas NAT (fwx_cache)', name_en: 'fw tab — NAT Statistics (fwx_cache)',
    desc_pt: 'Tabela de NAT — estatísticas gerais sem filtro de IP', desc_en: 'NAT table — general statistics without IP filter',
    about_icon: '🔀',
    about_purpose_pt: 'Mostra as estatísticas gerais da tabela de NAT (fwx_cache): total de entradas ativas, limite e pico. Útil para dimensionar o cache de NAT e identificar exaustão.',
    about_purpose_en: 'Shows general NAT table (fwx_cache) statistics: total active entries, limit and peak. Useful for sizing the NAT cache and identifying exhaustion.',
    about_when_pt: 'Quando houver suspeita de problemas de NAT por exaustão da tabela, ou para monitorar uso em ambientes com alto volume de NAT Hide.',
    about_when_en: "When there's a suspicion of NAT issues due to table exhaustion, or to monitor usage in environments with high NAT Hide volume.",
    about_obs_pt: 'Tabela cheia pode causar falhas silenciosas de NAT. O tamanho é configurável via SmartConsole em Gateway Properties > Advanced.',
    about_obs_en: 'A full table can cause silent NAT failures. Size is configurable via SmartConsole under Gateway Properties > Advanced.',
    tags: [['t-blue', 'NAT', 'NAT']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'fw tab -t fwx_cache -s'),
      note('fwx_cache: tabela de traduções NAT ativas no kernel. Para filtrar por IP preencha SRC e DST.', 'fwx_cache: table of active NAT translations in the kernel. To filter by IP, fill in SRC and DST.'),
    ],
    diffs: [],
  },

  // ════════════════════════════════════ ROUTING ════════════════════════════════════
  {
    id: 'routespecific', topic: 'routing', icon: '🌐', sort_order: 1, requires_ips: 1,
    placeholder_resolver: 'routespecific',
    raw_template: 'ip route get {{dst_ip}}',
    name_pt: 'ip route get {{dst_ip}} — Rota específica', name_en: 'ip route get {{dst_ip}} — Specific route',
    desc_pt: 'Rota e ARP para o destino {{dst_ip}}', desc_en: 'Route and ARP for destination {{dst_ip}}',
    about_icon: '🌐',
    about_purpose_pt: 'Verifica exatamente qual rota o kernel usará para alcançar o IP de destino, qual interface de saída e qual gateway de próximo salto. Verifica ARP e tabela de roteamento completa.',
    about_purpose_en: 'Checks exactly which route the kernel will use to reach the destination IP, which output interface, and which next-hop gateway. Checks ARP and the full routing table.',
    about_when_pt: 'Confirmar que o roteamento está correto para o destino, identificar interface de saída, ou verificar se o next-hop está acessível via ARP.',
    about_when_en: "Confirming routing is correct for the destination, identifying the output interface, or checking whether the next hop is reachable via ARP.",
    about_obs_pt: 'ip route get simula a decisão de roteamento real do kernel — mais confiável que netstat -rn para ver qual rota será usada efetivamente.',
    about_obs_en: "ip route get simulates the kernel's actual routing decision — more reliable than netstat -rn for seeing which route will actually be used.",
    tags: [['t-teal', 'ROUTING', 'ROUTING']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'ip route get {{dst_ip}}'),
      cmdLine(PR.FW, 'arp -n | grep {{dst_ip}}'),
      cmdLine(PR.FW, 'netstat -rn | grep {{dst_ip}}'),
      note('netstat disponível como ext_netstat em Gaia Clish (Admin Guide R81.10 p.449)', 'netstat is available as ext_netstat in Gaia Clish (Admin Guide R81.10 p.449)'),
      cmdLine(PR.GAIA, 'show route'),
      cmdLine(PR.GAIA, 'show arp'),
    ],
    diffs: [],
  },
  {
    id: 'routegeneral', topic: 'routing', icon: '🌐', sort_order: 2, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'ip route show',
    name_pt: 'Tabela de Rotas & ARP — Geral', name_en: 'Route & ARP Table — General',
    desc_pt: 'Visualize toda a tabela de rotas sem filtro de IP', desc_en: 'View the entire routing table without an IP filter',
    about_icon: '🌐',
    about_purpose_pt: 'Exibe a tabela de roteamento completa e a tabela ARP do gateway. No Gaia Clish, show route e show arp fornecem as mesmas informações em formato mais legível.',
    about_purpose_en: "Displays the full routing table and the gateway's ARP table. In Gaia Clish, show route and show arp provide the same information in a more readable format.",
    about_when_pt: 'Auditoria de rotas, verificar presença de rota default, identificar interfaces ativas, ou confirmar entradas ARP de next-hops.',
    about_when_en: 'Route auditing, checking for a default route, identifying active interfaces, or confirming ARP entries for next hops.',
    about_obs_pt: 'Para verificar a rota específica de um destino, preencha o IP Destino acima e use o comando ip route get gerado automaticamente.',
    about_obs_en: 'To check the specific route for a destination, fill in the Destination IP above and use the automatically generated ip route get command.',
    tags: [['t-teal', 'ROUTING', 'ROUTING']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'netstat -rn'),
      cmdLine(PR.FW, 'ip route show'),
      cmdLine(PR.FW, 'arp -n'),
      cmdLine(PR.GAIA, 'show route'),
      cmdLine(PR.GAIA, 'show arp'),
      note('Para rota específica até um host, preencha o IP Destino acima', 'For a specific route to a host, fill in the Destination IP above'),
    ],
    diffs: [],
  },

  // ════════════════════════════════════ STATUS ════════════════════════════════════
  {
    id: 'status', topic: 'status', icon: '📊', sort_order: 1, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'cpstat fw',
    name_pt: 'cpstat / cpview / cphaprob', name_en: 'cpstat / cpview / cphaprob',
    desc_pt: 'Status do FW, SO e blades em tempo real', desc_en: 'Real-time FW, OS and blade status',
    about_icon: '📊',
    about_purpose_pt: 'cpstat fw mostra estatísticas do módulo firewall. cpstat os mostra CPU, memória e disco. cpview é um dashboard interativo em tempo real. cphaprob stat mostra estado do cluster.',
    about_purpose_en: 'cpstat fw shows firewall module statistics. cpstat os shows CPU, memory and disk. cpview is a real-time interactive dashboard. cphaprob stat shows cluster state.',
    about_when_pt: 'Monitoramento geral de saúde do gateway, verificação de carga (CPU/memória/conexões), diagnóstico inicial antes de qualquer troubleshooting.',
    about_when_en: 'General gateway health monitoring, checking load (CPU/memory/connections), initial diagnostics before any troubleshooting.',
    about_obs_pt: 'cpview é o melhor ponto de partida para diagnóstico: mostra throughput, conexões, CPU por core e estado do SecureXL. Pressione ? dentro do cpview para ajuda.',
    about_obs_en: 'cpview is the best starting point for diagnostics: shows throughput, connections, CPU per core and SecureXL state. Press ? inside cpview for help.',
    tags: [['t-teal', 'STATUS', 'STATUS']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'cpstat fw'),
      cmdLine(PR.FW, 'cpstat os'),
      cmdLine(PR.FW, 'cpview'),
      cmdLine(PR.GAIA, 'show asset all'),
      cmdLine(PR.GAIA, 'cpstat os -f sensors'),
      note('cpstat os -f sensors: temperatura e saúde HW (Admin Guide R81.10 p.587)', 'cpstat os -f sensors: temperature and HW health (Admin Guide R81.10 p.587)'),
    ],
    diffs: [
      { version: 'R82 / R82.10 — cpstat https_inspection', note_pt: 'Admin Guide R82 p.100 / R82.10 p.102', note_en: 'Admin Guide R82 p.100 / R82.10 p.102',
        lines: [
          cmdLine(PR.FW, 'cpstat https_inspection -f all'),
          cmdLine(PR.MHO, 'g_all cpstat https_inspection -f all'),
          note('g_all: propaga para todo o Security Group (Maestro/Chassis)', 'g_all: propagates to the entire Security Group (Maestro/Chassis)'),
        ] },
    ],
  },

  // ════════════════════════════════════ SECUREXL ════════════════════════════════════
  {
    id: 'securexlstat', topic: 'securexl', icon: '⚡', sort_order: 1, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'fwaccel stat',
    name_pt: 'fwaccel stat / stats', name_en: 'fwaccel stat / stats',
    desc_pt: 'Estado do SecureXL e estatísticas de aceleração', desc_en: 'SecureXL state and acceleration statistics',
    about_icon: '⚡',
    about_purpose_pt: 'fwaccel stat mostra se o SecureXL está ativo e o modo de operação. fwaccel stats -s mostra estatísticas de pacotes acelerados vs inspecionados. Essencial para entender se o tráfego está no caminho acelerado.',
    about_purpose_en: "fwaccel stat shows whether SecureXL is active and its operating mode. fwaccel stats -s shows statistics of accelerated vs. inspected packets. Essential for understanding whether traffic is on the accelerated path.",
    about_when_pt: 'Verificar se SecureXL está ativo, confirmar que tráfego está sendo acelerado, ou antes de fazer debug (tráfego acelerado não aparece em fw monitor com -e/-i).',
    about_when_en: "Checking whether SecureXL is active, confirming traffic is being accelerated, or before doing debug (accelerated traffic doesn't show up in fw monitor with -e/-i).",
    about_obs_pt: 'Se SecureXL estiver ativo, capturas com fw monitor -e/-i podem não capturar tráfego acelerado. Use -F ou desabilite temporariamente com fwaccel off (impacta performance).',
    about_obs_en: 'If SecureXL is active, captures with fw monitor -e/-i may not capture accelerated traffic. Use -F or temporarily disable with fwaccel off (impacts performance).',
    tags: [['t-purple', 'SECUREXL', 'SECUREXL'], ['t-orange', 'ACCEL', 'ACCEL']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'fwaccel stat'),
      cmdLine(PR.FW, 'fwaccel stats -s'),
      note('fwaccel stat: estado do SecureXL · para filtrar por IP preencha SRC e DST acima', 'fwaccel stat: SecureXL state · to filter by IP, fill in SRC and DST above'),
    ],
    diffs: [
      { version: 'R82 / R82.10 — g_fwaccel (Maestro/Scalable)', note_pt: 'Admin Guide R82 p.335-338 / R82.10 p.306-308', note_en: 'Admin Guide R82 p.335-338 / R82.10 p.306-308',
        lines: [
          cmdLine(PR.MHO, 'g_fwaccel dbg resetall'),
          cmdLine(PR.MHO, 'g_fwaccel dbg list'),
          cmdLine(PR.MHO, 'g_fwaccel dbg -m fw + accel'),
        ] },
    ],
  },
  {
    id: 'fwaccelconns', topic: 'securexl', icon: '⚡', sort_order: 2, requires_ips: 1,
    placeholder_resolver: 'fwaccelconns',
    raw_template: 'fwaccel conns | grep -E "{{src_ip}}|{{dst_ip}}"',
    name_pt: 'fwaccel conns — Filtro SRC/DST', name_en: 'fwaccel conns — SRC/DST filter',
    name_empty_pt: 'fwaccel conns — Conexões aceleradas', name_empty_en: 'fwaccel conns — Accelerated connections',
    desc_pt: 'Conexões aceleradas de {{src_ip}} → {{dst_ip}}', desc_en: 'Accelerated connections from {{src_ip}} → {{dst_ip}}',
    desc_empty_pt: 'Preencha SRC e DST para filtrar por IP', desc_empty_en: 'Fill in SRC and DST to filter by IP',
    about_icon: '⚡',
    about_purpose_pt: 'Lista as conexões ativas no caminho acelerado do SecureXL. Com filtro SRC/DST mostra apenas as conexões do par informado. Confirma que conexões específicas estão no fast-path do SecureXL.',
    about_purpose_en: 'Lists active connections on the SecureXL accelerated path. With an SRC/DST filter it shows only connections for the given pair. Confirms specific connections are on the SecureXL fast path.',
    about_when_pt: 'Quando o tráfego não aparece no fw monitor porque está acelerado, ou para verificar se uma conexão específica está no caminho fast-path.',
    about_when_en: "When traffic doesn't show up in fw monitor because it's accelerated, or to check whether a specific connection is on the fast path.",
    about_obs_pt: 'No R82/R82.10, use simple_debug_filter para filtrar por IP diretamente no kernel SecureXL (mais eficiente que grep em produção).',
    about_obs_en: 'On R82/R82.10, use simple_debug_filter to filter by IP directly in the SecureXL kernel (more efficient than grep in production).',
    tags: [['t-purple', 'SECUREXL', 'SECUREXL']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'fwaccel conns | grep -E "{{src_ip}}|{{dst_ip}}"'),
      note('R82/R82.10: use simple_debug_filter para filtro no kernel (ver bloco de diferenças acima)', 'R82/R82.10: use simple_debug_filter for kernel-side filtering (see the differences block above)'),
    ],
    linesEmpty: [
      info('Preencha IP Origem e Destino para filtrar conexões aceleradas por IP', 'Fill in Source and Destination IP to filter accelerated connections by IP'),
      cmdLine(PR.FW, 'fwaccel conns'),
      note('fwaccel conns: lista todas as conexões no caminho acelerado do SecureXL', 'fwaccel conns: lists all connections on the SecureXL accelerated path'),
    ],
    diffs: [],
  },

  // ════════════════════════════════════ LICENSE ════════════════════════════════════
  {
    id: 'licprint', topic: 'license', icon: '🔑', sort_order: 1, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'cplic print',
    name_pt: 'cplic print — Ver licenças instaladas', name_en: 'cplic print — View installed licenses',
    desc_pt: 'Lista licenças ativas na máquina local', desc_en: 'Lists active licenses on the local machine',
    about_icon: '🔑',
    about_purpose_pt: 'Lista todas as licenças instaladas localmente na máquina (Security Gateway, Cluster Member ou Management Server), incluindo SKU, blades habilitadas, IP associado e data de expiração.',
    about_purpose_en: 'Lists all licenses installed locally on the machine (Security Gateway, Cluster Member or Management Server), including SKU, enabled blades, associated IP, and expiration date.',
    about_when_pt: 'Primeiro passo ao investigar blade não habilitada, licença expirada, ou para levantar o que está instalado antes de abrir chamado com o TAC.',
    about_when_en: "First step when investigating a disabled blade, an expired license, or to survey what's installed before opening a TAC case.",
    about_obs_pt: 'cplic print mostra apenas a máquina local. Use -x para incluir licenças já expiradas na listagem.',
    about_obs_en: 'cplic print only shows the local machine. Use -x to include already-expired licenses in the listing.',
    tags: [['t-teal', 'LICENÇA', 'LICENSE'], ['t-blue', 'CONSULTA', 'QUERY']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'cplic print'),
      cmdLine(PR.FW, 'cplic print -x'),
      note('cplic print: lista licenças instaladas localmente · -x inclui licenças expiradas (Admin Guide R81.10 p.542-548 / R81.20 p.580-583)', 'cplic print: lists locally installed licenses · -x includes expired licenses (Admin Guide R81.10 p.542-548 / R81.20 p.580-583)'),
    ],
    diffs: [
      { version: 'Todas as versões — SmartUpdate (legado)', note_pt: 'GUI legado para gerenciar licenças/contratos — descontinuado', note_en: 'Legacy GUI for managing licenses/contracts — discontinued',
        lines: [ note('SmartUpdate era o cliente GUI legado de gestão de licenças, substituído por cplic (CLI) e Gaia Portal > Maintenance > License Status', 'SmartUpdate was the legacy GUI client for license management, replaced by cplic (CLI) and Gaia Portal > Maintenance > License Status') ] },
    ],
  },
  {
    id: 'liccheck', topic: 'license', icon: '🧪', sort_order: 2, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'cplic check -p vpn',
    name_pt: 'cplic check — Validar blade licenciada', name_en: 'cplic check — Validate licensed blade',
    desc_pt: 'Confirma se uma feature específica está licenciada', desc_en: 'Confirms whether a specific feature is licensed',
    about_icon: '🧪',
    about_purpose_pt: 'Verifica se uma feature/blade específica (VPN, IPS, Identity Awareness etc.) está licenciada e habilitada na máquina local.',
    about_purpose_en: 'Checks whether a specific feature/blade (VPN, IPS, Identity Awareness, etc.) is licensed and enabled on the local machine.',
    about_when_pt: 'Quando uma blade parece não funcionar e é preciso confirmar rapidamente se é falta de licença ou problema de configuração.',
    about_when_en: "When a blade seems to not be working and you need to quickly confirm whether it's a licensing gap or a configuration issue.",
    about_obs_pt: 'Retorna sucesso/falha simples — combine com cplic print para ver o detalhe completo da licença.',
    about_obs_en: 'Returns a simple success/failure — combine with cplic print to see the full license detail.',
    tags: [['t-blue', 'CONSULTA', 'QUERY']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'cplic check -p vpn'),
      cmdLine(PR.FW, 'cplic check -p all'),
      note('cplic check -p <feature>: verifica se uma blade específica está licenciada (ex.: vpn, fw1, DES, sslvpn)', 'cplic check -p <feature>: checks whether a specific blade is licensed (e.g. vpn, fw1, DES, sslvpn)'),
    ],
    diffs: [],
  },
  {
    id: 'licgetput', topic: 'license', icon: '📥', sort_order: 3, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'cplic get -p all',
    name_pt: 'cplic get / put — Buscar e instalar licenças', name_en: 'cplic get / put — Fetch and install licenses',
    desc_pt: 'Sincroniza do User Center ou instala arquivo .lic local', desc_en: 'Syncs from the User Center or installs a local .lic file',
    about_icon: '📥',
    about_purpose_pt: 'cplic get busca no Check Point User Center as licenças associadas aos objetos do repositório (executado no Management). cplic put instala uma licença localmente a partir de um arquivo ou string.',
    about_purpose_en: 'cplic get fetches from the Check Point User Center the licenses associated with the repository objects (run on Management). cplic put installs a license locally from a file or string.',
    about_when_pt: 'Após gerar/associar uma licença no User Center, para sincronizar sem colar a string manualmente; ou para instalar offline uma licença recebida em arquivo .lic.',
    about_when_en: 'After generating/associating a license in the User Center, to sync it without manually pasting the string; or to install offline a license received in a .lic file.',
    about_obs_pt: 'cplic get exige conectividade do Management com o User Center. Em ambiente air-gapped/offline, use cplic put ou a ativação manual via Gaia Portal.',
    about_obs_en: 'cplic get requires Management connectivity to the User Center. In an air-gapped/offline environment, use cplic put or manual activation via the Gaia Portal.',
    tags: [['t-green', 'INSTALAÇÃO', 'INSTALLATION']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.SMS, 'cplic get -p all'),
      note('cplic get -p all: busca no User Center as licenças de todos os objetos do repositório (execute no Management/SMS)', 'cplic get -p all: fetches from the User Center the licenses for all repository objects (run on the Management/SMS)'),
      cmdLine(PR.SMS, 'cplic get -p ip <IP-do-Gateway>'),
      cmdLine(PR.FW, 'cplic put -l /tmp/license.lic'),
      note('cplic put -l <arquivo>: instala localmente uma licença (gateway ou management) a partir de um arquivo .lic', 'cplic put -l <file>: locally installs a license (gateway or management) from a .lic file'),
      warn('cplic get exige conectividade do Management com o Check Point User Center (HTTPS/443)', 'cplic get requires Management connectivity to the Check Point User Center (HTTPS/443)'),
    ],
    diffs: [],
  },
  {
    id: 'licdel', topic: 'license', icon: '🗑️', sort_order: 4, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'cplic del all',
    name_pt: 'cplic del — Remover licença local', name_en: 'cplic del — Remove local license',
    desc_pt: 'Remove licença(s) da máquina local', desc_en: 'Removes license(s) from the local machine',
    about_icon: '🗑️',
    about_purpose_pt: 'Remove uma licença instalada na máquina local. "cplic del all" remove todas as licenças locais de uma vez.',
    about_purpose_en: 'Removes a license installed on the local machine. "cplic del all" removes all local licenses at once.',
    about_when_pt: 'Ao substituir uma licença expirada/incorreta por uma nova, ou ao limpar licenças de teste antes da licença definitiva.',
    about_when_en: 'When replacing an expired/incorrect license with a new one, or clearing test licenses before the final license.',
    about_obs_pt: 'Remove só da máquina local, não do repositório do Management. Garanta a nova licença antes de remover — sem licença válida, blades podem parar de funcionar.',
    about_obs_en: "Removes only from the local machine, not from the Management repository. Make sure the new license is in place before removing — without a valid license, blades may stop working.",
    tags: [['t-red', 'CUIDADO', 'CAUTION'], ['t-teal', 'LICENÇA', 'LICENSE']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'cplic print -x'),
      cmdLine(PR.FW, 'cplic del <license-string>'),
      cmdLine(PR.FW, 'cplic del all'),
      warn('cplic del remove a licença apenas da máquina local. Para remover do repositório do Management, use cplic db_rm', 'cplic del only removes the license from the local machine. To remove it from the Management repository, use cplic db_rm'),
    ],
    diffs: [],
  },
  {
    id: 'licrepo', topic: 'license', icon: '🗄️', sort_order: 5, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'cplic db_print',
    name_pt: 'cplic db_add / db_print / db_rm — Repositório', name_en: 'cplic db_add / db_print / db_rm — Repository',
    desc_pt: 'Repositório central de licenças (Management/MDS)', desc_en: 'Central license repository (Management/MDS)',
    about_icon: '🗄️',
    about_purpose_pt: 'Gerencia o repositório central de licenças no Management Server/MDS: adiciona (db_add), lista (db_print) ou remove (db_rm) licenças do repositório, sem necessariamente instalá-las em um gateway.',
    about_purpose_en: 'Manages the central license repository on the Management Server/MDS: adds (db_add), lists (db_print) or removes (db_rm) licenses from the repository, without necessarily installing them on a gateway.',
    about_when_pt: 'Ao centralizar o controle de licenças de múltiplos gateways no Management, ou ao auditar quais licenças estão disponíveis para atribuição.',
    about_when_en: 'When centralizing license control for multiple gateways on Management, or auditing which licenses are available for assignment.',
    about_obs_pt: 'O repositório é só um cadastro central — a licença passa a valer na máquina após cplic get/put no próprio gateway. Disponível apenas no Management Server.',
    about_obs_en: 'The repository is just a central record — the license takes effect on the machine only after cplic get/put on the gateway itself. Available only on the Management Server.',
    tags: [['t-purple', 'MANAGEMENT', 'MANAGEMENT']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.SMS, 'cplic db_print'),
      cmdLine(PR.SMS, 'cplic db_add <arquivo-ou-string-da-licença>'),
      cmdLine(PR.SMS, 'cplic db_rm <license-string>'),
      note('Repositório de licenças existe só no Management/MDS. db_add/db_rm cadastram/removem do repositório — não instalam no gateway (Admin Guide R81.10 p.543 / R81.20 p.581)', 'The license repository only exists on the Management/MDS. db_add/db_rm register/remove from the repository — they do not install on the gateway (Admin Guide R81.10 p.543 / R81.20 p.581)'),
    ],
    diffs: [],
  },
  {
    id: 'licupgrade', topic: 'license', icon: '♻️', sort_order: 6, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'cplic upgrade',
    name_pt: 'cplic upgrade — Converter formato legado', name_en: 'cplic upgrade — Convert legacy format',
    desc_pt: 'Migra licenças de formato antigo (raramente necessário)', desc_en: 'Migrates licenses from an old format (rarely needed)',
    about_icon: '♻️',
    about_purpose_pt: 'Converte licenças de formato legado (anterior ao NGX) para o formato atual, compatibilizando-as com o License Manager.',
    about_purpose_en: 'Converts legacy-format licenses (pre-NGX) to the current format, making them compatible with the License Manager.',
    about_when_pt: 'Praticamente restrito a migrações de ambientes muito antigos — raramente necessário em instalações R81.x/R82.x atuais.',
    about_when_en: 'Practically limited to migrations from very old environments — rarely needed in current R81.x/R82.x installations.',
    about_obs_pt: 'Se a licença já foi emitida no User Center para a versão atual, este passo normalmente não é necessário.',
    about_obs_en: "If the license was already issued in the User Center for the current version, this step usually isn't necessary.",
    tags: [['t-yellow', 'LEGADO', 'LEGACY']],
    versions: [], environments: [],
    linesDefault: [
      cmdLine(PR.FW, 'cplic upgrade -p <caminho-do-arquivo>'),
      note('cplic upgrade: converte licenças de formato legado (pré-NGX) para o formato atual — raramente necessário em ambientes atuais', 'cplic upgrade: converts legacy-format (pre-NGX) licenses to the current format — rarely needed in current environments'),
    ],
    diffs: [],
  },

  // ═══════════════════════════ ENVIRONMENT-SPECIFIC CARDS ═══════════════════════════
  // These come from the "🏗️ Ambiente: X" section (S.clusterCard / S.gaiaCard / S.vsxCard /
  // S.maestroCard / S.mdsCard in commands.js) — genuinely tied to one environment each.
  // topic='environment' is used here since these don't belong to any of the 9 regular
  // topic sections (a deliberate modeling choice — schema.sql's topic column has no CHECK
  // constraint, so this is safe).
  {
    id: 'env-cluster', topic: 'environment', icon: '🔁', sort_order: 1, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'cphaprob stat',
    name_pt: 'ClusterXL — Estado & Controle', name_en: 'ClusterXL — State & Control',
    desc_pt: 'cphaprob, fw hastat, failover manual', desc_en: 'cphaprob, fw hastat, manual failover',
    about_icon: '🔁',
    about_purpose_pt: 'Verifica o estado do cluster, qual membro esta ativo/standby e a saude das interfaces sincronizadas. Permite forcar failover manual.',
    about_purpose_en: 'Checks the cluster state, which member is active/standby, and the health of synchronized interfaces. Allows forcing a manual failover.',
    about_when_pt: 'Antes de qualquer intervencao em cluster, apos failover inesperado, ou ao suspeitar de split-brain.',
    about_when_en: 'Before any cluster intervention, after an unexpected failover, or when suspecting split-brain.',
    about_obs_pt: 'Verifique sempre cphaprob -a if para identificar interfaces com problema de sincronizacao.',
    about_obs_en: 'Always check cphaprob -a if to identify interfaces with synchronization problems.',
    tags: [['t-yellow', 'CLUSTER', 'CLUSTER'], ['t-blue', 'HA', 'HA']],
    versions: [], environments: ['cluster'],
    linesDefault: [
      cmdLine(PR.FW, 'cphaprob stat'),
      cmdLine(PR.FW, 'cphaprob -a if'),
      cmdLine(PR.FW, 'cphaprob list'),
      cmdLine(PR.FW, 'fw hastat'),
      cmdLine(PR.FW, 'clusterXL_admin up'),
      note('cphastart / cphastop: habilita/desabilita clustering no membro (Admin Guide R81.10 p.447)', 'cphastart / cphastop: enables/disables clustering on the member (Admin Guide R81.10 p.447)'),
    ],
    diffs: [],
  },
  {
    id: 'env-vsx', topic: 'environment', icon: '🧩', sort_order: 2, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'vsx stat -v',
    name_pt: 'VSX — Virtual System Navigation', name_en: 'VSX — Virtual System Navigation',
    desc_pt: 'vsx stat, vsenv, cpstat por VS', desc_en: 'vsx stat, vsenv, cpstat per VS',
    about_icon: '🧩',
    about_purpose_pt: 'Lista e acessa Virtual Systems (VS) e Virtual Gateways (VG) dentro de um ambiente VSX. Permite mudar o contexto de trabalho para um VS especifico.',
    about_purpose_en: 'Lists and accesses Virtual Systems (VS) and Virtual Gateways (VG) within a VSX environment. Lets you switch the working context to a specific VS.',
    about_when_pt: 'Sempre que precisar executar comandos em um VS especifico. Sem vsenv, os comandos rodam no contexto fisico (VS0).',
    about_when_en: 'Whenever you need to run commands in a specific VS. Without vsenv, commands run in the physical context (VS0).',
    about_obs_pt: 'vsenv 0 retorna ao contexto fisico do chassis.',
    about_obs_en: 'vsenv 0 returns to the physical chassis context.',
    tags: [['t-teal', 'VSX', 'VSX']],
    versions: [], environments: ['vsx'],
    linesDefault: [
      cmdLine(PR.FW, 'vsx stat'),
      cmdLine(PR.FW, 'vsx stat -v'),
      cmdLine(PR.FW, 'vsx stat -l'),
      cmdLine(PR.FW, 'vsenv {{vsid}}'),
      cmdLine(PR.VS, 'cpstat fw -vs {{vsid}}'),
      cmdLine(PR.VS, 'fw fetch local'),
      note('vsx stat -v: apenas VSNext/Traditional VSX mode · vsenv 0 = contexto fisico (Admin Guide R82 p.207)', 'vsx stat -v: VSNext/Traditional VSX mode only · vsenv 0 = physical context (Admin Guide R82 p.207)'),
    ],
    diffs: [],
  },
  {
    id: 'env-maestro', topic: 'environment', icon: '🎼', sort_order: 3, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'asg stat',
    name_pt: 'Maestro — SGM & Security Group', name_en: 'Maestro — SGM & Security Group',
    desc_pt: 'asg_cmd, asg stat, g_fw, g_cpview', desc_en: 'asg_cmd, asg stat, g_fw, g_cpview',
    about_icon: '🎼',
    about_purpose_pt: 'Gerencia e monitora os Security Gateway Modules (SGMs) do Maestro. Permite executar comandos em todos os SGMs simultaneamente ou agregar saida.',
    about_purpose_en: 'Manages and monitors Maestro Security Gateway Modules (SGMs). Lets you run commands on all SGMs simultaneously or aggregate output.',
    about_when_pt: 'Troubleshooting de ambiente Maestro, verificacao de estado de SGMs, distribuicao de comandos em massa.',
    about_when_en: 'Troubleshooting a Maestro environment, checking SGM state, distributing commands in bulk.',
    about_obs_pt: 'asg_cmd executa em todos os SGMs. g_* agrega retorno. Use asg diag para identificar SGMs com problema.',
    about_obs_en: 'asg_cmd runs on all SGMs. g_* aggregates the return. Use asg diag to identify SGMs with problems.',
    tags: [['t-purple', 'MAESTRO', 'MAESTRO']],
    versions: [], environments: ['maestro'],
    linesDefault: [
      cmdLine(PR.MHO, 'asg stat'),
      cmdLine(PR.MHO, 'asg diag'),
      cmdLine(PR.MHO, 'asg_cpstat fw'),
      cmdLine(PR.MHO, 'asg_cmd "fw stat"'),
      cmdLine(PR.MHO, 'g_fw tab -t connections -s'),
      cmdLine(PR.MHO, 'g_cpview'),
      note('asg_cmd: executa em todos os SGMs · g_*: agrega saida · g_cpview: dashboard de todos SGMs', 'asg_cmd: runs on all SGMs · g_*: aggregates output · g_cpview: dashboard of all SGMs'),
    ],
    diffs: [],
  },
  {
    id: 'env-mds', topic: 'environment', icon: '🌐', sort_order: 4, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'mdsstat',
    name_pt: 'MDS — Multi-Domain Management', name_en: 'MDS — Multi-Domain Management',
    desc_pt: 'mdsstat, mdsenv, CMA lifecycle', desc_en: 'mdsstat, mdsenv, CMA lifecycle',
    about_icon: '🌐',
    about_purpose_pt: 'Gerencia dominios e CMAs no Multi-Domain Server. Permite iniciar e parar CMAs individuais e trocar contexto entre dominios.',
    about_purpose_en: 'Manages domains and CMAs on the Multi-Domain Server. Lets you start and stop individual CMAs and switch context between domains.',
    about_when_pt: 'Ao precisar acessar logs, policy ou status de um dominio especifico dentro do MDS.',
    about_when_en: 'When you need to access logs, policy, or status of a specific domain within the MDS.',
    about_obs_pt: 'Todos os comandos de gateway (fw stat, fw log) devem ser executados no contexto da CMA, nunca direto no MDS.',
    about_obs_en: 'All gateway commands (fw stat, fw log) must be run in the CMA context, never directly on the MDS.',
    tags: [['t-blue', 'MDS', 'MDS']],
    versions: [], environments: ['mds'],
    linesDefault: [
      cmdLine(PR.MDS, 'mdsstat'),
      cmdLine(PR.MDS, 'mdsenv <CMA-NAME>'),
      cmdLine(PR.CMA, 'cpstat fw'),
      cmdLine(PR.MDS, 'mdsstop_customer <CMA-NAME>'),
      cmdLine(PR.MDS, 'mdsstart_customer <CMA-NAME>'),
      note('mdsstart_customer/mdsstop_customer: controla CMA especifica (Admin Guide R81.10 p.449)', 'mdsstart_customer/mdsstop_customer: controls a specific CMA (Admin Guide R81.10 p.449)'),
    ],
    diffs: [],
  },
  {
    // NOTE: source card (buildStatic's gaiaCard) had no `about` block at all in the
    // original app — about_* text below was written for this migration (there is no
    // PT/EN source to transcribe), unlike every other command where about_* is a direct
    // transcription of i18n.js / commands.js content.
    id: 'env-gaia', topic: 'environment', icon: '🖥️', sort_order: 5, requires_ips: 0,
    placeholder_resolver: null, raw_template: 'show version all',
    name_pt: 'Gaia Clish — Comandos Nativos & Acesso ao Expert', name_en: 'Gaia Clish — Native Commands & Access to Expert',
    desc_pt: 'show route/arp/version/asset/syslog, e como entrar no modo Expert', desc_en: 'show route/arp/version/asset/syslog, and how to enter Expert mode',
    about_icon: '🖥️',
    about_purpose_pt: 'Executa comandos nativos do shell restrito Gaia Clish (show route/arp/version/asset/syslog) e mostra como entrar no modo Expert para acessar ferramentas de kernel/tráfego.',
    about_purpose_en: 'Runs native Gaia Clish restricted-shell commands (show route/arp/version/asset/syslog) and shows how to enter Expert mode to access kernel/traffic tools.',
    about_when_pt: 'Ao trabalhar direto no shell restrito da Gaia, antes de precisar de comandos avançados (fw monitor, tcpdump, fw ctl debug, cplic etc.) que exigem o modo Expert.',
    about_when_en: 'When working directly in the Gaia restricted shell, before needing advanced commands (fw monitor, tcpdump, fw ctl debug, cplic, etc.) that require Expert mode.',
    about_obs_pt: 'A maioria das ferramentas de troubleshooting de kernel e tráfego não tem equivalente nativo no Clish — é necessário entrar em modo Expert (bash) com o comando expert.',
    about_obs_en: 'Most kernel and traffic troubleshooting tools have no native Clish equivalent — you need to enter Expert mode (bash) with the expert command.',
    tags: [['t-green', 'GAIA', 'GAIA'], ['t-blue', 'CLISH', 'CLISH']],
    versions: [], environments: ['gaia'],
    linesDefault: [
      cmdLine(PR.GAIA, 'show version all'),
      cmdLine(PR.GAIA, 'show asset all'),
      cmdLine(PR.GAIA, 'show route'),
      cmdLine(PR.GAIA, 'show arp'),
      cmdLine(PR.GAIA, 'show interfaces'),
      cmdLine(PR.GAIA, 'show syslog all'),
      note('Comandos "show" acima rodam nativamente no Clish, sem sair do shell restrito.', 'The "show" commands above run natively in Clish, without leaving the restricted shell.'),
      cmdLine(PR.GAIA, 'expert'),
      note('Ferramentas de kernel/tráfego (fw monitor, tcpdump, fw ctl debug/zdebug, fwaccel, fw tab, fw log, cplic) exigem modo Expert — não existem no Clish.', 'Kernel/traffic tools (fw monitor, tcpdump, fw ctl debug/zdebug, fwaccel, fw tab, fw log, cplic) require Expert mode — they do not exist in Clish.'),
    ],
    diffs: [],
  },
];

// ════════════════════════════════════════════════
// Insert
// ════════════════════════════════════════════════
// NOTA: todo o texto do banco (commands.name/desc/about_*, command_tags.label,
// command_lines.content, command_diffs.note, command_diff_lines.content)
// virou campo único (sem _pt/_en) e o sistema é 100% em inglês — a pedido do
// usuário (ver schema.sql). Este script legado ainda guarda os literais de
// COMMANDS em pares _pt/_en (mais fácil de ler/manter aqui), mas grava só o
// valor único no banco — inglês como canônico, mesmo critério usado na
// migração ao vivo, com fallback para o português se o inglês estiver vazio.
function canon(en, pt) { return (en !== undefined && en !== null && en !== '') ? en : (pt || ''); }

const insertCommand = db.prepare(`
  INSERT OR REPLACE INTO commands (
    id, topic, icon, sort_order, requires_ips, requires_ip_port, placeholder_resolver, raw_template,
    name, name_empty, desc, desc_empty,
    about_icon, about_purpose, about_when, about_obs
  ) VALUES (
    @id, @topic, @icon, @sort_order, @requires_ips, @requires_ip_port, @placeholder_resolver, @raw_template,
    @name, @name_empty, @desc, @desc_empty,
    @about_icon, @about_purpose, @about_when, @about_obs
  )
`);
const insertTag = db.prepare('INSERT INTO command_tags (command_id, css_class, label, sort_order) VALUES (?, ?, ?, ?)');
const insertTopic = db.prepare('INSERT INTO command_topics (command_id, topic) VALUES (?, ?)');
const insertVersion = db.prepare('INSERT INTO command_versions (command_id, version) VALUES (?, ?)');
const insertEnv = db.prepare('INSERT INTO command_environments (command_id, environment) VALUES (?, ?)');
const insertLine = db.prepare(`INSERT INTO command_lines (command_id, variant, sort_order, line_type, prompt, content) VALUES (?, ?, ?, ?, ?, ?)`);
const insertDiff = db.prepare('INSERT INTO command_diffs (command_id, version, note, sort_order) VALUES (?, ?, ?, ?)');
const insertDiffLine = db.prepare(`INSERT INTO command_diff_lines (diff_id, sort_order, line_type, prompt, content) VALUES (?, ?, ?, ?, ?)`);

const seed = db.transaction(() => {
  // clear existing rows for a clean, re-runnable seed (cascades to all child tables)
  db.prepare('DELETE FROM commands').run();

  for (const c of COMMANDS) {
    insertCommand.run({
      id: c.id, topic: c.topic, icon: c.icon, sort_order: c.sort_order, requires_ips: c.requires_ips,
      requires_ip_port: c.requires_ip_port || 0,
      placeholder_resolver: c.placeholder_resolver, raw_template: c.raw_template,
      name: canon(c.name_en, c.name_pt),
      name_empty: (c.name_empty_en || c.name_empty_pt) ? canon(c.name_empty_en, c.name_empty_pt) : null,
      desc: canon(c.desc_en, c.desc_pt),
      desc_empty: (c.desc_empty_en || c.desc_empty_pt) ? canon(c.desc_empty_en, c.desc_empty_pt) : null,
      about_icon: c.about_icon || 'ℹ️',
      about_purpose: canon(c.about_purpose_en, c.about_purpose_pt),
      about_when: canon(c.about_when_en, c.about_when_pt),
      about_obs: canon(c.about_obs_en, c.about_obs_pt),
    });

    (c.tags || []).forEach(([cls, pt, en], i) => insertTag.run(c.id, cls, canon(en, pt), i));
    // Um comando pode pertencer a mais de um Tópico (c.topics, opcional); por padrão
    // usa o único `c.topic` do registro legado (todo comando tem sempre >=1 tópico).
    (c.topics && c.topics.length ? c.topics : [c.topic]).forEach(tp => insertTopic.run(c.id, tp));
    (c.versions || []).forEach(v => insertVersion.run(c.id, v));
    (c.environments || []).forEach(e => insertEnv.run(c.id, e));

    (c.linesDefault || []).forEach((l, i) => insertLine.run(c.id, 'default', i, l.line_type, l.prompt, canon(l.content_en, l.content_pt)));
    (c.linesEmpty || []).forEach((l, i) => insertLine.run(c.id, 'empty', i, l.line_type, l.prompt, canon(l.content_en, l.content_pt)));

    (c.diffs || []).forEach((d, i) => {
      const result = insertDiff.run(c.id, d.version, canon(d.note_en, d.note_pt), i);
      const diffId = result.lastInsertRowid;
      (d.lines || []).forEach((l, j) => insertDiffLine.run(diffId, j, l.line_type, l.prompt, canon(l.content_en, l.content_pt)));
    });
  }
});

seed();

const count = db.prepare('SELECT COUNT(*) AS n FROM commands').get().n;
console.log(`Seed complete: ${count} commands inserted.`);
