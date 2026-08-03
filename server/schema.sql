-- ════════════════════════════════════════════════
-- Check Point Commands — schema relacional (SQLite)
-- ════════════════════════════════════════════════
-- Banco ÚNICO (server/db.js: commands.db) — antes havia dois arquivos
-- separados (commands.db "System" + commands_user.db "usuário") para
-- distinguir comandos de referência dos criados por usuários; isso foi
-- CONSOLIDADO aqui. A distinção System vs. usuário agora vive inteiramente na
-- coluna `commands.created_by` (created_by = 'System' marca um comando de
-- referência) — ver comentário na tabela `commands` abaixo e a regra de
-- permissão em server/index.js (só o autor de um comando — created_by — pode
-- editá-lo/excluí-lo; qualquer usuário pode duplicá-lo e editar a própria
-- cópia). Por ser um banco único, `user_favorites.command_id` agora TEM uma
-- FK normal para `commands(id) ON DELETE CASCADE` (antes não tinha, por causa
-- da separação em dois arquivos).
--
-- Este banco não é semeado automaticamente (ver server/db.js) — todas as
-- tabelas começam vazias e continuam vazias até serem populadas manualmente
-- (tela de administração de catálogo / editor de comandos / importação CSV).
--
-- Um comando (fw monitor, tcpdump, cplic print, ...) é um registro em `commands`,
-- com uma ou mais linhas de terminal associadas (`command_lines`). Comandos que
-- variam de sintaxe entre versões (R81.10/R81.20/R82/R82.10) têm blocos extras
-- em `command_diffs`/`command_diff_lines` (o bloco expansível "Diferenças por
-- versão / plataforma" da UI).
--
-- Todo o texto da aplicação (banco + UI) é em inglês, sem bilinguismo. Todos os
-- campos que antes eram pares _pt/_en (`commands.name/desc/about_*`,
-- `parameters.label`, `command_tags.label`, `command_lines.content`,
-- `command_diffs.note`, `command_diff_lines.content`) foram unificados num
-- único campo cada; onde o texto existente divergia entre os idiomas, o
-- inglês foi mantido como valor canônico na migração.
--
-- Templates de conteúdo podem conter placeholders {{src_ip}}, {{dst_ip}}, {{src_port}}, {{dst_port}},
-- {{proto}}, {{iface}}, {{vsid}}, {{capFile}}, {{dbgFile}}, {{logFile}} — resolvidos
-- em tempo de render pelo front-end. Um pequeno subconjunto de comandos avançados
-- (que hoje calculam CIDR/listas/faixas de IP e regex de filtro — fw monitor,
-- tcpdump, fw ctl zdebug, fw tab, ip route get, fwaccel conns, fw fetchlogs,
-- fwm logexport) mantém esse cálculo em JS (net-utils.js) e é referenciado via
-- `placeholder_resolver` — o valor calculado substitui o placeholder correspondente
-- em vez de ser puro texto estático.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS commands (
  id                  TEXT PRIMARY KEY,     -- slug estável, ex.: 'fwmonitor', 'cplic-print'
  topic               TEXT NOT NULL,        -- capture|debug|logs|policy|tables|routing|status|securexl|license
  icon                TEXT NOT NULL DEFAULT '📄',
  sort_order          INTEGER NOT NULL DEFAULT 0,
  requires_ips        INTEGER NOT NULL DEFAULT 0,   -- 1 = card muda de conteúdo quando SRC/DST não preenchidos
  requires_ip_port    INTEGER NOT NULL DEFAULT 0,   -- 1 = card muda de conteúdo quando IP/Porta (genéricos, sem direção) não preenchidos
  placeholder_resolver TEXT,                -- nome da função JS usada p/ resolver placeholders avançados (nullable)
  raw_template        TEXT NOT NULL DEFAULT '', -- texto copiado pelo botão "copiar" (com placeholders)

  name                TEXT NOT NULL,
  name_empty          TEXT,                 -- variante do nome quando requires_ips=1 (IPs vazios) ou requires_ip_port=1 (IP/Porta vazios) (opcional)

  desc                TEXT NOT NULL DEFAULT '',
  desc_empty          TEXT,

  about_icon          TEXT NOT NULL DEFAULT 'ℹ️',
  about_purpose       TEXT NOT NULL DEFAULT '',
  about_when          TEXT NOT NULL DEFAULT '',
  about_obs           TEXT NOT NULL DEFAULT '',

  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),

  -- Autoria/auditoria — também a base da regra de PERMISSÃO (ver PUT/DELETE
  -- /api/commands/:id em server/index.js): um comando só pode ser
  -- editado/excluído por quem tem `created_by` igual ao usuário atual.
  -- Ninguém pode alterar o comando de outro usuário — quem quiser uma versão
  -- própria precisa duplicar (botão "Duplicate command") e editar a cópia,
  -- que nasce com created_by = quem duplicou. `created_by = 'System'` marca
  -- um comando de referência (rebuild a partir dos Admin Guides oficiais);
  -- como nenhum usuário real se autentica como "System", esses comandos ficam
  -- Naturalmente somente-leitura pela API (mesma regra, sem caso especial).
  -- `modified_by` fica NULL até a primeira edição (a UI/API cai em
  -- created_by como "Alterado por" nesse caso — ver shapeCommand). Ambos são
  -- texto livre (mesmo formato de user_favorites.username: "DOMÍNIO\usuario"
  -- ou só "usuario"), sem FK.
  created_by          TEXT,
  modified_by         TEXT
);

