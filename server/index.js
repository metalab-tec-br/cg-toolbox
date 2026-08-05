// index.js — Express app: expõe SÓ a API REST /api/* (PostgreSQL via
// server/db.js, node-postgres). Não serve mais o frontend estático — isso
// agora é responsabilidade do container cg-toolbox-frontend (nginx), que
// também faz proxy reverso de /api/* para este backend (cg-toolbox-backend)
// — ver docker-compose.yml e frontend/nginx.conf. O browser nunca fala
// direto com este processo.
//
// Autenticação/identificação de quem está chamando a API, em ordem de
// prioridade:
//   1) Header `X-API-Key` — acesso programático externo (integrações,
//      scripts). Ver api_keys em schema.sql e a seção "API keys" abaixo.
//      Quando presente, o handshake NTLM é pulado inteiramente (um cliente
//      HTTP simples como curl não sabe negociar NTLM).
//   2) NTLM — login do Windows de quem está no navegador (silencioso, sem
//      prompt de senha, desde que o site esteja na zona "Intranet local").
//   3) Fallback dev: header x-dev-user / query __user / usuário do SO.
//
// Regra de PERMISSÃO: PUT/DELETE /api/commands/:id não têm restrição de dono
// (task #291) — qualquer usuário autenticado pode editar/excluir qualquer
// comando, inclusive os de referência (created_by='System'). `modified_by`
// sempre registra quem fez a última alteração, e toda criação/edição/exclusão
// fica no audit_log (ver logAudit()).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const express = require('express');
const { pool, initDb, withTransaction, getConnectionString } = require('./db');
const { hashPassword, verifyPassword, generateSessionToken } = require('./auth');

const app = express();

const PORT = process.env.PORT || process.env.HTTP_PORT || 3000;

// Limite maior que o padrão do Express (100kb) para caber o payload de um
// comando com uma ou mais linhas de imagem (screenshots de configuração,
// ver command_lines.image_data em schema.sql) — a imagem viaja em base64
// dentro do JSON, ~33% maior que o arquivo original.
app.use(express.json({ limit: '15mb' }));

// ════════════════════════════════════════════════
// API keys — autenticação para acesso programático externo (ver api_keys em
// schema.sql e a seção CRUD mais abaixo). Verificado ANTES do NTLM: uma
// chamada com X-API-Key nunca deve travar num handshake NTLM.
// ════════════════════════════════════════════════
function hashApiKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}
function generateApiKey() {
  // Prefixo "cgtb_" (CG Toolbox) só facilita reconhecer o tipo de segredo em
  // logs/scanners — o valor que importa é o restante, aleatório (32 bytes).
  return 'cgtb_' + crypto.randomBytes(32).toString('hex');
}
async function authenticateApiKey(rawKey) {
  const hash = hashApiKey(rawKey);
  // expires_at IS NULL => "Never" (nunca expira); do contrário só autentica
  // enquanto expires_at ainda estiver no futuro (ver api_keys.expires_at em
  // schema.sql e a validade escolhida em POST /api/api-keys abaixo).
  const { rows } = await pool.query(
    `SELECT * FROM api_keys
     WHERE key_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`,
    [hash]
  );
  if (!rows.length) return null;
  // Best-effort — não bloqueia a resposta por causa disso.
  pool.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [rows[0].id]).catch(() => {});
  return rows[0];
}

app.use(async (req, res, next) => {
  const provided = req.headers['x-api-key'];
  if (!provided) return next();
  try {
    const keyRow = await authenticateApiKey(String(provided));
    if (!keyRow) return res.status(401).json({ error: 'invalid_api_key', message: 'Invalid, revoked, or expired API key' });
    req.apiKey = keyRow;
    req.currentUser = `api:${keyRow.name}`;
    next();
  } catch (err) {
    console.error('API key auth failed:', err);
    res.status(500).json({ error: 'internal_error', message: 'Failed to validate API key' });
  }
});

