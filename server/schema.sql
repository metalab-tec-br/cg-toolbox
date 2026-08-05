-- ════════════════════════════════════════════════
-- Check Point Commands — schema relacional (PostgreSQL)
-- ════════════════════════════════════════════════
-- Convertido de SQLite para PostgreSQL (cg-toolbox-db, container próprio —
-- ver docker-compose.yml) como parte da separação em 3 containers
-- (cg-toolbox-db / cg-toolbox-backend / cg-toolbox-frontend). O backend
-- (server/db.js) aplica este arquivo por inteiro a cada boot — todo comando
-- é CREATE TABLE IF NOT EXISTS, então reexecutar é seguro (idempotente).
--
-- Este banco não é semeado automaticamente (ver server/db.js) — todas as
-- tabelas começam vazias e continuam vazias até serem populadas manualmente
-- (tela de administração de catálogo / editor de comandos / importação CSV),
-- exceto se `node seed.js` for rodado explicitamente (ver server/seed.js).
--
-- Um comando (fw monitor, tcpdump, cplic print, ...) é um registro em `commands`,
-- com uma ou mais linhas de terminal associadas (`command_lines`). Comandos que
-- variam de sintaxe entre versões (R81.10/R81.20/R82/R82.10) têm blocos extras
-- em `command_diffs`/`command_diff_lines` (o bloco expansível "Diferenças por
-- versão / plataforma" da UI).
--
-- Todo o texto da aplicação (banco + UI) é em inglês, sem bilinguismo.
--
-- Templates de conteúdo podem conter placeholders {{src_ip}}, {{dst_ip}}, {{src_port}}, {{dst_port}},
-- {{proto}}, {{iface}}, {{vsid}}, {{capFile}}, {{dbgFile}}, {{logFile}} — resolvidos
-- em tempo de render pelo front-end. Um pequeno subconjunto de comandos avançados
-- (que hoje calculam CIDR/listas/faixas de IP e regex de filtro — fw monitor,
-- tcpdump, fw ctl zdebug, fw tab, ip route get, fwaccel conns, fw fetchlogs,
-- fwm logexport) mantém esse cálculo em JS (net-utils.js) e é referenciado via
-- `placeholder_resolver` — o valor calculado substitui o placeholder correspondente
-- em vez de ser puro texto estático.
--
-- Notas de conversão SQLite → PostgreSQL:
--   * INTEGER PRIMARY KEY AUTOINCREMENT  -> SERIAL PRIMARY KEY / BIGSERIAL
--   * datetime('now')                    -> NOW() (colunas viram TIMESTAMPTZ)
--   * Flags booleanas (requires_ips, ...) continuam INTEGER 0/1 (não BOOLEAN)
--     de propósito — o backend já trata como `!!row.requires_ips` e o driver
--     `pg` devolve INTEGER como Number, então nenhuma mudança de código era
--     necessária além da própria query.
--   * PRAGMA foreign_keys = ON não existe no Postgres — FKs já são sempre
--     aplicadas.

CREATE TABLE IF NOT EXISTS commands (
  id                  TEXT PRIMARY KEY,     -- slug estável, ex.: 'fwmonitor', 'cplic-print'
  topic               TEXT NOT NULL,        -- tópico primário (= topics[0]), ver command_topics abaixo
  icon                TEXT NOT NULL DEFAULT '📄',
  sort_order          INTEGER NOT NULL DEFAULT 0,
  requires_ips        INTEGER NOT NULL DEFAULT 0,   -- 1 = card muda de conteúdo quando SRC/DST não preenchidos
  requires_ip_port    INTEGER NOT NULL DEFAULT 0,   -- 1 = card muda de conteúdo quando IP/Porta (genéricos, sem direção) não preenchidos
  placeholder_resolver TEXT,                -- nome da função JS usada p/ resolver placeholders avançados (nullable)
  raw_template        TEXT NOT NULL DEFAULT '', -- texto copiado pelo botão "copiar" (com placeholders)

  name                TEXT NOT NULL,
  name_empty          TEXT,                 -- variante do nome quando requires_ips=1 (IPs vazios) ou requires_ip_port=1 (IP/Porta vazios) (opcional)

  "desc"              TEXT NOT NULL DEFAULT '', -- nome entre aspas: "desc" é palavra reservada no PostgreSQL
  desc_empty          TEXT,

  about_icon          TEXT NOT NULL DEFAULT 'ℹ️',
  about_purpose       TEXT NOT NULL DEFAULT '',
  about_when          TEXT NOT NULL DEFAULT '',
  about_obs           TEXT NOT NULL DEFAULT '',

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Autoria/auditoria. `created_by = 'System'` marca um comando de referência
  -- (rebuild a partir dos Admin Guides oficiais). PUT/DELETE não têm mais
  -- restrição de dono (task #291) — qualquer usuário autenticado pode
  -- editar/excluir qualquer comando; `modified_by` registra quem fez a
  -- última alteração (cai em created_by antes da 1ª edição).
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
-- linha aqui. `commands.topic` é mantido em paralelo como "tópico primário"
-- (topics[0]) só por compatibilidade — a lista completa em command_topics é a
-- fonte de verdade para agrupamento/filtro.
CREATE TABLE IF NOT EXISTS command_topics (
  command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  topic      TEXT NOT NULL,
  PRIMARY KEY (command_id, topic)
);
CREATE INDEX IF NOT EXISTS idx_command_topics_topic ON command_topics(topic);

-- ════════════════════════════════════════════════
-- Catálogos administráveis (Vendor / Sistema / Versão / Ambiente / Tópico /
-- Parâmetro) — cadastráveis pela tela de administração de catálogo. `key` é
-- o identificador estável usado nas tabelas de vínculo acima — por isso NUNCA
-- é editável depois de criado (só label/cor/ordem). Exclusão é bloqueada em
-- server/index.js quando o valor estiver em uso por pelo menos um comando.
-- ════════════════════════════════════════════════

-- Vendor → Sistema → Versão é uma hierarquia ESTRITA (1:N): um Sistema
-- pertence a exatamente um Vendor (`systems.vendor`, FK obrigatória) e uma
-- Versão pertence a exatamente um Sistema (`versions.system`, FK obrigatória).
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

-- Versões (ex.: R81.10, R82). Chave primária composta (system, key) porque o
-- mesmo nome de versão pode se repetir em Sistemas diferentes; UNIQUE(vendor,
-- key) impede repetição dentro do MESMO Vendor mesmo entre Sistemas dele
-- (`vendor` é denormalizado a partir de systems.vendor, mantido em sincronia
-- pelo backend).
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

CREATE TABLE IF NOT EXISTS environments (
  key        TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#8B949E',
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ── Vínculo N:N Versão ↔ Ambiente ── `version` é guardado só como TEXT (sem
-- FK formal), mesmo padrão "soft" de command_versions, já que o mesmo `key`
-- de versão pode existir em mais de um Sistema.
CREATE TABLE IF NOT EXISTS version_environments (
  version     TEXT NOT NULL,
  environment TEXT NOT NULL REFERENCES environments(key) ON DELETE CASCADE,
  PRIMARY KEY (version, environment)
);

-- Tópicos (ex.: capture, vpn). `is_protected` = 1 marca o tópico especial
-- 'environment' (usado internamente para os cards de "Ambiente específico"):
-- não pode ser excluído e fica fora dos filtros de Tópico.
CREATE TABLE IF NOT EXISTS topics (
  key           TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
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
-- barra superior e botão "Inserir variável" do editor de comandos). `key` é
-- o nome do placeholder {{key}} usado nos templates. NUNCA editável depois de
-- criado. Exclusão é bloqueada em server/index.js quando: (a) é 'src_ip'/
-- 'dst_ip' e algum comando tem requires_ips=1; (b) é 'ip'/'port' e algum
-- comando tem requires_ip_port=1; (c) {{key}} aparece em algum template.
CREATE TABLE IF NOT EXISTS parameters (
  key            TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

-- Tags/badges exibidos no cabeçalho do card (ex.: PRINCIPAL/NGFW, CUIDADO/KERNEL).
CREATE TABLE IF NOT EXISTS command_tags (
  id         SERIAL PRIMARY KEY,
  command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  css_class  TEXT NOT NULL,      -- t-red | t-blue | t-teal | t-yellow | t-orange | t-purple | t-green
  label      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Linhas de terminal do card. `variant` distingue o bloco normal do bloco
-- "placeholder" mostrado quando requires_ips=1 e SRC/DST (ou requires_ip_port=1 e IP/Porta) ainda não foram preenchidos.
CREATE TABLE IF NOT EXISTS command_lines (
  id             SERIAL PRIMARY KEY,
  command_id     TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  variant        TEXT NOT NULL DEFAULT 'default',  -- 'default' | 'empty'
  sort_order     INTEGER NOT NULL DEFAULT 0,
  line_type      TEXT NOT NULL DEFAULT 'cmd',      -- cmd | note | warn | info | ok | image
  prompt         TEXT,                              -- ex.: '[Expert@FW]#' (NULL para note/warn/info/ok/image)
  content        TEXT NOT NULL DEFAULT '',          -- para line_type='image', guarda o NOME exibido no lugar do comando
  supports_export INTEGER NOT NULL DEFAULT 0,       -- 1 = linha 'cmd' de leitura cujo output pode ser
                                                     -- redirecionado a um arquivo (ver db-render-engine.js)
  image_data     TEXT                               -- só para line_type='image': a imagem em si, como
                                                     -- data URI base64, enviada por upload/paste no editor
);

-- Bloco expansível "Diferenças por versão / plataforma".
CREATE TABLE IF NOT EXISTS command_diffs (
  id          SERIAL PRIMARY KEY,
  command_id  TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  version     TEXT NOT NULL,       -- versão/rótulo mostrado na tag do diff (ex.: 'R82+', 'R81.x')
  note        TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS command_diff_lines (
  id          SERIAL PRIMARY KEY,
  diff_id     INTEGER NOT NULL REFERENCES command_diffs(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  line_type   TEXT NOT NULL DEFAULT 'cmd',
  prompt      TEXT,
  content     TEXT NOT NULL DEFAULT ''
);

-- ════════════════════════════════════════════════
-- Multiusuário — servidor central compartilhado, um usuário por login do
-- Windows (identificado via NTLM na camada HTTP) ou por API key (acesso
-- programático externo — ver api_keys abaixo). `username` é sempre
-- "DOMÍNIO\usuario", só "usuario", ou "api:<nome da key>" (texto livre, sem
-- FK — não há uma tabela de usuários).
-- ════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_favorites (
  username   TEXT NOT NULL,
  command_id TEXT NOT NULL REFERENCES commands(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (username, command_id)
);
CREATE INDEX IF NOT EXISTS idx_user_favorites_command ON user_favorites(command_id);

-- Armazenamento genérico chave/valor por usuário — tema, idioma, configurações,
-- históricos de busca (ver js/user-sync.js). `data_key` reaproveita as MESMAS
-- chaves usadas no front-end e `value` guarda o valor bruto (string ou JSON
-- serializado).
CREATE TABLE IF NOT EXISTS user_data (
  username   TEXT NOT NULL,
  data_key   TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (username, data_key)
);

-- Log de auditoria de comandos — uma linha por criação/edição/exclusão.
-- `command_name` fica DENORMALIZADO (copiado no momento do registro) porque um
-- 'delete' apaga a linha de `commands`. Retenção de 30 dias, aplicada inline
-- a cada gravação (ver logAudit() em server/index.js) — sem job/cron separado.
CREATE TABLE IF NOT EXISTS audit_log (
  id           SERIAL PRIMARY KEY,
  ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  username     TEXT,
  action       TEXT NOT NULL, -- 'create' | 'update' | 'delete'
  command_id   TEXT,
  command_name TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts);

-- ════════════════════════════════════════════════
-- API keys — acesso programático externo ao backend (ex.: integrações,
-- scripts), gerenciável pela UI (Settings → System → API access). Cada key só
-- é exibida em texto puro NO MOMENTO da criação (POST /api/api-keys) — depois
-- disso só o hash (SHA-256) fica guardado, então perder a key mostrada
-- significa ter que revogar e criar uma nova (mesmo modelo de qualquer
-- provedor de API key). `revoked_at` é soft-delete (mantém histórico/rastro
-- em vez de apagar a linha) — uma key revogada nunca mais autentica.
--
-- `role` (admin|user) — mesmo modelo de permissões de users.role (ver
-- getCurrentRole/requireAdmin em server/index.js): uma key 'user' passa pelos
-- mesmos gates que um usuário comum (sem acesso a excluir comandos, backup &
-- restore, audit log, gerenciar chaves/usuários). DEFAULT 'admin' aqui é só
-- para preservar, sem quebrar nada, o comportamento das keys já existentes
-- antes deste campo existir (acesso total) — toda key NOVA criada pela UI
-- escolhe o role explicitamente (padrão 'user', ver #apiKeyRoleSelect em
-- index.html), seguindo o mesmo princípio de menor privilégio dos usuários
-- locais/NTLM.
-- ════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS api_keys (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  key_prefix    TEXT NOT NULL,        -- primeiros caracteres da key, só para identificação visual na lista
  key_hash      TEXT NOT NULL UNIQUE, -- SHA-256 (hex) da key completa
  role          TEXT NOT NULL DEFAULT 'admin',
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,          -- NULL = nunca expira ("Never" na criação); calculado a
                                      -- partir da validade escolhida (1 day/1 week/1 month/1
                                      -- year/Never) — ver POST /api/api-keys em server/index.js.
                                      -- Uma key com expires_at no passado para de autenticar
                                      -- (ver authenticateApiKey), mas a linha continua existindo
                                      -- até ser excluída manualmente.
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ           -- legado: soft-delete usado antes da ação "Delete" virar
                                      -- exclusão real (DELETE FROM). Mantido só para não quebrar
                                      -- linhas antigas já revogadas antes desta mudança — chaves
                                      -- excluídas a partir de agora são removidas da tabela.
);

-- ════════════════════════════════════════════════
-- Usuários e permissões — todo `username` que a aplicação já viu (login do
-- Windows via NTLM, ou conta local) tem uma linha aqui, com um `role`
-- ('user' | 'admin'). Contas NTLM são provisionadas automaticamente na
-- primeira vez que são vistas (is_local=0, role='user', sem password_hash —
-- nunca fazem login por senha, só são "vistas" para poder ter um role
-- atribuído). Contas locais (is_local=1) fazem login por usuário/senha (ver
-- POST /api/auth/login em server/index.js) e são criadas/gerenciadas só por
-- administradores em Settings → System → Manage users. A conta local
-- 'admin'/'admin' é semeada automaticamente pelo backend (ver server/db.js)
-- logo após este schema ser aplicado — TROQUE A SENHA em produção.
--
-- role='admin' é exigido para: excluir comandos, Backup & Restore, ver o
-- audit log, gerenciar API keys e gerenciar usuários (ver requireAdmin() em
-- server/index.js). Toda outra operação (criar/editar comando, favoritos,
-- preferências) continua liberada para qualquer usuário identificado.
-- ════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
  username      TEXT PRIMARY KEY,
  password_hash TEXT,                          -- scrypt "salt:hash" (hex) — NULL para contas NTLM (is_local=0)
  role          TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  is_local      INTEGER NOT NULL DEFAULT 0,     -- 1 = conta local (login usuário/senha); 0 = identificada via Windows/NTLM
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    TEXT
);

-- Sessões de login local — o cookie `cg_session` guarda só o token (chave
-- primária desta tabela); nenhum dado sensível viaja no cookie em si. Uma
-- sessão local tem prioridade sobre a identificação NTLM enquanto for válida
-- (permite "logout" do usuário do Windows e login com outra credencial sem
-- precisar fechar o navegador) — ver o middleware de sessão em
-- server/index.js, logo depois do middleware de API key.
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_commands_topic ON commands(topic);
CREATE INDEX IF NOT EXISTS idx_command_lines_command ON command_lines(command_id);
CREATE INDEX IF NOT EXISTS idx_command_diffs_command ON command_diffs(command_id);