-- Aplicabilidade por vendor/OS/versão/ambiente. Ausência de linhas = "aplica a
-- todos" (default) — mesma semântica para as quatro tabelas abaixo.
CREATE TABLE IF NOT EXISTS command_vendors (
  command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  vendor     TEXT NOT NULL,   -- ex.: 'check-point'
  PRIMARY KEY (command_id, vendor)
);
CREATE TABLE IF NOT EXISTS command_systems (
  command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  system     TEXT NOT NULL,   -- ex.: 'gaia'
  PRIMARY KEY (command_id, system)
);
CREATE TABLE IF NOT EXISTS command_versions (
  command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  version    TEXT NOT NULL,   -- 'R81.10' | 'R81.20' | 'R82' | 'R82.10'
  PRIMARY KEY (command_id, version)
);
CREATE TABLE IF NOT EXISTS command_environments (
  command_id  TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  environment TEXT NOT NULL,  -- 'standalone' | 'cluster' | 'vsx' | 'maestro' | 'mds' | 'gaia'
  PRIMARY KEY (command_id, environment)
);

-- Tópicos aos quais um comando pertence — ao contrário de versão/ambiente, aqui a
-- ausência de linhas NÃO significa "todos": todo comando tem sempre pelo menos 1
-- linha aqui (um comando pode aparecer em mais de uma seção de Tópico, ex.: um
-- comando de captura também relevante para debug). `commands.topic` é mantido em
-- paralelo como "tópico primário" (topics[0]) só por compatibilidade — a lista
-- completa em command_topics é a fonte de verdade para agrupamento/filtro.
CREATE TABLE IF NOT EXISTS command_topics (
  command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  topic      TEXT NOT NULL,
  PRIMARY KEY (command_id, topic)
);
CREATE INDEX IF NOT EXISTS idx_command_topics_topic ON command_topics(topic);

-- ════════════════════════════════════════════════
-- Catálogos administráveis (Versão / Ambiente / Tópico) — antes eram listas fixas
-- no front-end (VERSION_KEYS/ENV_KEYS/TYPE_KEYS em js/state.js); agora vivem aqui
-- para permitir cadastro/edição/exclusão pelo "Modo administrador" (mesmo toggle
-- enableCommandEditing já usado para comandos). `key` é o identificador estável
-- usado em command_versions.version / command_environments.environment /
-- command_topics.topic — por isso NUNCA é editável depois de criado (só
-- label/cor/ícone/ordem). Exclusão é bloqueada em server/index.js quando o
-- valor estiver em uso por pelo menos um comando (ver contagem em
-- command_versions/command_environments/command_topics).
-- ════════════════════════════════════════════════