// ════════════════════════════════════════════════
// Login local (usuário/senha) — sessão via cookie `cg_session`, ver users/
// sessions em schema.sql e server/auth.js. Verificado ANTES do NTLM, com a
// MESMA prioridade que API key (se já autenticado, pula o handshake NTLM
// inteiramente) — isso é o que permite "logout" do usuário identificado pelo
// Windows e login com outra credencial, sem fechar o navegador: enquanto o
// cookie de sessão local for válido, ele manda, independente do que o NTLM
// diria sobre quem está logado no Windows.
// ════════════════════════════════════════════════
const SESSION_COOKIE_NAME = 'cg_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}
function setSessionCookie(res, token) {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

app.use(async (req, res, next) => {
  if (req.currentUser) return next(); // já autenticado por API key acima
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (!token) return next();
  try {
    const { rows } = await pool.query(
      `SELECT s.username, u.role, u.disabled FROM sessions s
       JOIN users u ON u.username = s.username
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [token]
    );
    if (rows.length && !rows[0].disabled) {
      req.currentUser = rows[0].username;
      req.userRole = rows[0].role;
      req.authMethod = 'local';
    }
  } catch (err) {
    console.error('Session lookup failed:', err);
  }
  next();
});

// ════════════════════════════════════════════════
// NTLM (identificação do login do Windows, navegador) — pulado inteiramente
// quando a chamada já veio autenticada por API key OU sessão local (acima).
// Definir NTLM_DISABLED=1 desliga isso (útil para desenvolvimento fora de um
// domínio Windows) — nesse caso aceita um header/query de teste ou cai para
// o usuário do sistema operacional rodando o processo Node.
// ════════════════════════════════════════════════
const NTLM_DISABLED = process.env.NTLM_DISABLED === '1';
if (!NTLM_DISABLED) {
  const ntlm = require('express-ntlm');
  const ntlmMiddleware = ntlm({
    domain: process.env.NTLM_DOMAIN || undefined,
    // domaincontroller não configurado de propósito: identifica o usuário pelo
    // handshake NTLM do próprio Windows, sem validar contra o Active Directory —
    // suficiente aqui, já que isto é só identificação/conveniência (favoritos,
    // preferências), não uma barreira de segurança.
  });
  app.use((req, res, next) => {
    if (req.currentUser) return next(); // já autenticado por API key ou sessão local acima
    return ntlmMiddleware(req, res, next);
  });
}
function getCurrentUsername(req) {
  if (req.currentUser) return req.currentUser; // API key (ver middleware acima)
  if (req.ntlm && req.ntlm.UserName) {
    return req.ntlm.DomainName ? `${req.ntlm.DomainName}\\${req.ntlm.UserName}` : req.ntlm.UserName;
  }
  const devUser = req.headers['x-dev-user'] || req.query.__user;
  if (devUser) return String(devUser);
  try { return os.userInfo().username; } catch (e) { return 'guest'; }
}
// ════════════════════════════════════════════════
// AUDIT LOG — uma linha por criação/edição/exclusão de comando (ver
// audit_log em schema.sql). Chamado nos 3 handlers POST/PUT/DELETE
// /api/commands abaixo. Retenção de 30 dias: toda gravação também apaga
// linhas mais antigas que isso, sem precisar de job/cron separado.
// ════════════════════════════════════════════════
const AUDIT_LOG_RETENTION_DAYS = 30;
async function logAudit(username, action, commandId, commandName) {
  try {
    await pool.query(
      'INSERT INTO audit_log (username, action, command_id, command_name) VALUES ($1,$2,$3,$4)',
      [username || null, action, commandId || null, commandName || null]
    );
    await pool.query(`DELETE FROM audit_log WHERE ts < NOW() - INTERVAL '${AUDIT_LOG_RETENTION_DAYS} days'`);
  } catch (e) {
    console.error('logAudit failed:', e);
  }
}

// sAMAccountName "puro" (sem DOMÍNIO\), usado como chave de busca no Active
// Directory — o NTLM já entrega isso separado do domínio (req.ntlm.UserName).
function getCurrentSamAccountName(req) {
  if (req.apiKey) return req.currentUser; // não há AD a consultar para uma API key
  if (req.ntlm && req.ntlm.UserName) return req.ntlm.UserName;
  const devUser = req.headers['x-dev-user'] || req.query.__user;
  if (devUser) return String(devUser).split('\\').pop();
  try { return os.userInfo().username; } catch (e) { return 'guest'; }
}

// ════════════════════════════════════════════════
// Permissões (users.role) — ver users/sessions em schema.sql. Contas NTLM
// são provisionadas na primeira vez que são VISTAS (não no login, já que não
// existe "login" NTLM de verdade) — sempre com role='user'; só um admin pode
// promover alguém depois (Settings → System → Manage users). API keys
// continuam com acesso total (bypass deste gate) — são um canal de
// integração externa separado, já protegido pela posse da própria key, sem
// mudança de comportamento em relação ao que já existia antes deste recurso.
// ════════════════════════════════════════════════
async function getOrCreateUserRole(username) {
  const { rows } = await pool.query('SELECT role, disabled FROM users WHERE username = $1', [username]);
  if (rows.length) return rows[0].disabled ? null : rows[0].role;
  await pool.query(
    'INSERT INTO users (username, role, is_local) VALUES ($1, $2, 0) ON CONFLICT (username) DO NOTHING',
    [username, 'user']
  );
  return 'user';
}

async function getCurrentRole(req) {
  // Ver api_keys.role em schema.sql — keys criadas antes deste campo existir
  // ficam com o DEFAULT 'admin' (mesmo acesso total de sempre); keys novas
  // escolhem 'admin' ou 'user' na criação (ver POST /api/api-keys abaixo).
  if (req.apiKey) return req.apiKey.role || 'admin';
  if (req.userRole) return req.userRole; // já resolvido pelo middleware de sessão local
  return getOrCreateUserRole(getCurrentUsername(req));
}

async function requireAdmin(req, res, next) {
  try {
    const role = await getCurrentRole(req);
    if (role !== 'admin') return res.status(403).json({ error: 'forbidden', message: 'Admin role required for this action' });
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
}

// Impede que uma ação deixe a aplicação sem NENHUM admin habilitado (evita
// lockout total — sem um admin, ninguém mais consegue acessar Manage users
// para corrigir isso). `excludeUsername` é o usuário sendo rebaixado/
// desabilitado/excluído — não conta ele mesmo na checagem.
async function countEnabledAdmins(excludeUsername) {
  const sql = "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0" + (excludeUsername ? ' AND username != $1' : '');
  const { rows } = await pool.query(sql, excludeUsername ? [excludeUsername] : []);
  return Number(rows[0].n);
}

// ════════════════════════════════════════════════
// Login/logout local (usuário/senha) — ver seção de cookie/sessão acima.
// Qualquer usuário identificado (por Windows/NTLM ou já em sessão local)
// pode fazer login com uma conta local diferente a qualquer momento — isso
// simplesmente troca qual sessão está ativa nesta aba/navegador.
// ════════════════════════════════════════════════
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'validation_error', message: '"username" and "password" are required' });
  }
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1 AND is_local = 1', [String(username).trim()]);
    const user = rows[0];
    if (!user || user.disabled || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'invalid_credentials', message: 'Invalid username or password' });
    }
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await pool.query('INSERT INTO sessions (token, username, expires_at) VALUES ($1, $2, $3)', [token, user.username, expiresAt]);
    setSessionCookie(res, token);
    res.json({ username: user.username, role: user.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = parseCookies(req)[SESSION_COOKIE_NAME];
    if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    clearSessionCookie(res);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// UPN (User Principal Name, ex.: rsilva@empresa.com) via Active Directory
// O NTLM só entrega DOMÍNIO\usuario (sAMAccountName) — o UPN de verdade exige uma
// consulta LDAP ao Active Directory. Configuração via variáveis de ambiente:
//   AD_DOMAIN_CONTROLLER  ex.: ldap://dc01.empresa.local  (obrigatório p/ habilitar)
//   AD_BASE_DN            ex.: DC=empresa,DC=local        (obrigatório p/ habilitar)
//   AD_BIND_DN            conta de serviço p/ autenticar a busca (opcional se o AD aceitar bind anônimo)
//   AD_BIND_PASSWORD      senha da conta de serviço (opcional, junto com AD_BIND_DN)
// Sem essas variáveis, a busca é simplesmente pulada e a UI cai no formato
// DOMÍNIO\usuario (comportamento atual) — nunca trava a aplicação.
// ════════════════════════════════════════════════
const AD_DOMAIN_CONTROLLER = process.env.AD_DOMAIN_CONTROLLER || null;
const AD_BASE_DN = process.env.AD_BASE_DN || null;
const AD_BIND_DN = process.env.AD_BIND_DN || null;
const AD_BIND_PASSWORD = process.env.AD_BIND_PASSWORD || '';
const AD_ENABLED = !!(AD_DOMAIN_CONTROLLER && AD_BASE_DN);
const UPN_CACHE_TTL_MS = 60 * 60 * 1000; // 1h — UPN quase nunca muda; evita bater no AD a cada requisição
const _upnCache = new Map(); // sAMAccountName -> { upn, ts }

// Escapa caracteres especiais de filtro LDAP (RFC 4515) antes de embutir o
// sAMAccountName no filtro de busca.
function escapeLdapFilterValue(v) {
  return String(v).replace(/[\\*()\0]/g, c => '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'));
}

async function lookupUpnFromAD(samAccountName) {
  if (!AD_ENABLED || !samAccountName) return null;
  const cached = _upnCache.get(samAccountName);
  if (cached && (Date.now() - cached.ts) < UPN_CACHE_TTL_MS) return cached.upn;

  let client;
  try {
    const { Client } = require('ldapts');
    client = new Client({ url: AD_DOMAIN_CONTROLLER, timeout: 5000, connectTimeout: 3000 });
    if (AD_BIND_DN) await client.bind(AD_BIND_DN, AD_BIND_PASSWORD);
    const { searchEntries } = await client.search(AD_BASE_DN, {
      scope: 'sub',
      filter: `(sAMAccountName=${escapeLdapFilterValue(samAccountName)})`,
      attributes: ['userPrincipalName'],
    });
    const entry = searchEntries[0];
    const upn = (entry && entry.userPrincipalName) ? String(entry.userPrincipalName) : null;
    _upnCache.set(samAccountName, { upn, ts: Date.now() });
    return upn;
  } catch (err) {
    console.warn(`[AD] Falha ao buscar UPN de '${samAccountName}':`, err.message);
    _upnCache.set(samAccountName, { upn: null, ts: Date.now() }); // não martela o AD de novo por 1h se estiver fora do ar
    return null;
  } finally {
    if (client) { try { await client.unbind(); } catch (e) {} }
  }
}

// ════════════════════════════════════════════════
// Helpers de leitura de comandos
// ════════════════════════════════════════════════
// `username` é usado só para calcular folder_ids (pastas do usuário ATUAL que
// contêm este comando — pastas são privadas, ver comentário acima de
// GET /api/folders). Opcional: chamadores que não têm um usuário resolvido
// (não deveria acontecer em uso normal, getCurrentUsername sempre devolve
// algo) simplesmente recebem folder_ids: [].
async function shapeCommand(row, username) {
  const [tagsQ, vendorsQ, systemsQ, versionsQ, envQ, topicsQ, folderQ, linesQ, diffsQ] = await Promise.all([
    pool.query('SELECT css_class, label FROM command_tags WHERE command_id = $1 ORDER BY sort_order, id', [row.id]),
    pool.query('SELECT vendor FROM command_vendors WHERE command_id = $1 ORDER BY vendor', [row.id]),
    pool.query('SELECT system FROM command_systems WHERE command_id = $1 ORDER BY system', [row.id]),
    pool.query('SELECT version FROM command_versions WHERE command_id = $1 ORDER BY version', [row.id]),
    pool.query('SELECT environment FROM command_environments WHERE command_id = $1 ORDER BY environment', [row.id]),
    pool.query('SELECT topic FROM command_topics WHERE command_id = $1 ORDER BY topic', [row.id]),
    username
      ? pool.query(
          `SELECT fc.folder_id FROM folder_commands fc
           JOIN folders f ON f.id = fc.folder_id
           WHERE fc.command_id = $1 AND f.username = $2
           ORDER BY fc.folder_id`,
          [row.id, username]
        )
      : Promise.resolve({ rows: [] }),
    pool.query('SELECT variant, sort_order, line_type, prompt, content, supports_export, image_data FROM command_lines WHERE command_id = $1 ORDER BY variant, sort_order, id', [row.id]),
    pool.query('SELECT id, version, note, sort_order FROM command_diffs WHERE command_id = $1 ORDER BY sort_order, id', [row.id]),
  ]);

  const tags = tagsQ.rows.map(t => ({ css_class: t.css_class, label: t.label }));
  const vendors = vendorsQ.rows.map(v => v.vendor);
  const systemList = systemsQ.rows.map(s => s.system);
  const versions = versionsQ.rows.map(v => v.version);
  const environments = envQ.rows.map(e => e.environment);
  const topics = topicsQ.rows.map(t => t.topic);
  const folderIds = folderQ.rows.map(f => f.folder_id);

  const shapeLine = l => ({
    line_type: l.line_type,
    prompt: l.prompt,
    content: l.content,
    supports_export: !!l.supports_export,
    image_data: l.image_data || null,
  });

  const lines = {
    default: linesQ.rows.filter(l => l.variant === 'default').map(shapeLine),
    empty: linesQ.rows.filter(l => l.variant === 'empty').map(shapeLine),
  };

  const diffRows = diffsQ.rows;
  const diffLineResults = await Promise.all(
    diffRows.map(d => pool.query('SELECT sort_order, line_type, prompt, content FROM command_diff_lines WHERE diff_id = $1 ORDER BY sort_order, id', [d.id]))
  );
  const diffs = diffRows.map((d, i) => ({
    version: d.version,
    note: d.note,
    lines: diffLineResults[i].rows.map(shapeLine),
  }));

  return {
    id: row.id,
    topic: row.topic,
    topics: topics.length ? topics : [row.topic],
    folder_ids: folderIds,
    icon: row.icon,
    sort_order: row.sort_order,
    requires_ips: !!row.requires_ips,
    requires_ip_port: !!row.requires_ip_port,
    placeholder_resolver: row.placeholder_resolver,
    raw_template: row.raw_template,
    name: row.name,
    name_empty: row.name_empty,
    desc: row.desc,
    desc_empty: row.desc_empty,
    about: {
      icon: row.about_icon,
      purpose: row.about_purpose,
      when: row.about_when,
      obs: row.about_obs,
    },
    tags,
    vendors,
    systems: systemList,
    versions,
    environments,
    lines,
    diffs,
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by || null,
    modified_by: row.modified_by || row.created_by || null,
    is_system: row.created_by === 'System',
  };
}

async function findCommand(id) {
  const { rows } = await pool.query('SELECT * FROM commands WHERE id = $1', [id]);
  return rows[0] || null;
}

// Mantido para compatibilidade com os poucos lugares que só precisam saber SE
// o comando existe (ex.: POST /api/folders/:id/commands/:commandId).
async function getCommandRow(id) {
  return findCommand(id);
}

// ════════════════════════════════════════════════
// GET /api/commands
// ════════════════════════════════════════════════
app.get('/api/commands', async (req, res) => {
  try {
    const { topic, version, environment, vendor, system: systemParam, sort } = req.query;

    let sql = 'SELECT * FROM commands WHERE 1=1';
    const params = [];
    if (topic) {
      params.push(topic);
      // Um comando pode ter vários tópicos (command_topics) — casa se QUALQUER um bater.
      sql += ` AND EXISTS (SELECT 1 FROM command_topics ct WHERE ct.command_id = commands.id AND ct.topic = $${params.length})`;
    }
    if (vendor) {
      params.push(vendor);
      sql += ` AND (
        NOT EXISTS (SELECT 1 FROM command_vendors cv WHERE cv.command_id = commands.id)
        OR EXISTS (SELECT 1 FROM command_vendors cv WHERE cv.command_id = commands.id AND cv.vendor = $${params.length})
      )`;
    }
    if (systemParam) {
      params.push(systemParam);
      sql += ` AND (
        NOT EXISTS (SELECT 1 FROM command_systems cs WHERE cs.command_id = commands.id)
        OR EXISTS (SELECT 1 FROM command_systems cs WHERE cs.command_id = commands.id AND cs.system = $${params.length})
      )`;
    }
    if (version) {
      params.push(version);
      sql += ` AND (
        NOT EXISTS (SELECT 1 FROM command_versions cv WHERE cv.command_id = commands.id)
        OR EXISTS (SELECT 1 FROM command_versions cv WHERE cv.command_id = commands.id AND cv.version = $${params.length})
      )`;
    }
    if (environment) {
      params.push(environment);
      sql += ` AND (
        NOT EXISTS (SELECT 1 FROM command_environments ce WHERE ce.command_id = commands.id)
        OR EXISTS (SELECT 1 FROM command_environments ce WHERE ce.command_id = commands.id AND ce.environment = $${params.length})
      )`;
    }
    // Ordenação padrão é a curatorial (sort_order/id) de sempre. `?sort=creator`
    // reordena a lista por quem cadastrou o comando (created_by).
    sql += (sort === 'creator') ? ' ORDER BY created_by, sort_order, id' : ' ORDER BY sort_order, id';

    const { rows } = await pool.query(sql, params);
    const username = getCurrentUsername(req);
    const shaped = await Promise.all(rows.map(r => shapeCommand(r, username)));
    res.json(shaped);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// GET /api/commands/:id
// ════════════════════════════════════════════════
app.get('/api/commands/:id', async (req, res) => {
  try {
    const row = await findCommand(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found', message: `Command '${req.params.id}' not found` });
    res.json(await shapeCommand(row, getCurrentUsername(req)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// GET /api/me — usuário identificado (login do Windows via NTLM, API key, ou fallback dev)
// ════════════════════════════════════════════════
app.get('/api/me', async (req, res) => {
  const username = getCurrentUsername(req);
  let upn = null;
  try { upn = await lookupUpnFromAD(getCurrentSamAccountName(req)); } catch (e) { /* já logado em lookupUpnFromAD */ }
  let role = 'admin';
  try { role = await getCurrentRole(req); } catch (e) { console.error('getCurrentRole failed:', e); }
  res.json({
    username,
    upn: upn || username,
    role,
    isAdmin: role === 'admin',
    authMethod: req.apiKey ? 'api_key' : (req.authMethod === 'local' ? 'local' : 'ntlm'),
  });
});

// ════════════════════════════════════════════════
// Folders — substitui a antiga feature "Favorites" (ver migração de dados em
// server/db.js::runMigrations()). Cada usuário organiza comandos em pastas
// PRÓPRIAS (nome livre) e um mesmo comando pode estar em várias pastas ao
// mesmo tempo (folder_commands, N:N — ver schema.sql). Diferente de
// favoritos, pastas são privadas: não existe uma view "quem mais tem este
// comando" — ver shapeCommand()'s folder_ids, que só reflete as pastas do
// usuário que está fazendo a requisição.
// ════════════════════════════════════════════════

// Lista as pastas do usuário atual, cada uma já com a lista de command_ids
// que contém — evita 1 request por pasta no front-end.
app.get('/api/folders', async (req, res) => {
  try {
    const username = getCurrentUsername(req);
    const { rows } = await pool.query(
      `SELECT f.id, f.name, f.sort_order,
              COALESCE(array_agg(fc.command_id) FILTER (WHERE fc.command_id IS NOT NULL), '{}') AS command_ids
       FROM folders f
       LEFT JOIN folder_commands fc ON fc.folder_id = f.id
       WHERE f.username = $1
       GROUP BY f.id
       ORDER BY f.sort_order, f.name`,
      [username]
    );
    res.json(rows.map(r => ({ id: r.id, name: r.name, sort_order: r.sort_order, command_ids: r.command_ids })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// Cria uma pasta nova para o usuário atual. 409 se ele já tiver uma pasta com
// esse nome (UNIQUE(username, name), ver schema.sql — err.code 23505 é o
// código padrão do Postgres para violação de constraint única).
app.post('/api/folders', async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  try {
    if (!name) return res.status(400).json({ error: 'validation_error', message: '"name" is required' });
    const username = getCurrentUsername(req);
    const { rows } = await pool.query(
      'INSERT INTO folders (username, name) VALUES ($1, $2) RETURNING id, name, sort_order',
      [username, name]
    );
    res.status(201).json({ id: rows[0].id, name: rows[0].name, sort_order: rows[0].sort_order, command_ids: [] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'conflict', message: `You already have a folder named "${name}"` });
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// Renomeia uma pasta do usuário atual. 404 tanto se o id não existir quanto
// se existir mas for de OUTRO usuário — não vazamos a distinção, mesmo
// tratamento dado a outros recursos privados por usuário nesta API.
app.put('/api/folders/:id', async (req, res) => {
  const name = String((req.body && req.body.name) || '').trim();
  try {
    if (!name) return res.status(400).json({ error: 'validation_error', message: '"name" is required' });
    const username = getCurrentUsername(req);
    const { rows } = await pool.query(
      'UPDATE folders SET name = $1 WHERE id = $2 AND username = $3 RETURNING id, name, sort_order',
      [name, req.params.id, username]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found', message: `Folder '${req.params.id}' not found` });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'conflict', message: `You already have a folder named "${name}"` });
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// Apaga uma pasta do usuário atual — folder_commands é limpo sozinho via ON
// DELETE CASCADE (ver schema.sql); os comandos em si e as OUTRAS pastas do
// usuário não são afetados.
app.delete('/api/folders/:id', async (req, res) => {
  try {
    const username = getCurrentUsername(req);
    const { rowCount } = await pool.query('DELETE FROM folders WHERE id = $1 AND username = $2', [req.params.id, username]);
    if (!rowCount) return res.status(404).json({ error: 'not_found', message: `Folder '${req.params.id}' not found` });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// Adiciona um comando a uma pasta do usuário atual — idempotente (marcar de
// novo não dá erro, ON CONFLICT DO NOTHING). 404 se a pasta não existir/não
// for do usuário, ou se o comando não existir.
app.post('/api/folders/:id/commands/:commandId', async (req, res) => {
  try {
    const username = getCurrentUsername(req);
    const { id, commandId } = req.params;
    const folder = await pool.query('SELECT id FROM folders WHERE id = $1 AND username = $2', [id, username]);
    if (!folder.rows.length) return res.status(404).json({ error: 'not_found', message: `Folder '${id}' not found` });
    if (!(await getCommandRow(commandId))) return res.status(404).json({ error: 'not_found', message: `Command '${commandId}' not found` });
    await pool.query('INSERT INTO folder_commands (folder_id, command_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, commandId]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// Remove um comando de uma pasta do usuário atual — não afeta o comando em
// si nem sua presença em outras pastas.
app.delete('/api/folders/:id/commands/:commandId', async (req, res) => {
  try {
    const username = getCurrentUsername(req);
    const { id, commandId } = req.params;
    const folder = await pool.query('SELECT id FROM folders WHERE id = $1 AND username = $2', [id, username]);
    if (!folder.rows.length) return res.status(404).json({ error: 'not_found', message: `Folder '${id}' not found` });
    await pool.query('DELETE FROM folder_commands WHERE folder_id = $1 AND command_id = $2', [id, commandId]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// GET /api/audit-log — lista as alterações de comando (criar/editar/excluir)
// dos últimos 30 dias, mais recente primeiro. Teto de 1000 linhas.
// ════════════════════════════════════════════════
app.get('/api/audit-log', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, ts, username, action, command_id, command_name
       FROM audit_log
       WHERE ts >= NOW() - INTERVAL '${AUDIT_LOG_RETENTION_DAYS} days'
       ORDER BY ts DESC, id DESC
       LIMIT 1000`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// Dados genéricos por usuário (tema, idioma, configurações, históricos — ver
// user_data e js/user-sync.js). GET devolve tudo que existe para o usuário atual
// num único objeto {chave: valor}; PUT faz upsert parcial (só as chaves enviadas).
// ════════════════════════════════════════════════
app.get('/api/user-data', async (req, res) => {
  try {
    const username = getCurrentUsername(req);
    const { rows } = await pool.query('SELECT data_key, value FROM user_data WHERE username = $1', [username]);
    const out = {};
    rows.forEach(r => { out[r.data_key] = r.value; });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

app.put('/api/user-data', async (req, res) => {
  try {
    const username = getCurrentUsername(req);
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'validation_error', message: 'Request body must be a JSON object of {key: value}' });
    }
    await withTransaction(async client => {
      for (const key of Object.keys(body)) {
        const val = body[key];
        if (val === null || val === undefined) continue;
        await client.query(
          `INSERT INTO user_data (username, data_key, value, updated_at) VALUES ($1, $2, $3, NOW())
           ON CONFLICT (username, data_key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
          [username, key, String(val)]
        );
      }
    });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// Configurações padrão do administrador ("Admin mode" no modal de
// Configurações) — reaproveita a MESMA tabela user_data sob um username
// reservado/sentinela que nunca corresponde a um login de verdade.
// ════════════════════════════════════════════════
const GLOBAL_SETTINGS_USER = '__global_defaults__';

app.get('/api/global-settings', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT data_key, value FROM user_data WHERE username = $1', [GLOBAL_SETTINGS_USER]);
    const out = {};
    rows.forEach(r => { out[r.data_key] = r.value; });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

app.put('/api/global-settings', async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'validation_error', message: 'Request body must be a JSON object of {key: value}' });
    }
    await withTransaction(async client => {
      for (const key of Object.keys(body)) {
        const val = body[key];
        if (val === null || val === undefined) continue;
        await client.query(
          `INSERT INTO user_data (username, data_key, value, updated_at) VALUES ($1, $2, $3, NOW())
           ON CONFLICT (username, data_key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
          [GLOBAL_SETTINGS_USER, key, String(val)]
        );
      }
    });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// API keys — acesso programático externo (ver api_keys em schema.sql e o
// middleware de autenticação no topo deste arquivo). Gerenciável pela UI em
// Settings → System → API access (ver js/api-keys.js). A key em texto puro só
// existe na resposta do POST — depois disso só o hash (SHA-256) fica
// guardado; perder a key mostrada significa revogar e criar uma nova.
// ════════════════════════════════════════════════
app.get('/api/api-keys', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, key_prefix, role, created_by, created_at, expires_at, last_used_at, revoked_at
       FROM api_keys ORDER BY (revoked_at IS NULL) DESC, created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// Mesmo modelo de permissões (admin|user) dos usuários locais/NTLM — ver
// users.role em schema.sql e ADMIN_ROLES abaixo. Padrão 'user' (menor
// privilégio) quando o campo não é enviado.
const API_KEY_ROLES = ['admin', 'user'];

// Validade escolhida na criação (ver seletor "Validity" em js/api-keys.js) —
// convertida para uma data absoluta em expires_at. 'never' => null (nunca
// expira, preserva o comportamento anterior a este campo existir). Usa
// aritmética de calendário (setMonth/setFullYear) em vez de somar ms fixos,
// para "1 month"/"1 year" caírem no mesmo dia do mês/ano seguinte mesmo
// atravessando meses de tamanho diferente ou anos bissextos.
const API_KEY_VALIDITIES = ['1d', '1w', '1m', '1y', 'never'];
function computeApiKeyExpiresAt(validity) {
  if (validity === 'never') return null;
  const d = new Date();
  switch (validity) {
    case '1d': d.setDate(d.getDate() + 1); break;
    case '1w': d.setDate(d.getDate() + 7); break;
    case '1m': d.setMonth(d.getMonth() + 1); break;
    case '1y': d.setFullYear(d.getFullYear() + 1); break;
    default: return undefined; // valor inválido — ver checagem em POST abaixo
  }
  return d;
}

app.post('/api/api-keys', requireAdmin, async (req, res) => {
  const { name, role, validity } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'validation_error', message: '"name" is required' });
  }
  const finalRole = role || 'user';
  if (!API_KEY_ROLES.includes(finalRole)) {
    return res.status(400).json({ error: 'validation_error', message: `"role" must be one of: ${API_KEY_ROLES.join(', ')}` });
  }
  const finalValidity = validity || 'never';
  if (!API_KEY_VALIDITIES.includes(finalValidity)) {
    return res.status(400).json({ error: 'validation_error', message: `"validity" must be one of: ${API_KEY_VALIDITIES.join(', ')}` });
  }
  const expiresAt = computeApiKeyExpiresAt(finalValidity);
  try {
    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = rawKey.slice(0, 12);
    const createdBy = getCurrentUsername(req);
    const { rows } = await pool.query(
      `INSERT INTO api_keys (name, key_prefix, key_hash, role, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, key_prefix, role, created_by, created_at, expires_at, last_used_at, revoked_at`,
      [name.trim(), keyPrefix, keyHash, finalRole, createdBy, expiresAt]
    );
    res.status(201).json({ ...rows[0], key: rawKey });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// Exclusão permanente (antes era um soft-delete — ver revoked_at legado em
// schema.sql). A ação "Delete" na UI agora remove a linha de fato: uma key
// apagada não pode mais ser recuperada nem reaparece na lista.
app.delete('/api/api-keys/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'validation_error', message: 'Invalid id' });
  try {
    const { rows } = await pool.query('DELETE FROM api_keys WHERE id = $1 RETURNING id', [id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found', message: `API key '${id}' not found` });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// Usuários e permissões (Settings → System → Manage users) — ver users em
// schema.sql. Só admin acessa (requireAdmin abaixo). Contas NTLM aparecem
// aqui assim que forem vistas pela primeira vez (getOrCreateUserRole) — um
// admin pode promovê-las, mas não pode dar/trocar senha nelas (só contas
// locais, is_local=1, têm senha). Nunca devolve password_hash.
// ════════════════════════════════════════════════
const USERS_PUBLIC_COLUMNS = 'username, role, is_local, disabled, created_at, created_by';

app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT ${USERS_PUBLIC_COLUMNS} FROM users ORDER BY is_local DESC, username`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'validation_error', message: '"username" is required' });
  }
  if (!password || typeof password !== 'string' || password.length < 4) {
    return res.status(400).json({ error: 'validation_error', message: '"password" must be at least 4 characters' });
  }
  const roleVal = role === 'admin' ? 'admin' : 'user';
  try {
    const trimmed = username.trim();
    const { rows: existing } = await pool.query('SELECT username FROM users WHERE username = $1', [trimmed]);
    if (existing.length) return res.status(409).json({ error: 'conflict', message: `User '${trimmed}' already exists` });
    await pool.query(
      'INSERT INTO users (username, password_hash, role, is_local, created_by) VALUES ($1, $2, $3, 1, $4)',
      [trimmed, hashPassword(password), roleVal, getCurrentUsername(req)]
    );
    const { rows } = await pool.query(`SELECT ${USERS_PUBLIC_COLUMNS} FROM users WHERE username = $1`, [trimmed]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

app.put('/api/users/:username', requireAdmin, async (req, res) => {
  const username = req.params.username;
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'not_found', message: `User '${username}' not found` });

    const newRole = req.body.role != null ? (req.body.role === 'admin' ? 'admin' : 'user') : existing.role;
    const newDisabled = req.body.disabled != null ? !!req.body.disabled : !!existing.disabled;

    // Guarda contra lockout total: se esta mudança tiraria o role admin ou
    // desabilitaria a última conta admin habilitada, recusa.
    const wasEnabledAdmin = existing.role === 'admin' && !existing.disabled;
    const willStillBeEnabledAdmin = newRole === 'admin' && !newDisabled;
    if (wasEnabledAdmin && !willStillBeEnabledAdmin) {
      const remaining = await countEnabledAdmins(username);
      if (remaining < 1) return res.status(409).json({ error: 'conflict', message: 'At least one enabled admin must remain' });
    }

    let passwordHash = existing.password_hash;
    if (req.body.password) {
      if (!existing.is_local) return res.status(400).json({ error: 'validation_error', message: 'Only local users have a password' });
      if (typeof req.body.password !== 'string' || req.body.password.length < 4) {
        return res.status(400).json({ error: 'validation_error', message: '"password" must be at least 4 characters' });
      }
      passwordHash = hashPassword(req.body.password);
    }

    await pool.query(
      'UPDATE users SET role = $1, disabled = $2, password_hash = $3 WHERE username = $4',
      [newRole, newDisabled ? 1 : 0, passwordHash, username]
    );
    const { rows } = await pool.query(`SELECT ${USERS_PUBLIC_COLUMNS} FROM users WHERE username = $1`, [username]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

app.delete('/api/users/:username', requireAdmin, async (req, res) => {
  const username = req.params.username;
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'not_found', message: `User '${username}' not found` });
    if (existing.role === 'admin' && !existing.disabled) {
      const remaining = await countEnabledAdmins(username);
      if (remaining < 1) return res.status(409).json({ error: 'conflict', message: 'At least one enabled admin must remain' });
    }
    await pool.query('DELETE FROM users WHERE username = $1', [username]); // cascades sessions (ON DELETE CASCADE)
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// Validation + write helpers
// ════════════════════════════════════════════════
function resolveTopics(body) {
  if (Array.isArray(body.topics) && body.topics.length) return body.topics;
  if (body.topic && typeof body.topic === 'string') return [body.topic];
  return [];
}

function isNonEmptyArray(val) {
  return Array.isArray(val) && val.length > 0;
}

function validateBody(body) {
  const errors = [];
  if (!body || typeof body !== 'object') return ['Request body must be a JSON object'];
  if (!body.id || typeof body.id !== 'string') errors.push('"id" is required');
  if (!isNonEmptyArray(body.vendors)) errors.push('"vendors" is required (exactly one vendor)');
  else if (body.vendors.length > 1) errors.push('"vendors" must contain exactly one vendor (a command belongs to a single vendor)');
  if (!isNonEmptyArray(body.systems)) errors.push('"systems" is required (at least one system)');
  if (!isNonEmptyArray(body.versions)) errors.push('"versions" is required (at least one version)');
  if (!isNonEmptyArray(body.environments)) errors.push('"environments" is required (at least one environment)');
  if (!resolveTopics(body).length) errors.push('"topics" is required (at least one topic)');
  if (!body.name || typeof body.name !== 'string') errors.push('"name" is required');
  return errors;
}

const NULLABLE_TEXT_FIELDS = ['name_empty', 'desc_empty'];
const REQUIRED_TEXT_FIELDS = ['name', 'desc', 'about_purpose', 'about_when', 'about_obs'];

function buildCommandColumns(body) {
  const topics = resolveTopics(body);
  // Guarda estrutural: requires_ips/requires_ip_port fazem buildCardHtmlForRow
  // (js/db-render-engine.js) trocar para um "empty state" quando SRC/DST (ou
  // IP/Porta genéricos) não estão preenchidos — se não existir NENHUMA linha
  // variant='empty' cadastrada, o card desaparece da tela sem erro visível.
  // Por isso o server nunca aceita requires_ips/requires_ip_port=1 sem pelo
  // menos uma linha empty com conteúdo.
  const hasEmptyLines = Array.isArray(body.lines) && body.lines.some(l => l && l.variant === 'empty' && String(l.content || '').trim());
  const cols = {
    id: body.id,
    topic: topics[0],
    icon: body.icon || '📄',
    sort_order: Number.isInteger(body.sort_order) ? body.sort_order : 0,
    requires_ips: (body.requires_ips && hasEmptyLines) ? 1 : 0,
    requires_ip_port: (body.requires_ip_port && hasEmptyLines) ? 1 : 0,
    placeholder_resolver: body.placeholder_resolver || null,
    raw_template: body.raw_template || '',
    about_icon: body.about_icon || 'ℹ️',
  };
  for (const f of REQUIRED_TEXT_FIELDS) cols[f] = body[f] != null ? body[f] : '';
  for (const f of NULLABLE_TEXT_FIELDS) cols[f] = body[f] != null ? body[f] : null;
  return cols;
}

// Insere todas as tabelas filhas de um comando, dentro da MESMA transação
// (client) do INSERT/UPDATE de `commands` que chamou isto.
async function insertChildren(client, id, body) {
  const tags = body.tags || [];
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    await client.query(
      'INSERT INTO command_tags (command_id, css_class, label, sort_order) VALUES ($1, $2, $3, $4)',
      [id, tag.css_class, tag.label, Number.isInteger(tag.sort_order) ? tag.sort_order : i]
    );
  }

  for (const tp of resolveTopics(body)) {
    await client.query('INSERT INTO command_topics (command_id, topic) VALUES ($1, $2)', [id, tp]);
  }
  for (const v of (body.vendors || [])) {
    await client.query('INSERT INTO command_vendors (command_id, vendor) VALUES ($1, $2)', [id, v]);
  }
  for (const s of (body.systems || [])) {
    await client.query('INSERT INTO command_systems (command_id, system) VALUES ($1, $2)', [id, s]);
  }
  for (const v of (body.versions || [])) {
    await client.query('INSERT INTO command_versions (command_id, version) VALUES ($1, $2)', [id, v]);
  }
  for (const e of (body.environments || [])) {
    await client.query('INSERT INTO command_environments (command_id, environment) VALUES ($1, $2)', [id, e]);
  }

  const lines = body.lines || [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    await client.query(
      `INSERT INTO command_lines (command_id, variant, sort_order, line_type, prompt, content, supports_export, image_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        line.variant || 'default',
        Number.isInteger(line.sort_order) ? line.sort_order : i,
        line.line_type || 'cmd',
        line.prompt || null,
        line.content || '',
        line.supports_export ? 1 : 0,
        line.line_type === 'image' ? (line.image_data || null) : null,
      ]
    );
  }

  const diffs = body.diffs || [];
  for (let i = 0; i < diffs.length; i++) {
    const diff = diffs[i];
    const diffResult = await client.query(
      'INSERT INTO command_diffs (command_id, version, note, sort_order) VALUES ($1, $2, $3, $4) RETURNING id',
      [id, diff.version, diff.note || '', Number.isInteger(diff.sort_order) ? diff.sort_order : i]
    );
    const diffId = diffResult.rows[0].id;
    const diffLines = diff.lines || [];
    for (let j = 0; j < diffLines.length; j++) {
      const line = diffLines[j];
      await client.query(
        'INSERT INTO command_diff_lines (diff_id, sort_order, line_type, prompt, content) VALUES ($1, $2, $3, $4, $5)',
        [diffId, Number.isInteger(line.sort_order) ? line.sort_order : j, line.line_type || 'cmd', line.prompt || null, line.content || '']
      );
    }
  }
}

// ════════════════════════════════════════════════
// POST /api/commands — create
// ════════════════════════════════════════════════
app.post('/api/commands', async (req, res) => {
  try {
    const errors = validateBody(req.body);
    if (errors.length) return res.status(400).json({ error: 'validation_error', message: errors.join('; ') });

    const { id } = req.body;
    const existing = await findCommand(id);
    if (existing) return res.status(409).json({ error: 'conflict', message: `Command '${id}' already exists` });

    const cols = buildCommandColumns(req.body);
    // Todo comando criado por esta API é atribuído ao usuário atual
    // (created_by = modified_by = quem está autenticado) — EXCETO quando o
    // chamador é admin e envia o header X-Save-As-System (ver "Import as
    // System commands" em js/csv-import.js): nesse caso o comando é gravado
    // como created_by=modified_by='System', igual aos comandos de referência
    // trazidos de fábrica. Ignorado silenciosamente para não-admins — não é
    // um erro, o comando simplesmente é criado como próprio (comportamento
    // padrão), já que confiar num header vindo do cliente para elevar
    // privilégio seria inseguro sem essa checagem de role no servidor.
    const username = getCurrentUsername(req);
    const wantsSystem = req.headers['x-save-as-system'] === '1' || req.headers['x-save-as-system'] === 'true';
    const isAdmin = wantsSystem && (await getCurrentRole(req)) === 'admin';
    cols.created_by = isAdmin ? 'System' : username;
    cols.modified_by = isAdmin ? 'System' : username;

    await withTransaction(async client => {
      await client.query(
        `INSERT INTO commands (
          id, topic, icon, sort_order, requires_ips, requires_ip_port, placeholder_resolver, raw_template,
          name, name_empty, "desc", desc_empty,
          about_icon, about_purpose, about_when, about_obs,
          created_by, modified_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          cols.id, cols.topic, cols.icon, cols.sort_order, cols.requires_ips, cols.requires_ip_port,
          cols.placeholder_resolver, cols.raw_template,
          cols.name, cols.name_empty, cols.desc, cols.desc_empty,
          cols.about_icon, cols.about_purpose, cols.about_when, cols.about_obs,
          cols.created_by, cols.modified_by,
        ]
      );
      await insertChildren(client, id, req.body);
    });

    await logAudit(username, 'create', id, cols.name);
    const row = await findCommand(id);
    res.status(201).json(await shapeCommand(row, username));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// PUT /api/commands/:id — full update (replace children)
// ════════════════════════════════════════════════
app.put('/api/commands/:id', async (req, res) => {
  const id = req.params.id;
  try {
    const found = await findCommand(id);
    if (!found) return res.status(404).json({ error: 'not_found', message: `Command '${id}' not found` });

    // Sem restrição de dono entre usuários comuns — qualquer um edita
    // qualquer comando SEU ou de outro usuário. Exceção: comandos de
    // referência (created_by='System') só podem ser editados por admins;
    // um usuário comum pode duplicá-los (isso é um POST normal, cria um
    // comando novo em nome dele) mas não alterar o original.
    if (found.created_by === 'System' && (await getCurrentRole(req)) !== 'admin') {
      return res.status(403).json({ error: 'forbidden', message: 'Only admins can edit System commands. Duplicate it to create your own editable copy.' });
    }
    const currentUser = getCurrentUsername(req);

    const bodyForValidation = { ...req.body, id: req.body.id || id };
    const errors = validateBody(bodyForValidation);
    if (errors.length) return res.status(400).json({ error: 'validation_error', message: errors.join('; ') });

    if (req.body.id && req.body.id !== id) {
      return res.status(400).json({ error: 'validation_error', message: 'Body "id" does not match URL id and cannot be changed' });
    }

    const cols = buildCommandColumns({ ...req.body, id });
    cols.modified_by = currentUser;

    await withTransaction(async client => {
      await client.query(
        `UPDATE commands SET
          topic = $1, icon = $2, sort_order = $3, requires_ips = $4,
          requires_ip_port = $5,
          placeholder_resolver = $6, raw_template = $7,
          name = $8, name_empty = $9, "desc" = $10, desc_empty = $11,
          about_icon = $12, about_purpose = $13, about_when = $14, about_obs = $15,
          modified_by = $16,
          updated_at = NOW()
        WHERE id = $17`,
        [
          cols.topic, cols.icon, cols.sort_order, cols.requires_ips,
          cols.requires_ip_port,
          cols.placeholder_resolver, cols.raw_template,
          cols.name, cols.name_empty, cols.desc, cols.desc_empty,
          cols.about_icon, cols.about_purpose, cols.about_when, cols.about_obs,
          cols.modified_by,
          id,
        ]
      );

      await client.query('DELETE FROM command_tags WHERE command_id = $1', [id]);
      await client.query('DELETE FROM command_topics WHERE command_id = $1', [id]);
      await client.query('DELETE FROM command_vendors WHERE command_id = $1', [id]);
      await client.query('DELETE FROM command_systems WHERE command_id = $1', [id]);
      await client.query('DELETE FROM command_versions WHERE command_id = $1', [id]);
      await client.query('DELETE FROM command_environments WHERE command_id = $1', [id]);
      await client.query('DELETE FROM command_lines WHERE command_id = $1', [id]);
      await client.query('DELETE FROM command_diffs WHERE command_id = $1', [id]); // cascades to command_diff_lines

      await insertChildren(client, id, req.body);
    });

    await logAudit(currentUser, 'update', id, cols.name);
    const row = await findCommand(id);
    res.json(await shapeCommand(row, currentUser));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// DELETE /api/commands/:id
// ════════════════════════════════════════════════
app.delete('/api/commands/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  try {
    const found = await findCommand(id);
    if (!found) return res.status(404).json({ error: 'not_found', message: `Command '${id}' not found` });
    // Sem restrição de dono (mesma decisão do PUT acima) — mas exige role='admin' (requireAdmin acima).
    const currentUser = getCurrentUsername(req);
    // command_id em folder_commands tem FK ON DELETE CASCADE (ver schema.sql)
    // — apagar o comando já limpa sozinho sua presença em qualquer pasta.
    await pool.query('DELETE FROM commands WHERE id = $1', [id]);
    await logAudit(currentUser, 'delete', id, found.name);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// Catálogos administráveis — Vendor / Sistema / Versão / Ambiente / Tópico /
// Parâmetro. `key` nunca é editável depois de criado — só label/cor/ordem.
// Exclusão é bloqueada com 409 quando o valor está em uso por pelo menos um
// comando, ou (só para tópicos) quando é protegido (is_protected=1).
// ════════════════════════════════════════════════
const CATALOG_KEY_RE = /^[A-Za-z0-9._-]{1,40}$/;

// `key` de Vendor/System/Version/Environment/Topic é sempre gerado no servidor
// a partir do `label` (slug) — o usuário nunca digita/vê um "ID" separado.
function slugifyCatalogKey(label) {
  let s = String(label == null ? '' : label).trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .replace(/-{2,}/g, '-');
  if (!s) s = 'item';
  return s.slice(0, 40);
}
// Acrescenta -2/-3/... até `existsFn(candidate)` (async) retornar false.
async function uniqueCatalogKey(base, existsFn) {
  let candidate = base;
  let n = 2;
  while (await existsFn(candidate)) {
    const suffix = '-' + n;
    candidate = base.slice(0, Math.max(1, 40 - suffix.length)) + suffix;
    n++;
  }
  return candidate;
}
async function keyExists(table, key) {
  const { rows } = await pool.query(`SELECT 1 FROM ${table} WHERE key = $1`, [key]);
  return rows.length > 0;
}

// Conta quantos comandos usam uma versão/ambiente/tópico/vendor/sistema.
// COUNT(*) volta como bigint (string) no driver `pg` — Number() normaliza.
async function countUsage(table, column, key) {
  const { rows } = await pool.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = $1`, [key]);
  return Number(rows[0].n);
}

// GET /api/catalogs — todos os catálogos de uma vez (usado no boot do
// front-end e para recarregar a UI depois de qualquer criação/edição/exclusão).
app.get('/api/catalogs', async (req, res) => {
  try {
    const [vendors, systems, versions, environments, topics, parameters, versionEnvironments, environmentTopics] = await Promise.all([
      pool.query('SELECT * FROM vendors ORDER BY sort_order, key'),
      pool.query('SELECT * FROM systems ORDER BY sort_order, key'),
      pool.query('SELECT * FROM versions ORDER BY sort_order, key'),
      pool.query('SELECT * FROM environments ORDER BY sort_order, key'),
      pool.query('SELECT * FROM topics ORDER BY sort_order, key'),
      pool.query('SELECT * FROM parameters ORDER BY sort_order, key'),
      pool.query('SELECT version, environment FROM version_environments'),
      pool.query('SELECT environment, topic FROM environment_topics'),
    ]);
    res.json({
      vendors: vendors.rows,
      systems: systems.rows,
      versions: versions.rows,
      environments: environments.rows,
      topics: topics.rows,
      parameters: parameters.rows,
      version_environments: versionEnvironments.rows,
      environment_topics: environmentTopics.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// Substitui (delete+insert) o conjunto de pais vinculados a um item filho —
// usado pela cascata N:N Versão ↔ Ambiente / Ambiente ↔ Tópico.
async function replaceScopeLinks(joinTable, childCol, childKey, parentCol, parentKeys) {
  await pool.query(`DELETE FROM ${joinTable} WHERE ${childCol} = $1`, [childKey]);
  for (const pk of (Array.isArray(parentKeys) ? parentKeys : [])) {
    await pool.query(`INSERT INTO ${joinTable} (${childCol}, ${parentCol}) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [childKey, pk]);
  }
}

// ── Fabricantes (Vendor) ──────────────────────────
app.post('/api/vendors', async (req, res) => {
  const { label, color } = req.body || {};
  if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
  try {
    const key = await uniqueCatalogKey(slugifyCatalogKey(label), k => keyExists('vendors', k));
    const maxRes = await pool.query('SELECT COALESCE(MAX(sort_order), -1) AS m FROM vendors');
    await pool.query('INSERT INTO vendors (key, label, color, sort_order) VALUES ($1, $2, $3, $4)', [key, label, color || '#8B949E', maxRes.rows[0].m + 1]);
    const { rows } = await pool.query('SELECT * FROM vendors WHERE key = $1', [key]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.put('/api/vendors/:key', async (req, res) => {
  const key = req.params.key;
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM vendors WHERE key = $1', [key]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'not_found', message: `Vendor '${key}' not found` });
    const label = req.body.label != null ? req.body.label : existing.label;
    const color = req.body.color != null ? req.body.color : existing.color;
    const sortOrder = Number.isInteger(req.body.sort_order) ? req.body.sort_order : existing.sort_order;
    if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
    await pool.query('UPDATE vendors SET label = $1, color = $2, sort_order = $3 WHERE key = $4', [label, color, sortOrder, key]);
    const { rows } = await pool.query('SELECT * FROM vendors WHERE key = $1', [key]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.delete('/api/vendors/:key', async (req, res) => {
  const key = req.params.key;
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM vendors WHERE key = $1', [key]);
    if (!existingRows.length) return res.status(404).json({ error: 'not_found', message: `Vendor '${key}' not found` });
    const count = await countUsage('command_vendors', 'vendor', key);
    if (count > 0) return res.status(409).json({ error: 'in_use', message: `Vendor '${key}' is used by ${count} command(s)`, count });
    await pool.query('DELETE FROM vendors WHERE key = $1', [key]); // cascades systems (and, por sua vez, versions)
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ── Sistemas ───────────────────────────────────────
// Hierarquia estrita: um Sistema pertence a exatamente um Vendor.
app.post('/api/systems', async (req, res) => {
  const { label, color, vendor } = req.body || {};
  if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
  if (!vendor || typeof vendor !== 'string') return res.status(400).json({ error: 'validation_error', message: '"vendor" is required' });
  try {
    if (!(await keyExists('vendors', vendor))) return res.status(400).json({ error: 'validation_error', message: `Vendor '${vendor}' not found` });
    const key = await uniqueCatalogKey(slugifyCatalogKey(label), k => keyExists('systems', k));
    const maxRes = await pool.query('SELECT COALESCE(MAX(sort_order), -1) AS m FROM systems');
    await pool.query('INSERT INTO systems (key, vendor, label, color, sort_order) VALUES ($1, $2, $3, $4, $5)', [key, vendor, label, color || '#8B949E', maxRes.rows[0].m + 1]);
    const { rows } = await pool.query('SELECT * FROM systems WHERE key = $1', [key]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.put('/api/systems/:key', async (req, res) => {
  const key = req.params.key;
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM systems WHERE key = $1', [key]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'not_found', message: `System '${key}' not found` });
    const label = req.body.label != null ? req.body.label : existing.label;
    const color = req.body.color != null ? req.body.color : existing.color;
    const vendor = req.body.vendor != null ? req.body.vendor : existing.vendor;
    const sortOrder = Number.isInteger(req.body.sort_order) ? req.body.sort_order : existing.sort_order;
    if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
    if (!vendor || typeof vendor !== 'string') return res.status(400).json({ error: 'validation_error', message: '"vendor" is required' });
    if (!(await keyExists('vendors', vendor))) return res.status(400).json({ error: 'validation_error', message: `Vendor '${vendor}' not found` });
    await pool.query('UPDATE systems SET label = $1, color = $2, vendor = $3, sort_order = $4 WHERE key = $5', [label, color, vendor, sortOrder, key]);
    // Reatribuir o vendor do Sistema mantém versions.vendor em sincronia.
    await pool.query('UPDATE versions SET vendor = $1 WHERE system = $2', [vendor, key]);
    const { rows } = await pool.query('SELECT * FROM systems WHERE key = $1', [key]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.delete('/api/systems/:key', async (req, res) => {
  const key = req.params.key;
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM systems WHERE key = $1', [key]);
    if (!existingRows.length) return res.status(404).json({ error: 'not_found', message: `System '${key}' not found` });
    const count = await countUsage('command_systems', 'system', key);
    if (count > 0) return res.status(409).json({ error: 'in_use', message: `System '${key}' is used by ${count} command(s)`, count });
    await pool.query('DELETE FROM systems WHERE key = $1', [key]); // cascades versions (system FK)
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ── Vínculos N:N Versão ↔ Ambiente / Ambiente ↔ Tópico ──
app.put('/api/environments/:key/versions', async (req, res) => {
  const key = req.params.key;
  try {
    if (!(await keyExists('environments', key))) return res.status(404).json({ error: 'not_found', message: `Environment '${key}' not found` });
    await replaceScopeLinks('version_environments', 'environment', key, 'version', req.body && req.body.versions);
    const { rows } = await pool.query('SELECT version FROM version_environments WHERE environment = $1', [key]);
    res.json({ environment: key, versions: rows.map(r => r.version) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.put('/api/topics/:key/environments', async (req, res) => {
  const key = req.params.key;
  try {
    if (!(await keyExists('topics', key))) return res.status(404).json({ error: 'not_found', message: `Topic '${key}' not found` });
    await replaceScopeLinks('environment_topics', 'topic', key, 'environment', req.body && req.body.environments);
    const { rows } = await pool.query('SELECT environment FROM environment_topics WHERE topic = $1', [key]);
    res.json({ topic: key, environments: rows.map(r => r.environment) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ── Versões ──────────────────────────────────────
// `key` sozinho não é globalmente único — a PK real é composta (system, key).
app.post('/api/versions', async (req, res) => {
  const { label, color, system } = req.body || {};
  if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
  if (!system || typeof system !== 'string') return res.status(400).json({ error: 'validation_error', message: '"system" is required' });
  try {
    const { rows: systemRows } = await pool.query('SELECT * FROM systems WHERE key = $1', [system]);
    const systemRow = systemRows[0];
    if (!systemRow) return res.status(400).json({ error: 'validation_error', message: `System '${system}' not found` });
    // UNIQUE(vendor, key) — a checagem de unicidade precisa cobrir todo o vendor.
    const key = await uniqueCatalogKey(slugifyCatalogKey(label), async k => {
      const { rows } = await pool.query('SELECT 1 FROM versions WHERE vendor = $1 AND key = $2', [systemRow.vendor, k]);
      return rows.length > 0;
    });
    const maxRes = await pool.query('SELECT COALESCE(MAX(sort_order), -1) AS m FROM versions');
    await pool.query(
      'INSERT INTO versions (system, vendor, key, label, color, sort_order) VALUES ($1, $2, $3, $4, $5, $6)',
      [system, systemRow.vendor, key, label, color || '#8B949E', maxRes.rows[0].m + 1]
    );
    const { rows } = await pool.query('SELECT * FROM versions WHERE system = $1 AND key = $2', [system, key]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.put('/api/versions/:system/:key', async (req, res) => {
  const { system, key } = req.params;
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM versions WHERE system = $1 AND key = $2', [system, key]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'not_found', message: `Version '${key}' not found under system '${system}'` });
    const label = req.body.label != null ? req.body.label : existing.label;
    const color = req.body.color != null ? req.body.color : existing.color;
    const sortOrder = Number.isInteger(req.body.sort_order) ? req.body.sort_order : existing.sort_order;
    const newSystem = req.body.system != null ? req.body.system : system;
    if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
    let newVendor = existing.vendor;
    if (newSystem !== system) {
      const { rows: systemRows } = await pool.query('SELECT * FROM systems WHERE key = $1', [newSystem]);
      const systemRow = systemRows[0];
      if (!systemRow) return res.status(400).json({ error: 'validation_error', message: `System '${newSystem}' not found` });
      newVendor = systemRow.vendor;
      const { rows: dupRows1 } = await pool.query('SELECT 1 FROM versions WHERE system = $1 AND key = $2', [newSystem, key]);
      if (dupRows1.length) return res.status(409).json({ error: 'conflict', message: `Version '${key}' already exists under system '${newSystem}'` });
      const { rows: dupRows2 } = await pool.query('SELECT 1 FROM versions WHERE vendor = $1 AND key = $2 AND system != $3', [newVendor, key, system]);
      if (dupRows2.length) return res.status(409).json({ error: 'conflict', message: `Version '${key}' already exists under another system of vendor '${newVendor}'` });
    }
    await pool.query(
      'UPDATE versions SET label = $1, color = $2, sort_order = $3, system = $4, vendor = $5 WHERE system = $6 AND key = $7',
      [label, color, sortOrder, newSystem, newVendor, system, key]
    );
    const { rows } = await pool.query('SELECT * FROM versions WHERE system = $1 AND key = $2', [newSystem, key]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.delete('/api/versions/:system/:key', async (req, res) => {
  const { system, key } = req.params;
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM versions WHERE system = $1 AND key = $2', [system, key]);
    if (!existingRows.length) return res.status(404).json({ error: 'not_found', message: `Version '${key}' not found under system '${system}'` });
    const count = await countUsage('command_versions', 'version', key);
    if (count > 0) return res.status(409).json({ error: 'in_use', message: `Version '${key}' is used by ${count} command(s)`, count });
    await pool.query('DELETE FROM versions WHERE system = $1 AND key = $2', [system, key]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ── Ambientes ────────────────────────────────────
app.post('/api/environments', async (req, res) => {
  const { label, color } = req.body || {};
  if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
  try {
    const key = await uniqueCatalogKey(slugifyCatalogKey(label), k => keyExists('environments', k));
    const maxRes = await pool.query('SELECT COALESCE(MAX(sort_order), -1) AS m FROM environments');
    await pool.query('INSERT INTO environments (key, label, color, sort_order) VALUES ($1, $2, $3, $4)', [key, label, color || '#8B949E', maxRes.rows[0].m + 1]);
    const { rows } = await pool.query('SELECT * FROM environments WHERE key = $1', [key]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.put('/api/environments/:key', async (req, res) => {
  const key = req.params.key;
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM environments WHERE key = $1', [key]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'not_found', message: `Environment '${key}' not found` });
    const label = req.body.label != null ? req.body.label : existing.label;
    const color = req.body.color != null ? req.body.color : existing.color;
    const sortOrder = Number.isInteger(req.body.sort_order) ? req.body.sort_order : existing.sort_order;
    if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
    await pool.query('UPDATE environments SET label = $1, color = $2, sort_order = $3 WHERE key = $4', [label, color, sortOrder, key]);
    const { rows } = await pool.query('SELECT * FROM environments WHERE key = $1', [key]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.delete('/api/environments/:key', async (req, res) => {
  const key = req.params.key;
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM environments WHERE key = $1', [key]);
    if (!existingRows.length) return res.status(404).json({ error: 'not_found', message: `Environment '${key}' not found` });
    const count = await countUsage('command_environments', 'environment', key);
    if (count > 0) return res.status(409).json({ error: 'in_use', message: `Environment '${key}' is used by ${count} command(s)`, count });
    await pool.query('DELETE FROM environments WHERE key = $1', [key]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ── Tópicos ──────────────────────────────────────
app.post('/api/topics', async (req, res) => {
  const { label, color } = req.body || {};
  if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
  try {
    const key = await uniqueCatalogKey(slugifyCatalogKey(label), k => keyExists('topics', k));
    const maxRes = await pool.query('SELECT COALESCE(MAX(sort_order), -1) AS m FROM topics WHERE is_protected = 0');
    await pool.query(
      `INSERT INTO topics (key, label, color, sort_order, is_protected) VALUES ($1, $2, $3, $4, 0)`,
      [key, label, color || '#8B949E', maxRes.rows[0].m + 1]
    );
    const { rows } = await pool.query('SELECT * FROM topics WHERE key = $1', [key]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.put('/api/topics/:key', async (req, res) => {
  const key = req.params.key;
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM topics WHERE key = $1', [key]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'not_found', message: `Topic '${key}' not found` });
    const label = req.body.label != null ? req.body.label : existing.label;
    const color = req.body.color != null ? req.body.color : existing.color;
    const sortOrder = Number.isInteger(req.body.sort_order) ? req.body.sort_order : existing.sort_order;
    if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
    // is_protected nunca é alterável por esta API.
    await pool.query('UPDATE topics SET label = $1, color = $2, sort_order = $3 WHERE key = $4', [label, color, sortOrder, key]);
    const { rows } = await pool.query('SELECT * FROM topics WHERE key = $1', [key]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.delete('/api/topics/:key', async (req, res) => {
  const key = req.params.key;
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM topics WHERE key = $1', [key]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'not_found', message: `Topic '${key}' not found` });
    if (existing.is_protected) return res.status(409).json({ error: 'protected', message: `Topic '${key}' is a protected system topic and cannot be deleted` });
    const count = await countUsage('command_topics', 'topic', key);
    if (count > 0) return res.status(409).json({ error: 'in_use', message: `Topic '${key}' is used by ${count} command(s)`, count });
    await pool.query('DELETE FROM topics WHERE key = $1', [key]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ── Parâmetros (campo de busca unificado + botão "Inserir variável") ──
// Conta em quantos comandos DISTINTOS o placeholder {{key}} aparece de verdade
// (raw_template, linhas normais e linhas de diff) — usado para bloquear
// exclusão de um parâmetro que algum comando ainda referencia no texto.
async function countParameterTemplateUsage(key) {
  const needle = `{{${key}}}`;
  const usedBy = new Set();
  const cmds = await pool.query('SELECT id, raw_template FROM commands');
  cmds.rows.forEach(r => { if (r.raw_template && r.raw_template.includes(needle)) usedBy.add(r.id); });
  const lines = await pool.query('SELECT command_id, content FROM command_lines');
  lines.rows.forEach(r => { if (r.content && r.content.includes(needle)) usedBy.add(r.command_id); });
  const diffLines = await pool.query(
    `SELECT cd.command_id AS command_id, cdl.content AS content
     FROM command_diff_lines cdl JOIN command_diffs cd ON cd.id = cdl.diff_id`
  );
  diffLines.rows.forEach(r => { if (r.content && r.content.includes(needle)) usedBy.add(r.command_id); });
  return usedBy.size;
}
// 'src_ip'/'dst_ip' e 'ip'/'port' são lidos DIRETO (não via {{token}}) pela
// lógica de estado vazio do card (requires_ips/requires_ip_port em commands) —
// excluí-los quebraria essa lógica para todo comando marcado com a respectiva
// flag, mesmo que nenhum {{src_ip}}/{{ip}} literal apareça no texto.
async function parameterStructuralDependencyCount(key) {
  if (key === 'src_ip' || key === 'dst_ip') return countUsage('commands', 'requires_ips', 1);
  if (key === 'ip' || key === 'port') return countUsage('commands', 'requires_ip_port', 1);
  return 0;
}

app.post('/api/parameters', async (req, res) => {
  const { key, label, sort_order } = req.body || {};
  if (!key || !CATALOG_KEY_RE.test(key)) return res.status(400).json({ error: 'validation_error', message: '"key" is required (letters, numbers, dot, underscore, hyphen only)' });
  if (!label) return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
  try {
    if (await keyExists('parameters', key)) return res.status(409).json({ error: 'conflict', message: `Parameter '${key}' already exists` });
    const maxRes = await pool.query('SELECT COALESCE(MAX(sort_order), -1) AS m FROM parameters');
    const order = Number.isInteger(sort_order) ? sort_order : maxRes.rows[0].m + 1;
    await pool.query('INSERT INTO parameters (key, label, sort_order) VALUES ($1, $2, $3)', [key, label, order]);
    const { rows } = await pool.query('SELECT * FROM parameters WHERE key = $1', [key]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.put('/api/parameters/:key', async (req, res) => {
  const key = req.params.key;
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM parameters WHERE key = $1', [key]);
    const existing = existingRows[0];
    if (!existing) return res.status(404).json({ error: 'not_found', message: `Parameter '${key}' not found` });
    const label = req.body.label != null ? req.body.label : existing.label;
    const sortOrder = Number.isInteger(req.body.sort_order) ? req.body.sort_order : existing.sort_order;
    if (!label) return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
    // `key` nunca é alterável por esta API.
    await pool.query('UPDATE parameters SET label = $1, sort_order = $2 WHERE key = $3', [label, sortOrder, key]);
    const { rows } = await pool.query('SELECT * FROM parameters WHERE key = $1', [key]);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.delete('/api/parameters/:key', async (req, res) => {
  const key = req.params.key;
  try {
    const { rows: existingRows } = await pool.query('SELECT * FROM parameters WHERE key = $1', [key]);
    if (!existingRows.length) return res.status(404).json({ error: 'not_found', message: `Parameter '${key}' not found` });
    const structCount = await parameterStructuralDependencyCount(key);
    if (structCount > 0) {
      return res.status(409).json({
        error: 'structural_dependency',
        message: `Parameter '${key}' is read directly by ${structCount} command(s)' empty-state logic (requires_ips/requires_ip_port) and cannot be deleted`,
        count: structCount,
      });
    }
    const usage = await countParameterTemplateUsage(key);
    if (usage > 0) return res.status(409).json({ error: 'in_use', message: `Parameter '${key}' is used by ${usage} command(s)`, count: usage });
    await pool.query('DELETE FROM parameters WHERE key = $1', [key]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// Backup e restauração do banco de dados (menu Configurações → "Backup &
// Restore" — ver js/backup.js). Convertido para usar `pg_dump`/`pg_restore`
// (CLI do PostgreSQL — precisa estar instalada na imagem do backend, ver
// Dockerfile: pacote `postgresql-client`) em vez do antigo Database#backup()
// do better-sqlite3. Os arquivos ficam num volume dedicado (BACKUP_DIR, por
// padrão /app/backups no Docker — ver docker-compose.yml), fora do container
// da própria aplicação, então sobrevivem a rebuild/restart.
//
// Diferente da versão SQLite antiga, restaurar NÃO precisa derrubar o
// processo: pg_restore --clean recria as tabelas via uma conexão própria
// (fora do pool do Node), então basta a resposta HTTP confirmar sucesso — o
// próprio pool já enxerga os dados novos na próxima query.
//
// O agendamento (diário/semanal/mensal + horário) continua guardado nas
// MESMAS chaves de /api/global-settings (tabela user_data, username
// sentinela GLOBAL_SETTINGS_USER).
// ════════════════════════════════════════════════
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, 'backup');

function runCli(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 1024 * 1024 * 64 }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; return reject(err); }
      resolve({ stdout, stderr });
    });
  });
}

function pad2(n) { return String(n).padStart(2, '0'); }

function backupTimestamp(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

async function performBackup(prefix = 'backup') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const filename = `${prefix}-${backupTimestamp()}.dump`;
  const full = path.join(BACKUP_DIR, filename);
  // Formato "custom" (-F c): comprimido e restaurável com pg_restore
  // (permite --clean/--if-exists na restauração, ao contrário do -F p).
  await runCli('pg_dump', ['-d', getConnectionString(), '-F', 'c', '-f', full]);
  return filename;
}

function listBackupFiles() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.dump'))
    .map(f => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { filename: f, sizeBytes: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Só aceita um nome de arquivo puro (sem separadores/"..") que já exista
// dentro de BACKUP_DIR — impede path traversal via parâmetro de rota.
function resolveBackupPath(filename) {
  const base = path.basename(String(filename || ''));
  if (!base || base !== filename) return null;
  const full = path.join(BACKUP_DIR, base);
  if (!fs.existsSync(full)) return null;
  return full;
}

async function readGlobalSetting(key, fallback) {
  const { rows } = await pool.query('SELECT value FROM user_data WHERE username = $1 AND data_key = $2', [GLOBAL_SETTINGS_USER, key]);
  return rows.length ? rows[0].value : fallback;
}

async function writeGlobalSetting(key, value) {
  await pool.query(
    `INSERT INTO user_data (username, data_key, value, updated_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (username, data_key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [GLOBAL_SETTINGS_USER, key, String(value)]
  );
}

app.get('/api/backups', requireAdmin, (req, res) => {
  try {
    res.json(listBackupFiles());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

app.post('/api/backups', requireAdmin, async (req, res) => {
  try {
    const filename = await performBackup('backup');
    res.status(201).json({ filename });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.stderr || err.message });
  }
});

app.get('/api/backups/:filename/download', requireAdmin, (req, res) => {
  const full = resolveBackupPath(req.params.filename);
  if (!full) return res.status(404).json({ error: 'not_found' });
  res.download(full, req.params.filename);
});

app.delete('/api/backups/:filename', requireAdmin, (req, res) => {
  const full = resolveBackupPath(req.params.filename);
  if (!full) return res.status(404).json({ error: 'not_found' });
  try {
    fs.unlinkSync(full);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// Restaura um backup existente. Por segurança, tira uma foto do banco ATUAL
// antes de sobrescrever (prefixo "pre-restore-"), para permitir desfazer.
app.post('/api/backups/:filename/restore', requireAdmin, async (req, res) => {
  const full = resolveBackupPath(req.params.filename);
  if (!full) return res.status(404).json({ error: 'not_found' });
  try {
    await performBackup('pre-restore');
    await runCli('pg_restore', ['--clean', '--if-exists', '--no-owner', '-d', getConnectionString(), full]);
    res.json({ ok: true, message: 'Restore complete. Reload the page to see the restored data.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.stderr || err.message });
  }
});

app.get('/api/backup-schedule', requireAdmin, async (req, res) => {
  try {
    res.json({
      enabled: (await readGlobalSetting('backupScheduleEnabled', '0')) === '1',
      frequency: await readGlobalSetting('backupScheduleFrequency', 'daily'),
      weeklyDays: ((await readGlobalSetting('backupScheduleWeeklyDays', '')) || '').split(',').map(s => s.trim()).filter(Boolean).map(Number),
      monthlyDay: parseInt(await readGlobalSetting('backupScheduleMonthlyDay', '1'), 10) || 1,
      time: await readGlobalSetting('backupScheduleTime', '02:00'),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

app.put('/api/backup-schedule', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const frequency = ['daily', 'weekly', 'monthly'].includes(body.frequency) ? body.frequency : 'daily';
    const weeklyDays = Array.isArray(body.weeklyDays) ? body.weeklyDays.map(Number).filter(n => n >= 0 && n <= 6) : [];
    const monthlyDay = Math.min(31, Math.max(1, parseInt(body.monthlyDay, 10) || 1));
    const time = /^\d{2}:\d{2}$/.test(body.time) ? body.time : '02:00';
    await writeGlobalSetting('backupScheduleEnabled', body.enabled ? '1' : '0');
    await writeGlobalSetting('backupScheduleFrequency', frequency);
    await writeGlobalSetting('backupScheduleWeeklyDays', weeklyDays.join(','));
    await writeGlobalSetting('backupScheduleMonthlyDay', String(monthlyDay));
    await writeGlobalSetting('backupScheduleTime', time);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// Checagem a cada minuto — dispara o backup automático quando o horário
// configurado bate com o horário atual, respeitando a frequência.
// backupScheduleLastRunDate evita rodar mais de uma vez no mesmo dia.
function checkScheduledBackup() {
  (async () => {
    try {
      if ((await readGlobalSetting('backupScheduleEnabled', '0')) !== '1') return;
      const time = await readGlobalSetting('backupScheduleTime', '02:00');
      const now = new Date();
      if (`${pad2(now.getHours())}:${pad2(now.getMinutes())}` !== time) return;

      const todayKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
      if ((await readGlobalSetting('backupScheduleLastRunDate', '')) === todayKey) return;

      const frequency = await readGlobalSetting('backupScheduleFrequency', 'daily');
      if (frequency === 'weekly') {
        const days = ((await readGlobalSetting('backupScheduleWeeklyDays', '')) || '').split(',').map(s => s.trim()).filter(Boolean).map(Number);
        if (!days.includes(now.getDay())) return;
      } else if (frequency === 'monthly') {
        const configuredDay = parseInt(await readGlobalSetting('backupScheduleMonthlyDay', '1'), 10) || 1;
        const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        if (now.getDate() !== Math.min(configuredDay, lastDayOfMonth)) return;
      }

      const filename = await performBackup('scheduled');
      await writeGlobalSetting('backupScheduleLastRunDate', todayKey);
      console.log(`[backup] Backup agendado criado: ${filename}`);
    } catch (err) {
      console.error('[backup] Erro ao checar agendamento de backup:', err);
    }
  })();
}
// ════════════════════════════════════════════════
// Startup — aguarda o Postgres (cg-toolbox-db) responder e o schema ser
// aplicado antes de começar a aceitar requisições HTTP. O agendamento de
// backup (setInterval) só é registrado DEPOIS disso — chamá-lo antes faria
// checkScheduledBackup() consultar `user_data` numa corrida contra o CREATE
// TABLE do initDb() (mesmo processo, mesma tabela), gerando um erro
// "relation does not exist" inofensivo mas ruidoso no primeiro boot.
// ════════════════════════════════════════════════
(async () => {
  try {
    await initDb();
    setInterval(checkScheduledBackup, 60 * 1000);
    checkScheduledBackup();
    app.listen(PORT, () => {
      console.log(`CG Toolbox backend listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start: could not connect to the database.', err);
    process.exit(1);
  }
})();
