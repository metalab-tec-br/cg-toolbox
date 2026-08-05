// db.js — abre um pool de conexões PostgreSQL (cg-toolbox-db, container
// próprio — ver docker-compose.yml) e aplica schema.sql (idempotente —
// CREATE TABLE IF NOT EXISTS, então reexecutar é seguro).
//
// Antes (SQLite/better-sqlite3) isto era síncrono e abria um arquivo local;
// agora é assíncrono e conecta por rede/socket a um servidor Postgres
// separado. `initDb()` precisa ser aguardado (await) antes do servidor HTTP
// começar a aceitar requisições — ver server/index.js.
//
// Parâmetros de conexão: o driver `pg` já lê PGHOST/PGPORT/PGDATABASE/
// PGUSER/PGPASSWORD do ambiente automaticamente (mesma convenção do
// libpq/psql), então normalmente não é preciso passar nada explícito aqui —
// só DATABASE_URL como alternativa de conveniência (ex.: um único env var).
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const { hashPassword } = require('./auth');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const CONN = {
  host: process.env.PGHOST || process.env.DB_HOST || 'cg-toolbox-db',
  port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
  database: process.env.PGDATABASE || process.env.DB_NAME || 'cgtoolbox',
  user: process.env.PGUSER || process.env.DB_USER || 'cgtoolbox',
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || 'cgtoolbox',
};

const pool = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : CONN);

// Monta uma connection string a partir dos MESMOS parâmetros usados pelo pool
// acima — usada por server/index.js para invocar `pg_dump`/`pg_restore` (CLI
// externa, ver seção de Backup/Restore) com a garantia de apontar para
// exatamente o mesmo banco, mesmo se DATABASE_URL (e não as variáveis PG*
// individuais) tiver sido a forma usada para configurar a conexão.
function getConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { host, port, database, user, password } = CONN;
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

pool.on('error', err => {
  // Erros em conexões OCIOSAS do pool (ex.: o servidor Postgres derrubou a
  // conexão) não devem derrubar o processo Node inteiro — só logar. Erros de
  // uma query em andamento continuam sendo relançados normalmente para quem
  // chamou pool.query()/client.query().
  console.error('[db] Erro inesperado numa conexão ociosa do pool:', err.message);
});

// Tenta conectar/aplicar o schema a cada 2s até o Postgres responder — no
// docker-compose, o container cg-toolbox-db pode ainda estar inicializando
// quando cg-toolbox-backend sobe (mesmo com `depends_on` + healthcheck, é uma
// rede real, não um arquivo local — vale ter uma margem de segurança aqui).
async function initDb({ retries = 30, delayMs = 2000 } = {}) {
  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query(schemaSql);
      console.log('[db] Conectado ao PostgreSQL e schema aplicado.');
      await runMigrations();
      await seedDefaultAdmin();
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`[db] Falha ao conectar/aplicar schema (tentativa ${attempt}/${retries}): ${err.message} — tentando de novo em ${delayMs}ms...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

// Pequenos ajustes idempotentes em bancos que já existiam ANTES de uma coluna
// nova ser adicionada ao schema — `CREATE TABLE IF NOT EXISTS` (acima) não
// altera uma tabela que já existe de um deploy anterior, então uma coluna
// adicionada depois da criação inicial de uma tabela precisa de um
// `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` explícito aqui. Seguro rodar em
// todo boot, inclusive numa instalação nova onde a coluna já veio do CREATE
// TABLE (o IF NOT EXISTS simplesmente não faz nada nesse caso).
async function runMigrations() {
  try {
    // api_keys.role (admin|user) — ver comentário em schema.sql. DEFAULT
    // 'admin' preserva o acesso total das keys criadas antes deste campo
    // existir.
    await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'`);
    // api_keys.expires_at — ver comentário em schema.sql. Sem DEFAULT (NULL =
    // nunca expira), preservando o comportamento das keys criadas antes deste
    // campo existir.
    await pool.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);
  } catch (err) {
    console.error('[db] Falha ao rodar migrações:', err.message);
  }
}

// Garante que sempre existe pelo menos uma conta local com role='admin' —
// sem isso, uma instalação nova ficaria sem ninguém que pudesse acessar
// Manage users/Backup/Audit log/API keys. ON CONFLICT DO NOTHING: só roda na
// primeira vez (se alguém já trocou a senha ou renomeou/rebaixou 'admin',
// isto não mexe em nada depois).
async function seedDefaultAdmin() {
  try {
    await pool.query(
      `INSERT INTO users (username, password_hash, role, is_local, created_by)
       VALUES ('admin', $1, 'admin', 1, 'system')
       ON CONFLICT (username) DO NOTHING`,
      [hashPassword('admin')]
    );
  } catch (err) {
    console.error('[db] Falha ao semear usuário admin padrão:', err.message);
  }
}

// Executa `fn(client)` dentro de uma transação (BEGIN/COMMIT/ROLLBACK) usando
// um único client dedicado do pool — equivalente ao antigo `db.transaction()`
// síncrono do better-sqlite3, só que explícito e assíncrono.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* conexão já pode ter caído */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, initDb, withTransaction, getConnectionString };