-- Fabricantes (ex.: Check Point) e Sistemas (ex.: Gaia) — topo da hierarquia
-- multi-fabricante Vendor → Sistema → Versão → Ambiente → Tópico usada para
-- popular a cascata de filtros (sidebar/editor/catálogo).
--
-- Vendor → Sistema → Versão é uma hierarquia ESTRITA (1:N, não N:N como
-- Versão ↔ Ambiente ↔ Tópico abaixo): um Sistema pertence a exatamente um
-- Vendor (`systems.vendor`, FK obrigatória) e uma Versão pertence a
-- exatamente um Sistema (`versions.system`, FK obrigatória) — por isso não
-- existem mais tabelas de vínculo N:N `vendor_os`/`os_versions`; o vínculo é
-- uma coluna direta. `key` continua imutável depois de criado (só
-- label/color/sort_order/vendor(ou system) são editáveis — ver server/index.js).
--
-- Como uma Versão agora pertence a um Sistema específico, o mesmo nome de
-- versão (`key`) PODE se repetir em Sistemas diferentes (ex.: duas famílias
-- de produtos distintas podem ambas ter uma versão "1.0") — por isso a chave
-- primária de `versions` é composta (system, key), não só `key`. A única
-- restrição adicional é que o mesmo nome de versão NÃO pode se repetir dentro
-- do MESMO Vendor, mesmo em Sistemas diferentes dele — daí a coluna `vendor`
-- (denormalizada a partir de systems.vendor, mantida em sincronia pelo
-- backend) com `UNIQUE (vendor, key)`.
CREATE TABLE IF NOT EXISTS vendors (
  key        TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#8B949E',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS systems (
  key        TEXT PRIMARY KEY,
  vendor     TEXT NOT NULL REFERENCES vendors(key) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#8B949E',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_systems_vendor ON systems(vendor);

-- Versões (ex.: R81.10, R82) não são traduzidas (números de versão), por isso
-- têm só um rótulo (`label`), não label_pt/label_en. Ver comentário acima
-- sobre a chave composta (system, key) e o UNIQUE (vendor, key).
CREATE TABLE IF NOT EXISTS versions (
  system     TEXT NOT NULL REFERENCES systems(key) ON DELETE CASCADE,
  vendor     TEXT NOT NULL REFERENCES vendors(key) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  label      TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#8B949E',
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (system, key),
  UNIQUE (vendor, key)
);

-- Ambientes (ex.: cluster, gaia, standalone) têm só um rótulo (`label`), sem
-- label_pt/label_en — a pedido do usuário, já que o nome do ambiente não é
-- realmente traduzido na prática (mesmo padrão de `versions.label` acima).
CREATE TABLE IF NOT EXISTS environments (
  key        TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#8B949E',
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ── Vínculo N:N Versão ↔ Ambiente (sem duplicar cadastro) ──
-- Diferente de Vendor → Sistema → Versão acima, aqui a relação continua N:N
-- nos dois sentidos (uma Versão pode ter vários Ambientes, um Ambiente pode
-- estar em várias Versões) — a pedido do usuário. `version` é guardado só
-- como TEXT (o `key`, sem FK formal): como o mesmo `key` de versão pode
-- existir em mais de um Sistema (ver comentário acima), esse vínculo é
-- tratado como "soft" (mesmo padrão de command_versions) — na prática, hoje
-- só existe 1 Vendor/Sistema, então não há ambiguidade real. Ausência total
-- de vínculos para uma versão = "sem restrição conhecida ainda", tratado
-- pelo front-end como "válida sob qualquer ambiente".
CREATE TABLE IF NOT EXISTS version_environments (
  version     TEXT NOT NULL,
  environment TEXT NOT NULL REFERENCES environments(key) ON DELETE CASCADE,
  PRIMARY KEY (version, environment)
);

-- Tópicos (ex.: capture, vpn) têm rótulo curto (usado nos filtros/editor) e um
-- título de seção mais longo (usado no cabeçalho da seção em render.js) — cada
-- um com um único idioma (sem _pt/_en), a pedido do usuário, e sem ícone
-- próprio (removido do cadastro e de qualquer lugar onde era exibido).
-- `is_protected` = 1 marca o tópico especial 'environment' (usado
-- internamente para os cards de "Ambiente específico" — buildEnvCards em
-- db-render-engine.js): não pode ser excluído e fica fora dos filtros de
-- Tópico (sidebar/config), só aparece no editor de comandos.
CREATE TABLE IF NOT EXISTS topics (
  key           TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  section_title TEXT NOT NULL,
  color         TEXT NOT NULL DEFAULT '#8B949E',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_protected  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS environment_topics (
  environment TEXT NOT NULL REFERENCES environments(key) ON DELETE CASCADE,
  topic       TEXT NOT NULL REFERENCES topics(key) ON DELETE CASCADE,
  PRIMARY KEY (environment, topic)
);

-- Parâmetros administráveis usados nos comandos (campo de busca unificado da
-- barra superior e botão "Inserir variável" do editor de comandos). `key` é o
-- nome do placeholder {{key}} usado nos templates (commands.raw_template /
-- command_lines.content / command_diff_lines.content), a propriedade lida
-- no objeto `values` em js/render.js, o id do <input type="hidden"> que guarda
-- o valor atual, E a palavra digitada antes de ':' na barra de busca — tudo
-- unificado num único identificador. NUNCA editável depois de criado.
-- `label` é a descrição exibida na tela de administração e no dropdown
-- "Inserir variável" (ex.: key='src_ip', label='Source IP').
-- Exclusão é bloqueada em server/index.js quando: (a) é 'src_ip'/'dst_ip' e
-- algum comando tem requires_ips=1; (b) é 'ip'/'port' e algum comando tem
-- requires_ip_port=1; (c) {{key}} aparece em algum template de comando — nos
-- três casos a app dependeria do parâmetro de um jeito que uma exclusão
-- silenciosa quebraria comandos existentes.
CREATE TABLE IF NOT EXISTS parameters (
  key            TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

-- Tags/badges exibidos no cabeçalho do card (ex.: PRINCIPAL/NGFW, CUIDADO/KERNEL).
CREATE TABLE IF NOT EXISTS command_tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  css_class  TEXT NOT NULL,      -- t-red | t-blue | t-teal | t-yellow | t-orange | t-purple | t-green
  label      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Linhas de terminal do card. `variant` distingue o bloco normal do bloco
-- "placeholder" mostrado quando requires_ips=1 e SRC/DST (ou requires_ip_port=1 e IP/Porta) ainda não foram preenchidos.
CREATE TABLE IF NOT EXISTS command_lines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  command_id     TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  variant        TEXT NOT NULL DEFAULT 'default',  -- 'default' | 'empty'
  sort_order     INTEGER NOT NULL DEFAULT 0,
  line_type      TEXT NOT NULL DEFAULT 'cmd',      -- cmd | note | warn | info | ok | image
  prompt         TEXT,                              -- ex.: '[Expert@FW]#' (NULL para note/warn/info/ok/image)
  content        TEXT NOT NULL DEFAULT '',          -- para line_type='image', guarda o NOME exibido no lugar do comando
  supports_export INTEGER NOT NULL DEFAULT 0,       -- 1 = linha 'cmd' de leitura cujo output pode ser
                                                     -- redirecionado a um arquivo; quando o toggle da
                                                     -- sidebar "Exportar para arquivo" está ligado, o
                                                     -- motor de render (db-render-engine.js) anexa
                                                     -- ' > <caminho>' automaticamente. Não usado pelos
                                                     -- comandos com placeholder_resolver (fw monitor,
                                                     -- tcpdump, zdebug, fw log/logexport), que já
                                                     -- controlam seu próprio redirecionamento.
  image_data     TEXT                               -- só para line_type='image': a imagem em si, como
                                                     -- data URI base64 (ex.: 'data:image/png;base64,...'),
                                                     -- enviada por upload de arquivo ou colada (Ctrl+V) no
                                                     -- editor de comandos (ver js/command-editor.js). Clicar
                                                     -- no nome/ícone no card abre a imagem em tamanho maior
                                                     -- (ver js/terminal-renderer.js: openImageLightbox). Não
                                                     -- suportado dentro de command_diff_lines (só nas linhas
                                                     -- principais do comando) — mantém o schema de diffs simples.
);

-- Bloco expansível "Diferenças por versão / plataforma".
CREATE TABLE IF NOT EXISTS command_diffs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  command_id  TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  version     TEXT NOT NULL,       -- versão/rótulo mostrado na tag do diff (ex.: 'R82+', 'R81.x')
  note        TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS command_diff_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  diff_id     INTEGER NOT NULL REFERENCES command_diffs(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  line_type   TEXT NOT NULL DEFAULT 'cmd',
  prompt      TEXT,
  content     TEXT NOT NULL DEFAULT ''
);

-- ════════════════════════════════════════════════
-- Multiusuário — servidor central compartilhado, um usuário por login do
-- Windows (identificado via NTLM na camada HTTP, ver server/index.js). `username`
-- é sempre "DOMÍNIO\usuario" ou só "usuario" (texto livre, sem FK — não há uma
-- tabela de usuários; qualquer login novo simplesmente começa a acumular linhas).
-- ════════════════════════════════════════════════

-- Favoritos por usuário. Ao contrário do antigo esquema (localStorage por
-- navegador), isto é compartilhado: permite contar/listar QUEM favoritou cada
-- comando (ver GET /api/commands -> favorite_count/favorited_by). Banco único
-- agora (ver comentário no topo do arquivo) — `command_id` tem FK normal para
-- `commands(id) ON DELETE CASCADE`, então excluir um comando já limpa seus
-- favoritos sozinho (antes era feito manualmente em DELETE /api/commands/:id,
-- quando os dois podiam estar em arquivos .db diferentes).
CREATE TABLE IF NOT EXISTS user_favorites (
  username   TEXT NOT NULL,
  command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (username, command_id)
);
CREATE INDEX IF NOT EXISTS idx_user_favorites_command ON user_favorites(command_id);

-- Armazenamento genérico chave/valor por usuário — usado para tudo que antes
-- vivia só no localStorage do navegador (tema, idioma, configurações, históricos
-- de busca) e que agora deve acompanhar a pessoa entre navegadores/máquinas.
-- `data_key` reaproveita as MESMAS chaves já usadas no localStorage (ex.:
-- 'cpa-theme', 'cpa-lang', 'cpa-settings', 'cpa-query-history',
-- 'cpa-cmdsearch-history') e `value` guarda o valor bruto (string ou JSON serializado)
-- exatamente como era salvo lá — ver js/user-sync.js.
CREATE TABLE IF NOT EXISTS user_data (
  username   TEXT NOT NULL,
  data_key   TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (username, data_key)
);

-- Log de auditoria de comandos — uma linha por criação/edição/exclusão,
-- gravada no servidor (server/index.js, POST/PUT/DELETE /api/commands) para
-- que nenhum usuário possa apagar seu próprio rastro editando o front-end.
-- `command_name` fica DENORMALIZADO (copiado no momento do registro) porque um
-- 'delete' apaga a linha de `commands` — sem isso o log ficaria sem nome para
-- mostrar depois. Retenção de 30 dias: toda vez que uma linha nova é
-- inserida, o servidor também apaga (DELETE) linhas com mais de 30 dias — não
-- existe job/cron separado, é feito ali mesmo (ver logAudit() em
-- server/index.js). Consultado pelo botão "View audit log" em Configurações.
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL DEFAULT (datetime('now')),
  username     TEXT,
  action       TEXT NOT NULL, -- 'create' | 'update' | 'delete'
  command_id   TEXT,
  command_name TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts);

CREATE INDEX IF NOT EXISTS idx_commands_topic ON commands(topic);
CREATE INDEX IF NOT EXISTS idx_command_lines_command ON command_lines(command_id);
CREATE INDEX IF NOT EXISTS idx_command_diffs_command ON command_diffs(command_id);
