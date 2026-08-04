// index.js — Express app: serves the static frontend (project root) and exposes
// the /api/commands REST API backed by SQLite (better-sqlite3), db.js.
// Banco ÚNICO (`db`) — antes havia dois arquivos separados (System/usuário,
// ver histórico em server/db.js); a distinção hoje é só a coluna
// `commands.created_by`. Regra de PERMISSÃO: PUT/DELETE /api/commands/:id só
// são permitidos quando `created_by` do comando é igual ao usuário atual
// (ver getCurrentUsername abaixo) — ninguém pode alterar/excluir o comando de
// outro usuário. Duplicar (POST, via "Duplicate command" no editor) sempre
// funciona para qualquer comando visível, e a cópia nasce com created_by =
// quem duplicou, então passa a ser editável por essa pessoa. Não há
// autenticação própria além da identificação NTLM (mesmo modelo de confiança
// de sempre) — isto impede edição ACIDENTAL/indevida entre usuários, não é
// uma fronteira de segurança contra alguém decidido a burlar.
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const https = require('https');
const express = require('express');
const { db, DB_PATH } = require('./db');

const app = express();
const FRONTEND_ROOT = path.join(__dirname, '..');

// Duas portas ativas em paralelo (sem redirecionamento entre elas — cada
// uma serve a aplicação diretamente):
//   - HTTP_PORT (padrão 80): sempre em HTTP puro.
//   - HTTPS_PORT (padrão 443): em HTTPS de verdade SE TLS_CERT_PATH e
//     TLS_KEY_PATH apontarem para um certificado/chave válidos; caso
//     contrário sobe em HTTP puro também (com aviso no log), para nunca
//     ficar indisponível enquanto o certificado definitivo não chega — só
//     trocar os arquivos e reiniciar o serviço depois, sem mudar código.
// PORT (variável antiga, de instalações anteriores a essa mudança) continua
// funcionando como alias de HTTP_PORT, para compatibilidade.
// No Docker (ver Dockerfile/docker-compose.yml), o container roda como
// usuário não-root e por padrão HTTP_PORT=HTTPS_PORT=3000 (via PORT=3000) —
// portas <1024 exigem privilégio, então lá o "80"/"443" de fora vem do
// mapeamento de porta do host (docker-compose "80:3000"), não de bind direto
// dentro do container.
const HTTP_PORT = process.env.HTTP_PORT || process.env.PORT || 80;
const HTTPS_PORT = process.env.HTTPS_PORT || 443;
const TLS_CERT_PATH = process.env.TLS_CERT_PATH;
const TLS_KEY_PATH = process.env.TLS_KEY_PATH;

// Botão "Check for updates"/"Update now" (Settings → System) — este
// processo (container cg-toolbox) não tem git nem Docker CLI de propósito
// (imagem enxuta/non-root, ver Dockerfile); quem sabe fazer isso é o
// serviço companion "updater" (ver updater/server.js e docker-compose.yml),
// alcançável só pela rede interna do compose. Sem UPDATER_URL configurado
// (ex.: instalação sem Docker), os dois endpoints abaixo respondem 501 e o
// botão no frontend mostra "not available nesta instalação".
const UPDATER_URL = process.env.UPDATER_URL || null;
const UPDATER_TOKEN = process.env.UPDATER_TOKEN || '';

// Limite maior que o padrão do Express (100kb) para caber o payload de um
// comando com uma ou mais linhas de imagem (screenshots de configuração,
// ver command_lines.image_data em schema.sql) — a imagem viaja em base64
// dentro do JSON, ~33% maior que o arquivo original.
app.use(express.json({ limit: '15mb' }));

// ════════════════════════════════════════════════
// Identificação do usuário (multiusuário — servidor central compartilhado)
// Em produção, o handshake NTLM identifica o login do Windows de quem está
// acessando (silencioso no navegador, sem prompt de senha, desde que o site
// esteja na zona "Intranet local" do Windows/domínio). Definir NTLM_DISABLED=1
// no ambiente desliga isso (útil para desenvolvimento fora de um domínio
// Windows) — nesse caso aceita um header/query de teste ou cai para o usuário
// do sistema operacional rodando o processo Node.
// ════════════════════════════════════════════════
const NTLM_DISABLED = process.env.NTLM_DISABLED === '1';
if (!NTLM_DISABLED) {
  const ntlm = require('express-ntlm');
  app.use(ntlm({
    domain: process.env.NTLM_DOMAIN || undefined,
    // domaincontroller não configurado de propósito: identifica o usuário pelo
    // handshake NTLM do próprio Windows, sem validar contra o Active Directory —
    // suficiente aqui, já que isto é só identificação/conveniência (favoritos,
    // preferências), não uma barreira de segurança.
  }));
}
function getCurrentUsername(req) {
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
function logAudit(username, action, commandId, commandName) {
  try {
    db.prepare(
      'INSERT INTO audit_log (username, action, command_id, command_name) VALUES (?,?,?,?)'
    ).run(username || null, action, commandId || null, commandName || null);
    db.prepare(`DELETE FROM audit_log WHERE ts < datetime('now', '-${AUDIT_LOG_RETENTION_DAYS} days')`).run();
  } catch (e) {
    console.error('logAudit failed:', e);
  }
}

// sAMAccountName "puro" (sem DOMÍNIO\), usado como chave de busca no Active
// Directory — o NTLM já entrega isso separado do domínio (req.ntlm.UserName).
function getCurrentSamAccountName(req) {
  if (req.ntlm && req.ntlm.UserName) return req.ntlm.UserName;
  const devUser = req.headers['x-dev-user'] || req.query.__user;
  if (devUser) return String(devUser).split('\\').pop();
  try { return os.userInfo().username; } catch (e) { return 'guest'; }
}

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

// ── static frontend (index.html, css/, js/) ─────────────────────────────
app.use(express.static(FRONTEND_ROOT));

// ════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════
// Aplicação é 100% em inglês (sem i18n) — não há mais parâmetro de idioma a
// resolver; todo texto do banco já é um único campo canônico.
function shapeCommand(row) {
  const tags = db.prepare(
    'SELECT css_class, label FROM command_tags WHERE command_id = ? ORDER BY sort_order, id'
  ).all(row.id).map(t => ({ css_class: t.css_class, label: t.label }));

  // Fabricante/Sistema — topo da hierarquia multi-fabricante
  // (Vendor → Sistema → Versão → Ambiente → Tópico). Mesma semântica de
  // versions/environments abaixo: ausência de linhas = "aplica a todos".
  const vendors = db.prepare(
    'SELECT vendor FROM command_vendors WHERE command_id = ? ORDER BY vendor'
  ).all(row.id).map(v => v.vendor);

  const systemList = db.prepare(
    'SELECT system FROM command_systems WHERE command_id = ? ORDER BY system'
  ).all(row.id).map(s => s.system);

  const versions = db.prepare(
    'SELECT version FROM command_versions WHERE command_id = ? ORDER BY version'
  ).all(row.id).map(v => v.version);

  const environments = db.prepare(
    'SELECT environment FROM command_environments WHERE command_id = ? ORDER BY environment'
  ).all(row.id).map(e => e.environment);

  // Um comando pode pertencer a mais de um Tópico (command_topics); `topic` (singular)
  // é mantido só por compatibilidade (= topics[0], o "tópico primário").
  const topics = db.prepare(
    'SELECT topic FROM command_topics WHERE command_id = ? ORDER BY topic'
  ).all(row.id).map(t => t.topic);

  // Favoritos são compartilhados entre usuários (ver user_favorites) — todo
  // card traz quantos e QUAIS usuários o favoritaram, para a estrela mostrar
  // a contagem e o hover listar os nomes (independe de quem está olhando a
  // tela agora, e independe de quem criou o comando).
  const favoritedBy = db.prepare(
    'SELECT username FROM user_favorites WHERE command_id = ? ORDER BY username'
  ).all(row.id).map(f => f.username);

  const lineRows = db.prepare(
    'SELECT variant, sort_order, line_type, prompt, content, supports_export, image_data FROM command_lines WHERE command_id = ? ORDER BY variant, sort_order, id'
  ).all(row.id);

  const shapeLine = l => ({
    line_type: l.line_type,
    prompt: l.prompt,
    content: l.content,
    supports_export: !!l.supports_export,
    image_data: l.image_data || null,
  });

  const lines = {
    default: lineRows.filter(l => l.variant === 'default').map(shapeLine),
    empty: lineRows.filter(l => l.variant === 'empty').map(shapeLine),
  };

  const diffRows = db.prepare(
    'SELECT id, version, note, sort_order FROM command_diffs WHERE command_id = ? ORDER BY sort_order, id'
  ).all(row.id);

  const diffLineStmt = db.prepare(
    'SELECT sort_order, line_type, prompt, content FROM command_diff_lines WHERE diff_id = ? ORDER BY sort_order, id'
  );

  const diffs = diffRows.map(d => ({
    version: d.version,
    note: d.note,
    lines: diffLineStmt.all(d.id).map(shapeLine),
  }));

  return {
    id: row.id,
    topic: row.topic,
    topics: topics.length ? topics : [row.topic],
    favorite_count: favoritedBy.length,
    favorited_by: favoritedBy,
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
    // Autoria/auditoria + PERMISSÃO (ver comentário em schema.sql e no topo
    // deste arquivo): PUT/DELETE /api/commands/:id só são aceitos quando o
    // usuário atual é igual a `created_by`. A UI usa `created_by` (comparado
    // com o usuário logado, ver CURRENT_USER em js/user-sync.js) para decidir
    // se mostra o botão "Edit" no card (ver terminal-renderer.js: card()) —
    // "Duplicate" sempre aparece para qualquer comando. Sem 1ª edição ainda,
    // modified_by cai em created_by (ninguém alterou = o criador é, por
    // definição, quem fez a "última alteração"). `is_system` é só um atalho
    // de leitura (created_by === 'System') mantido para o toggle "System
    // commands" da sidebar (ver SHOW_SYSTEM_COMMANDS em js/render.js).
    created_by: row.created_by || null,
    modified_by: row.modified_by || row.created_by || null,
    is_system: row.created_by === 'System',
  };
}

function findCommand(id) {
  return db.prepare('SELECT * FROM commands WHERE id = ?').get(id);
}

// Mantido para compatibilidade com os poucos lugares que só precisam saber SE
// o comando existe (ex.: POST /api/favorites).
function getCommandRow(id) {
  return findCommand(id);
}

// ════════════════════════════════════════════════
// GET /api/commands
// ════════════════════════════════════════════════
app.get('/api/commands', (req, res) => {
  try {
    const { topic, version, environment, vendor, system: systemParam, sort } = req.query;

    let sql = 'SELECT * FROM commands WHERE 1=1';
    const params = {};
    if (topic) {
      // Um comando pode ter vários tópicos (command_topics) — casa se QUALQUER um bater
      // (diferente de versão/ambiente: aqui não existe "nenhum marcado = todos").
      sql += ` AND EXISTS (SELECT 1 FROM command_topics ct WHERE ct.command_id = commands.id AND ct.topic = @topic)`;
      params.topic = topic;
    }
    if (vendor) {
      sql += ` AND (
        NOT EXISTS (SELECT 1 FROM command_vendors cv WHERE cv.command_id = commands.id)
        OR EXISTS (SELECT 1 FROM command_vendors cv WHERE cv.command_id = commands.id AND cv.vendor = @vendor)
      )`;
      params.vendor = vendor;
    }
    if (systemParam) {
      sql += ` AND (
        NOT EXISTS (SELECT 1 FROM command_systems cs WHERE cs.command_id = commands.id)
        OR EXISTS (SELECT 1 FROM command_systems cs WHERE cs.command_id = commands.id AND cs.system = @system)
      )`;
      params.system = systemParam;
    }
    if (version) {
      sql += ` AND (
        NOT EXISTS (SELECT 1 FROM command_versions cv WHERE cv.command_id = commands.id)
        OR EXISTS (SELECT 1 FROM command_versions cv WHERE cv.command_id = commands.id AND cv.version = @version)
      )`;
      params.version = version;
    }
    if (environment) {
      sql += ` AND (
        NOT EXISTS (SELECT 1 FROM command_environments ce WHERE ce.command_id = commands.id)
        OR EXISTS (SELECT 1 FROM command_environments ce WHERE ce.command_id = commands.id AND ce.environment = @environment)
      )`;
      params.environment = environment;
    }
    // Ordenação padrão é a curatorial (sort_order/id) de sempre. `?sort=creator`
    // reordena a lista por quem cadastrou o comando (created_by) — pedido do
    // usuário para poder ver/agrupar visualmente os comandos por autor; dentro
    // de cada autor mantém a ordem curatorial normal como desempate.
    sql += (sort === 'creator') ? ' ORDER BY created_by, sort_order, id' : ' ORDER BY sort_order, id';

    const rows = db.prepare(sql).all(params).map(r => shapeCommand(r));
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// GET /api/commands/:id
// ════════════════════════════════════════════════
app.get('/api/commands/:id', (req, res) => {
  try {
    const row = findCommand(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found', message: `Command '${req.params.id}' not found` });
    res.json(shapeCommand(row));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// GET /api/me — usuário identificado (login do Windows via NTLM, ou fallback dev)
// ════════════════════════════════════════════════
app.get('/api/me', async (req, res) => {
  const username = getCurrentUsername(req); // ex.: 'CG2000\\rsilva' — chave interna (favoritos/preferências), nunca muda
  let upn = null;
  try { upn = await lookupUpnFromAD(getCurrentSamAccountName(req)); } catch (e) { /* já logado em lookupUpnFromAD */ }
  res.json({ username, upn: upn || username }); // upn: exibido na UI; cai em `username` se AD não configurado/indisponível
});

// ════════════════════════════════════════════════
// Favoritos por usuário (ver user_favorites) — compartilhados: o GET /api/commands
// já traz favorite_count/favorited_by agregados de TODOS os usuários; estes
// endpoints são só para ler/alterar os favoritos do usuário ATUAL.
// ════════════════════════════════════════════════
app.get('/api/favorites', (req, res) => {
  try {
    const username = getCurrentUsername(req);
    const rows = db.prepare('SELECT command_id FROM user_favorites WHERE username = ? ORDER BY created_at').all(username);
    res.json(rows.map(r => r.command_id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

app.post('/api/favorites/:commandId', (req, res) => {
  try {
    const username = getCurrentUsername(req);
    const { commandId } = req.params;
    if (!getCommandRow(commandId)) return res.status(404).json({ error: 'not_found', message: `Command '${commandId}' not found` });
    db.prepare('INSERT OR IGNORE INTO user_favorites (username, command_id) VALUES (?, ?)').run(username, commandId);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

app.delete('/api/favorites/:commandId', (req, res) => {
  try {
    const username = getCurrentUsername(req);
    db.prepare('DELETE FROM user_favorites WHERE username = ? AND command_id = ?').run(username, req.params.commandId);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// GET /api/audit-log — lista as alterações de comando (criar/editar/excluir)
// dos últimos 30 dias (ver audit_log em schema.sql e logAudit() acima), mais
// recente primeiro. Consumido pelo botão "View audit log" em Configurações
// (js/audit-log.js). Sem filtro de usuário — qualquer usuário autenticado
// pode ver o log inteiro (é uma trilha de auditoria compartilhada, não
// pessoal). Teto de 1000 linhas por segurança, embora a retenção de 30 dias
// já deva manter o volume bem abaixo disso na prática.
// ════════════════════════════════════════════════
app.get('/api/audit-log', (req, res) => {
  try {
    const rows = db.prepare(
      `SELECT id, ts, username, action, command_id, command_name
       FROM audit_log
       WHERE ts >= datetime('now', '-${AUDIT_LOG_RETENTION_DAYS} days')
       ORDER BY ts DESC, id DESC
       LIMIT 1000`
    ).all();
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
app.get('/api/user-data', (req, res) => {
  try {
    const username = getCurrentUsername(req);
    const rows = db.prepare('SELECT data_key, value FROM user_data WHERE username = ?').all(username);
    const out = {};
    rows.forEach(r => { out[r.data_key] = r.value; });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

app.put('/api/user-data', (req, res) => {
  try {
    const username = getCurrentUsername(req);
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'validation_error', message: 'Request body must be a JSON object of {key: value}' });
    }
    const upsert = db.prepare(`
      INSERT INTO user_data (username, data_key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(username, data_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    const tx = db.transaction(() => {
      Object.keys(body).forEach(key => {
        const val = body[key];
        if (val === null || val === undefined) return;
        upsert.run(username, key, String(val));
      });
    });
    tx();
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// Configurações padrão do administrador ("Admin mode" no modal de
// Configurações — ver js/settings.js) — reaproveita a MESMA tabela user_data
// (sem alterar o schema), só que sob um username reservado/sentinela que
// nunca corresponde a um login de verdade. Ao contrário de /api/user-data
// (por usuário), isto é um valor ÚNICO para todo mundo: quando um usuário
// carrega o app pela 1ª vez e ainda não tem preferência própria salva
// (ver hasExplicitSetting() em settings.js), ele herda o default definido
// aqui em vez de um valor fixo no código. Depois que o usuário mexe no
// próprio toggle, a preferência pessoal dele passa a valer sempre — mudar o
// default aqui não afeta retroativamente quem já tem uma escolha própria.
// ════════════════════════════════════════════════
const GLOBAL_SETTINGS_USER = '__global_defaults__';

app.get('/api/global-settings', (req, res) => {
  try {
    const rows = db.prepare('SELECT data_key, value FROM user_data WHERE username = ?').all(GLOBAL_SETTINGS_USER);
    const out = {};
    rows.forEach(r => { out[r.data_key] = r.value; });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

app.put('/api/global-settings', (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'validation_error', message: 'Request body must be a JSON object of {key: value}' });
    }
    const upsert = db.prepare(`
      INSERT INTO user_data (username, data_key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(username, data_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    const tx = db.transaction(() => {
      Object.keys(body).forEach(key => {
        const val = body[key];
        if (val === null || val === undefined) return;
        upsert.run(GLOBAL_SETTINGS_USER, key, String(val));
      });
    });
    tx();
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// Validation + write helpers
// ════════════════════════════════════════════════
// Um comando pode ter vários Tópicos (body.topics, array — preferido) ou, por
// compatibilidade com chamadas antigas, um único body.topic (string). Sempre
// retorna um array não vazio (ou [] se nada foi informado, tratado como erro
// de validação abaixo).
function resolveTopics(body) {
  if (Array.isArray(body.topics) && body.topics.length) return body.topics;
  if (body.topic && typeof body.topic === 'string') return [body.topic];
  return [];
}

// "Nenhum marcado = aplica a todos" é uma convenção que só existe do lado do
// FILTRO (sidebar/Configurações — "All"/toggle mestre) — no cadastro de um
// comando, essas 4 listas (junto com Topic) são obrigatórias: precisa marcar
// pelo menos um Vendor, um System, uma Version e um Environment. Isso evita
// um comando "genérico demais" (aplicável a qualquer fabricante/sistema/
// versão/ambiente) ser criado sem intenção explícita.
function isNonEmptyArray(val) {
  return Array.isArray(val) && val.length > 0;
}

function validateBody(body) {
  const errors = [];
  if (!body || typeof body !== 'object') return ['Request body must be a JSON object'];
  if (!body.id || typeof body.id !== 'string') errors.push('"id" is required');
  // A command belongs to exactly one vendor (unlike systems/versions/environments/
  // topics, which a command can have several of) — the client enforces this with a
  // single-select control (see _ceBindVendorSeg in js/command-editor.js), this is
  // the server-side backstop.
  if (!isNonEmptyArray(body.vendors)) errors.push('"vendors" is required (exactly one vendor)');
  else if (body.vendors.length > 1) errors.push('"vendors" must contain exactly one vendor (a command belongs to a single vendor)');
  if (!isNonEmptyArray(body.systems)) errors.push('"systems" is required (at least one system)');
  if (!isNonEmptyArray(body.versions)) errors.push('"versions" is required (at least one version)');
  if (!isNonEmptyArray(body.environments)) errors.push('"environments" is required (at least one environment)');
  if (!resolveTopics(body).length) errors.push('"topics" is required (at least one topic)');
  if (!body.name || typeof body.name !== 'string') errors.push('"name" is required');
  return errors;
}

// Nullable (pode legitimamente estar ausente — ex.: name_empty para comandos
// que não mudam quando SRC/DST estão vazios).
const NULLABLE_TEXT_FIELDS = ['name_empty', 'desc_empty'];
// Sempre string (NOT NULL DEFAULT '' em schema.sql).
const REQUIRED_TEXT_FIELDS = ['name', 'desc', 'about_purpose', 'about_when', 'about_obs'];

function buildCommandColumns(body) {
  // `topic` (coluna, singular) é mantido em paralelo = topics[0], só por
  // compatibilidade — a lista completa vive em command_topics (ver insertChildren).
  const topics = resolveTopics(body);
  // Guarda estrutural: requires_ips/requires_ip_port fazem buildCardHtmlForRow
  // (js/db-render-engine.js) trocar para um "empty state" quando SRC/DST (ou
  // IP/Porta genéricos) não estão preenchidos — e se não existir NENHUMA linha
  // variant='empty' cadastrada, buildEmptyStateCard retorna null e o card
  // desaparece da tela por completo, sem erro nenhum visível (bug real: um
  // comando importado via CSV com "Requires IP/Port"=Yes ficou invisível,
  // porque a importação por CSV nunca cria linhas variant='empty' — só o
  // editor manual, tela Avançado, tem esse campo). Por isso o server nunca
  // aceita requires_ips/requires_ip_port=1 sem pelo menos uma linha empty com
  // conteúdo — se vier assim, a flag é rebaixada para 0 em vez de deixar o
  // comando entrar num estado "invisível por design". Vale tanto pra CSV
  // import quanto pro editor manual (mesmo payload shape), é a única fonte de
  // verdade.
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

// Banco único (ver server/db.js) — todas as tabelas filhas moram em `db`.
function insertChildren(id, body) {
  const tagStmt = db.prepare(
    'INSERT INTO command_tags (command_id, css_class, label, sort_order) VALUES (?, ?, ?, ?)'
  );
  (body.tags || []).forEach((tag, i) => {
    tagStmt.run(id, tag.css_class, tag.label, Number.isInteger(tag.sort_order) ? tag.sort_order : i);
  });

  const topicStmt = db.prepare('INSERT INTO command_topics (command_id, topic) VALUES (?, ?)');
  resolveTopics(body).forEach(tp => topicStmt.run(id, tp));

  const vendorStmt = db.prepare('INSERT INTO command_vendors (command_id, vendor) VALUES (?, ?)');
  (body.vendors || []).forEach(v => vendorStmt.run(id, v));

  const systemStmt = db.prepare('INSERT INTO command_systems (command_id, system) VALUES (?, ?)');
  (body.systems || []).forEach(s => systemStmt.run(id, s));

  const versionStmt = db.prepare('INSERT INTO command_versions (command_id, version) VALUES (?, ?)');
  (body.versions || []).forEach(v => versionStmt.run(id, v));

  const envStmt = db.prepare('INSERT INTO command_environments (command_id, environment) VALUES (?, ?)');
  (body.environments || []).forEach(e => envStmt.run(id, e));

  const lineStmt = db.prepare(
    `INSERT INTO command_lines (command_id, variant, sort_order, line_type, prompt, content, supports_export, image_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  (body.lines || []).forEach((line, i) => {
    lineStmt.run(
      id,
      line.variant || 'default',
      Number.isInteger(line.sort_order) ? line.sort_order : i,
      line.line_type || 'cmd',
      line.prompt || null,
      line.content || '',
      line.supports_export ? 1 : 0,
      line.line_type === 'image' ? (line.image_data || null) : null
    );
  });

  const diffStmt = db.prepare(
    'INSERT INTO command_diffs (command_id, version, note, sort_order) VALUES (?, ?, ?, ?)'
  );
  const diffLineStmt = db.prepare(
    `INSERT INTO command_diff_lines (diff_id, sort_order, line_type, prompt, content)
     VALUES (?, ?, ?, ?, ?)`
  );
  (body.diffs || []).forEach((diff, i) => {
    const result = diffStmt.run(id, diff.version, diff.note || '', Number.isInteger(diff.sort_order) ? diff.sort_order : i);
    const diffId = result.lastInsertRowid;
    (diff.lines || []).forEach((line, j) => {
      diffLineStmt.run(diffId, Number.isInteger(line.sort_order) ? line.sort_order : j, line.line_type || 'cmd', line.prompt || null, line.content || '');
    });
  });
}

// ════════════════════════════════════════════════
// POST /api/commands — create
// ════════════════════════════════════════════════
app.post('/api/commands', (req, res) => {
  const errors = validateBody(req.body);
  if (errors.length) return res.status(400).json({ error: 'validation_error', message: errors.join('; ') });

  const { id } = req.body;
  const existing = findCommand(id);
  if (existing) return res.status(409).json({ error: 'conflict', message: `Command '${id}' already exists` });

  try {
    const cols = buildCommandColumns(req.body);
    // Todo comando criado por esta API (inclusive via "Duplicate command", que
    // salva como create — ver command-editor.js) é atribuído ao usuário atual
    // (created_by = modified_by = quem está autenticado). Não existe mais a
    // opção de gravar como 'System' por aqui — ver comentário no topo do
    // arquivo sobre a remoção do gesto Ctrl+Alt/Admin mode.
    const username = getCurrentUsername(req);
    cols.created_by = username;
    cols.modified_by = username;
    const create = db.transaction(() => {
      db.prepare(
        `INSERT INTO commands (
          id, topic, icon, sort_order, requires_ips, requires_ip_port, placeholder_resolver, raw_template,
          name, name_empty, desc, desc_empty,
          about_icon, about_purpose, about_when, about_obs,
          created_by, modified_by
        ) VALUES (
          @id, @topic, @icon, @sort_order, @requires_ips, @requires_ip_port, @placeholder_resolver, @raw_template,
          @name, @name_empty, @desc, @desc_empty,
          @about_icon, @about_purpose, @about_when, @about_obs,
          @created_by, @modified_by
        )`
      ).run(cols);
      insertChildren(id, req.body);
    });
    create();
    logAudit(username, 'create', id, cols.name);
    res.status(201).json(shapeCommand(db.prepare('SELECT * FROM commands WHERE id = ?').get(id)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// PUT /api/commands/:id — full update (replace children)
// ════════════════════════════════════════════════
app.put('/api/commands/:id', (req, res) => {
  const id = req.params.id;
  const found = findCommand(id);
  if (!found) return res.status(404).json({ error: 'not_found', message: `Command '${id}' not found` });

  // Sem restrição de dono: qualquer usuário autenticado pode editar qualquer
  // comando (inclusive os de referência created_by='System') — a pedido do
  // usuário. `modified_by` abaixo continua registrando quem fez a última
  // alteração, e cada edição fica registrada no audit_log (ver logAudit()).
  const currentUser = getCurrentUsername(req);

  const bodyForValidation = { ...req.body, id: req.body.id || id };
  const errors = validateBody(bodyForValidation);
  if (errors.length) return res.status(400).json({ error: 'validation_error', message: errors.join('; ') });

  if (req.body.id && req.body.id !== id) {
    return res.status(400).json({ error: 'validation_error', message: 'Body "id" does not match URL id and cannot be changed' });
  }

  try {
    const cols = buildCommandColumns({ ...req.body, id });
    cols.modified_by = currentUser;
    const update = db.transaction(() => {
      db.prepare(
        `UPDATE commands SET
          topic = @topic, icon = @icon, sort_order = @sort_order, requires_ips = @requires_ips,
          requires_ip_port = @requires_ip_port,
          placeholder_resolver = @placeholder_resolver, raw_template = @raw_template,
          name = @name, name_empty = @name_empty, desc = @desc, desc_empty = @desc_empty,
          about_icon = @about_icon, about_purpose = @about_purpose, about_when = @about_when, about_obs = @about_obs,
          modified_by = @modified_by,
          updated_at = datetime('now')
        WHERE id = @id`
      ).run(cols);

      db.prepare('DELETE FROM command_tags WHERE command_id = ?').run(id);
      db.prepare('DELETE FROM command_topics WHERE command_id = ?').run(id);
      db.prepare('DELETE FROM command_vendors WHERE command_id = ?').run(id);
      db.prepare('DELETE FROM command_systems WHERE command_id = ?').run(id);
      db.prepare('DELETE FROM command_versions WHERE command_id = ?').run(id);
      db.prepare('DELETE FROM command_environments WHERE command_id = ?').run(id);
      db.prepare('DELETE FROM command_lines WHERE command_id = ?').run(id);
      db.prepare('DELETE FROM command_diffs WHERE command_id = ?').run(id); // cascades to command_diff_lines

      insertChildren(id, req.body);
    });
    update();
    logAudit(currentUser, 'update', id, cols.name);
    res.json(shapeCommand(db.prepare('SELECT * FROM commands WHERE id = ?').get(id)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// DELETE /api/commands/:id
// ════════════════════════════════════════════════
app.delete('/api/commands/:id', (req, res) => {
  const id = req.params.id;
  const found = findCommand(id);
  if (!found) return res.status(404).json({ error: 'not_found', message: `Command '${id}' not found` });
  // Sem restrição de dono (mesma decisão do PUT acima) — qualquer usuário
  // autenticado pode excluir qualquer comando. Fica registrado no audit_log
  // (ver logAudit()) para haver rastro de quem excluiu o quê.
  const currentUser = getCurrentUsername(req);
  try {
    // command_id em user_favorites agora tem FK ON DELETE CASCADE (ver
    // schema.sql) — apagar o comando já limpa os favoritos sozinho, sem
    // limpeza manual.
    db.prepare('DELETE FROM commands WHERE id = ?').run(id);
    logAudit(currentUser, 'delete', id, found.name);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// Catálogos administráveis — Versão / Ambiente / Tópico
// Antes eram listas fixas no front-end (VERSION_KEYS/ENV_KEYS/TYPE_KEYS em
// js/state.js); agora ficam nas tabelas versions/environments/topics
// (server/schema.sql + seed inicial em server/db.js) e podem ser cadastradas,
// editadas e excluídas pelo "Modo administrador" (mesmo toggle
// enableCommandEditing já usado para comandos — ver js/settings.js). Sem
// autenticação própria além do NTLM de identificação, igual ao resto da API
// hoje (ver comentário em getCurrentUsername acima).
//
// `key` nunca é editável depois de criado (é o valor gravado em
// command_versions.version / command_environments.environment /
// command_topics.topic) — só label/cor/ícone/ordem. Exclusão é bloqueada com
// 409 quando o valor está em uso por pelo menos um comando, ou (só para
// tópicos) quando é protegido (is_protected=1, ex.: 'environment').
// ════════════════════════════════════════════════
const CATALOG_KEY_RE = /^[A-Za-z0-9._-]{1,40}$/;

// `key` de Vendor/System/Version/Environment/Topic é sempre gerado no servidor
// a partir do `label` (slug) — o usuário nunca digita/vê um "ID" separado no
// admin de catálogo (só o label, aparente na UI). Isso é diferente de
// Parameters, cujo `key` continua digitado manualmente porque é o próprio
// token {{key}}/prefixo de busca que o usuário precisa conhecer e usar.
function slugifyCatalogKey(label) {
  let s = String(label == null ? '' : label).trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .replace(/-{2,}/g, '-');
  if (!s) s = 'item';
  return s.slice(0, 40);
}
// Acrescenta -2/-3/... até `existsFn(candidate)` retornar false. `existsFn`
// recebe a chave candidata e deve checar unicidade no escopo certo (global
// para vendors/environments/topics/systems; por vendor para versions).
function uniqueCatalogKey(base, existsFn) {
  let candidate = base;
  let n = 2;
  while (existsFn(candidate)) {
    const suffix = '-' + n;
    candidate = base.slice(0, Math.max(1, 40 - suffix.length)) + suffix;
    n++;
  }
  return candidate;
}

// Conta quantos comandos usam uma versão/ambiente/tópico/vendor/sistema —
// banco único (ver server/db.js), então é uma contagem simples.
function countAcrossBothDbs(table, column, key) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(key).n;
}

// GET /api/catalogs — os 3 catálogos de uma vez (usado no boot do front-end e
// para recarregar a UI depois de qualquer criação/edição/exclusão no modal admin).
app.get('/api/catalogs', (req, res) => {
  try {
    res.json({
      vendors: db.prepare('SELECT * FROM vendors ORDER BY sort_order, key').all(),
      systems: db.prepare('SELECT * FROM systems ORDER BY sort_order, key').all(),
      versions: db.prepare('SELECT * FROM versions ORDER BY sort_order, key').all(),
      environments: db.prepare('SELECT * FROM environments ORDER BY sort_order, key').all(),
      topics: db.prepare('SELECT * FROM topics ORDER BY sort_order, key').all(),
      parameters: db.prepare('SELECT * FROM parameters ORDER BY sort_order, key').all(),
      // Versão ↔ Ambiente e Ambiente ↔ Tópico continuam N:N (ver schema.sql) —
      // usados pelo front-end para restringir as opções mostradas na cascata
      // de filtros (js/catalogs.js monta um mapa a partir destas listas
      // planas). Vendor → Sistema → Versão NÃO usa mais vínculo N:N — agora é
      // FK direta (systems.vendor / versions.system), já incluída nos objetos
      // `systems`/`versions` acima.
      version_environments: db.prepare('SELECT version, environment FROM version_environments').all(),
      environment_topics: db.prepare('SELECT environment, topic FROM environment_topics').all(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// Substitui (delete+insert) o conjunto de pais vinculados a um item filho —
// usado pela cascata N:N Versão ↔ Ambiente / Ambiente ↔ Tópico (ver
// comentário em schema.sql). `parentKeys` vazio/ausente = remove todos os
// vínculos (item volta a ficar "sem restrição conhecida").
function replaceScopeLinks(joinTable, childCol, childKey, parentCol, parentKeys) {
  db.prepare(`DELETE FROM ${joinTable} WHERE ${childCol} = ?`).run(childKey);
  const ins = db.prepare(`INSERT OR IGNORE INTO ${joinTable} (${childCol}, ${parentCol}) VALUES (?, ?)`);
  (Array.isArray(parentKeys) ? parentKeys : []).forEach(pk => ins.run(childKey, pk));
}

// ── Fabricantes (Vendor) ──────────────────────────
app.post('/api/vendors', (req, res) => {
  const { label, color } = req.body || {};
  if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
  const key = uniqueCatalogKey(slugifyCatalogKey(label), k => !!db.prepare('SELECT 1 FROM vendors WHERE key = ?').get(k));
  try {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM vendors').get().m;
    db.prepare('INSERT INTO vendors (key, label, color, sort_order) VALUES (?, ?, ?, ?)').run(key, label, color || '#8B949E', maxOrder + 1);
    res.status(201).json(db.prepare('SELECT * FROM vendors WHERE key = ?').get(key));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.put('/api/vendors/:key', (req, res) => {
  const key = req.params.key;
  const existing = db.prepare('SELECT * FROM vendors WHERE key = ?').get(key);
  if (!existing) return res.status(404).json({ error: 'not_found', message: `Vendor '${key}' not found` });
  const label = req.body.label != null ? req.body.label : existing.label;
  const color = req.body.color != null ? req.body.color : existing.color;
  const sortOrder = Number.isInteger(req.body.sort_order) ? req.body.sort_order : existing.sort_order;
  if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
  try {
    db.prepare('UPDATE vendors SET label = ?, color = ?, sort_order = ? WHERE key = ?').run(label, color, sortOrder, key);
    res.json(db.prepare('SELECT * FROM vendors WHERE key = ?').get(key));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.delete('/api/vendors/:key', (req, res) => {
  const key = req.params.key;
  const existing = db.prepare('SELECT * FROM vendors WHERE key = ?').get(key);
  if (!existing) return res.status(404).json({ error: 'not_found', message: `Vendor '${key}' not found` });
  const count = countAcrossBothDbs('command_vendors', 'vendor', key);
  if (count > 0) return res.status(409).json({ error: 'in_use', message: `Vendor '${key}' is used by ${count} command(s)`, count });
  try {
    db.prepare('DELETE FROM vendors WHERE key = ?').run(key); // cascades systems (and, por sua vez, versions)
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ── Sistemas ───────────────────────────────────────
// Hierarquia estrita (ver comentário em schema.sql): um Sistema pertence a
// exatamente um Vendor — `vendor` é obrigatório em toda criação/edição (não é
// mais um vínculo N:N opcional como o antigo vendor_os).
app.post('/api/systems', (req, res) => {
  const { label, color, vendor } = req.body || {};
  if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
  if (!vendor || typeof vendor !== 'string') return res.status(400).json({ error: 'validation_error', message: '"vendor" is required' });
  if (!db.prepare('SELECT 1 FROM vendors WHERE key = ?').get(vendor)) return res.status(400).json({ error: 'validation_error', message: `Vendor '${vendor}' not found` });
  const key = uniqueCatalogKey(slugifyCatalogKey(label), k => !!db.prepare('SELECT 1 FROM systems WHERE key = ?').get(k));
  try {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM systems').get().m;
    db.prepare('INSERT INTO systems (key, vendor, label, color, sort_order) VALUES (?, ?, ?, ?, ?)').run(key, vendor, label, color || '#8B949E', maxOrder + 1);
    res.status(201).json(db.prepare('SELECT * FROM systems WHERE key = ?').get(key));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.put('/api/systems/:key', (req, res) => {
  const key = req.params.key;
  const existing = db.prepare('SELECT * FROM systems WHERE key = ?').get(key);
  if (!existing) return res.status(404).json({ error: 'not_found', message: `System '${key}' not found` });
  const label = req.body.label != null ? req.body.label : existing.label;
  const color = req.body.color != null ? req.body.color : existing.color;
  const vendor = req.body.vendor != null ? req.body.vendor : existing.vendor;
  const sortOrder = Number.isInteger(req.body.sort_order) ? req.body.sort_order : existing.sort_order;
  if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
  if (!vendor || typeof vendor !== 'string') return res.status(400).json({ error: 'validation_error', message: '"vendor" is required' });
  if (!db.prepare('SELECT 1 FROM vendors WHERE key = ?').get(vendor)) return res.status(400).json({ error: 'validation_error', message: `Vendor '${vendor}' not found` });
  try {
    db.prepare('UPDATE systems SET label = ?, color = ?, vendor = ?, sort_order = ? WHERE key = ?').run(label, color, vendor, sortOrder, key);
    // Reatribuir o vendor do Sistema mantém versions.vendor em sincronia (coluna
    // denormalizada usada só para o UNIQUE(vendor, key) — ver schema.sql).
    db.prepare('UPDATE versions SET vendor = ? WHERE system = ?').run(vendor, key);
    res.json(db.prepare('SELECT * FROM systems WHERE key = ?').get(key));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.delete('/api/systems/:key', (req, res) => {
  const key = req.params.key;
  const existing = db.prepare('SELECT * FROM systems WHERE key = ?').get(key);
  if (!existing) return res.status(404).json({ error: 'not_found', message: `System '${key}' not found` });
  const count = countAcrossBothDbs('command_systems', 'system', key);
  if (count > 0) return res.status(409).json({ error: 'in_use', message: `System '${key}' is used by ${count} command(s)`, count });
  try {
    db.prepare('DELETE FROM systems WHERE key = ?').run(key); // cascades versions (system FK)
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ── Vínculos N:N Versão ↔ Ambiente / Ambiente ↔ Tópico — usados pela tela de
// administração de catálogo para curar a cascata sem duplicar cadastro. Cada
// endpoint substitui o conjunto completo de pais do item indicado. (Vendor →
// Sistema → Versão não usa mais vínculo N:N — a FK direta é gravada em
// POST/PUT /api/systems e /api/versions.) ──
app.put('/api/environments/:key/versions', (req, res) => {
  const key = req.params.key;
  if (!db.prepare('SELECT 1 FROM environments WHERE key = ?').get(key)) return res.status(404).json({ error: 'not_found', message: `Environment '${key}' not found` });
  try {
    replaceScopeLinks('version_environments', 'environment', key, 'version', req.body && req.body.versions);
    res.json({ environment: key, versions: db.prepare('SELECT version FROM version_environments WHERE environment = ?').all(key).map(r => r.version) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.put('/api/topics/:key/environments', (req, res) => {
  const key = req.params.key;
  if (!db.prepare('SELECT 1 FROM topics WHERE key = ?').get(key)) return res.status(404).json({ error: 'not_found', message: `Topic '${key}' not found` });
  try {
    replaceScopeLinks('environment_topics', 'topic', key, 'environment', req.body && req.body.environments);
    res.json({ topic: key, environments: db.prepare('SELECT environment FROM environment_topics WHERE topic = ?').all(key).map(r => r.environment) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ── Versões ──────────────────────────────────────
// `key` sozinho não é mais globalmente único (ver comentário em schema.sql) —
// a chave primária real é composta (system, key). `system` é obrigatório na
// criação; `vendor` é sempre derivado no servidor a partir do sistema
// informado (nunca aceito do cliente), o que garante o UNIQUE(vendor, key).
app.post('/api/versions', (req, res) => {
  const { label, color, system } = req.body || {};
  if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
  if (!system || typeof system !== 'string') return res.status(400).json({ error: 'validation_error', message: '"system" is required' });
  const systemRow = db.prepare('SELECT * FROM systems WHERE key = ?').get(system);
  if (!systemRow) return res.status(400).json({ error: 'validation_error', message: `System '${system}' not found` });
  // UNIQUE(vendor, key) — a checagem de unicidade precisa cobrir todo o vendor,
  // não só o system informado (ver comentário em schema.sql).
  const key = uniqueCatalogKey(slugifyCatalogKey(label), k => !!db.prepare('SELECT 1 FROM versions WHERE vendor = ? AND key = ?').get(systemRow.vendor, k));
  try {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM versions').get().m;
    db.prepare('INSERT INTO versions (system, vendor, key, label, color, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run(system, systemRow.vendor, key, label, color || '#8B949E', maxOrder + 1);
    res.status(201).json(db.prepare('SELECT * FROM versions WHERE system = ? AND key = ?').get(system, key));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.put('/api/versions/:system/:key', (req, res) => {
  const { system, key } = req.params;
  const existing = db.prepare('SELECT * FROM versions WHERE system = ? AND key = ?').get(system, key);
  if (!existing) return res.status(404).json({ error: 'not_found', message: `Version '${key}' not found under system '${system}'` });
  const label = req.body.label != null ? req.body.label : existing.label;
  const color = req.body.color != null ? req.body.color : existing.color;
  const sortOrder = Number.isInteger(req.body.sort_order) ? req.body.sort_order : existing.sort_order;
  const newSystem = req.body.system != null ? req.body.system : system;
  if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
  let newVendor = existing.vendor;
  if (newSystem !== system) {
    const systemRow = db.prepare('SELECT * FROM systems WHERE key = ?').get(newSystem);
    if (!systemRow) return res.status(400).json({ error: 'validation_error', message: `System '${newSystem}' not found` });
    newVendor = systemRow.vendor;
    if (db.prepare('SELECT 1 FROM versions WHERE system = ? AND key = ?').get(newSystem, key)) return res.status(409).json({ error: 'conflict', message: `Version '${key}' already exists under system '${newSystem}'` });
    if (db.prepare('SELECT 1 FROM versions WHERE vendor = ? AND key = ? AND system != ?').get(newVendor, key, system)) return res.status(409).json({ error: 'conflict', message: `Version '${key}' already exists under another system of vendor '${newVendor}'` });
  }
  try {
    db.prepare('UPDATE versions SET label = ?, color = ?, sort_order = ?, system = ?, vendor = ? WHERE system = ? AND key = ?')
      .run(label, color, sortOrder, newSystem, newVendor, system, key);
    res.json(db.prepare('SELECT * FROM versions WHERE system = ? AND key = ?').get(newSystem, key));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.delete('/api/versions/:system/:key', (req, res) => {
  const { system, key } = req.params;
  const existing = db.prepare('SELECT * FROM versions WHERE system = ? AND key = ?').get(system, key);
  if (!existing) return res.status(404).json({ error: 'not_found', message: `Version '${key}' not found under system '${system}'` });
  const count = countAcrossBothDbs('command_versions', 'version', key);
  if (count > 0) return res.status(409).json({ error: 'in_use', message: `Version '${key}' is used by ${count} command(s)`, count });
  try {
    db.prepare('DELETE FROM versions WHERE system = ? AND key = ?').run(system, key);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ── Ambientes ────────────────────────────────────
app.post('/api/environments', (req, res) => {
  const { label, color } = req.body || {};
  if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
  const key = uniqueCatalogKey(slugifyCatalogKey(label), k => !!db.prepare('SELECT 1 FROM environments WHERE key = ?').get(k));
  try {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM environments').get().m;
    db.prepare('INSERT INTO environments (key, label, color, sort_order) VALUES (?, ?, ?, ?)').run(key, label, color || '#8B949E', maxOrder + 1);
    res.status(201).json(db.prepare('SELECT * FROM environments WHERE key = ?').get(key));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.put('/api/environments/:key', (req, res) => {
  const key = req.params.key;
  const existing = db.prepare('SELECT * FROM environments WHERE key = ?').get(key);
  if (!existing) return res.status(404).json({ error: 'not_found', message: `Environment '${key}' not found` });
  const label = req.body.label != null ? req.body.label : existing.label;
  const color = req.body.color != null ? req.body.color : existing.color;
  const sortOrder = Number.isInteger(req.body.sort_order) ? req.body.sort_order : existing.sort_order;
  if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
  try {
    db.prepare('UPDATE environments SET label = ?, color = ?, sort_order = ? WHERE key = ?').run(label, color, sortOrder, key);
    res.json(db.prepare('SELECT * FROM environments WHERE key = ?').get(key));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.delete('/api/environments/:key', (req, res) => {
  const key = req.params.key;
  const existing = db.prepare('SELECT * FROM environments WHERE key = ?').get(key);
  if (!existing) return res.status(404).json({ error: 'not_found', message: `Environment '${key}' not found` });
  const count = countAcrossBothDbs('command_environments', 'environment', key);
  if (count > 0) return res.status(409).json({ error: 'in_use', message: `Environment '${key}' is used by ${count} command(s)`, count });
  try {
    db.prepare('DELETE FROM environments WHERE key = ?').run(key);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ── Tópicos ──────────────────────────────────────
// Mesmos campos de Environments (label/color) — sem section_title (removido,
// ver comentário em schema.sql). Única diferença real é is_protected.
app.post('/api/topics', (req, res) => {
  const { label, color } = req.body || {};
  if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
  const key = uniqueCatalogKey(slugifyCatalogKey(label), k => !!db.prepare('SELECT 1 FROM topics WHERE key = ?').get(k));
  try {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM topics WHERE is_protected = 0').get().m;
    db.prepare(
      `INSERT INTO topics (key, label, color, sort_order, is_protected)
       VALUES (?, ?, ?, ?, 0)`
    ).run(key, label, color || '#8B949E', maxOrder + 1);
    res.status(201).json(db.prepare('SELECT * FROM topics WHERE key = ?').get(key));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.put('/api/topics/:key', (req, res) => {
  const key = req.params.key;
  const existing = db.prepare('SELECT * FROM topics WHERE key = ?').get(key);
  if (!existing) return res.status(404).json({ error: 'not_found', message: `Topic '${key}' not found` });
  const label = req.body.label != null ? req.body.label : existing.label;
  const color = req.body.color != null ? req.body.color : existing.color;
  const sortOrder = Number.isInteger(req.body.sort_order) ? req.body.sort_order : existing.sort_order;
  if (!label || typeof label !== 'string') return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
  // is_protected nunca é alterável por esta API (só o seed inicial define 'environment' como protegido).
  try {
    db.prepare(
      'UPDATE topics SET label = ?, color = ?, sort_order = ? WHERE key = ?'
    ).run(label, color, sortOrder, key);
    res.json(db.prepare('SELECT * FROM topics WHERE key = ?').get(key));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.delete('/api/topics/:key', (req, res) => {
  const key = req.params.key;
  const existing = db.prepare('SELECT * FROM topics WHERE key = ?').get(key);
  if (!existing) return res.status(404).json({ error: 'not_found', message: `Topic '${key}' not found` });
  if (existing.is_protected) return res.status(409).json({ error: 'protected', message: `Topic '${key}' is a protected system topic and cannot be deleted` });
  const count = countAcrossBothDbs('command_topics', 'topic', key);
  if (count > 0) return res.status(409).json({ error: 'in_use', message: `Topic '${key}' is used by ${count} command(s)`, count });
  try {
    db.prepare('DELETE FROM topics WHERE key = ?').run(key);
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
function countParameterTemplateUsage(key) {
  const needle = `{{${key}}}`;
  const usedBy = new Set();
  db.prepare('SELECT id, raw_template FROM commands').all().forEach(r => {
    if (r.raw_template && r.raw_template.includes(needle)) usedBy.add(r.id);
  });
  db.prepare('SELECT command_id, content FROM command_lines').all().forEach(r => {
    if (r.content && r.content.includes(needle)) usedBy.add(r.command_id);
  });
  db.prepare(
    `SELECT cd.command_id AS command_id, cdl.content AS content
     FROM command_diff_lines cdl JOIN command_diffs cd ON cd.id = cdl.diff_id`
  ).all().forEach(r => {
    if (r.content && r.content.includes(needle)) usedBy.add(r.command_id);
  });
  return usedBy.size;
}
// 'src_ip'/'dst_ip' e 'ip'/'port' são lidos DIRETO (não via {{token}}) pela
// lógica de estado vazio do card (requires_ips/requires_ip_port em commands,
// hasIPs/hasIpPort em render.js e db-render-engine.js) — excluí-los quebraria
// essa lógica para todo comando marcado com a respectiva flag, mesmo que
// nenhum {{src_ip}}/{{ip}} literal apareça no texto. Por isso o bloqueio aqui
// é independente da busca textual acima.
function parameterStructuralDependencyCount(key) {
  if (key === 'src_ip' || key === 'dst_ip') {
    return db.prepare('SELECT COUNT(*) AS n FROM commands WHERE requires_ips = 1').get().n;
  }
  if (key === 'ip' || key === 'port') {
    return db.prepare('SELECT COUNT(*) AS n FROM commands WHERE requires_ip_port = 1').get().n;
  }
  return 0;
}

app.post('/api/parameters', (req, res) => {
  const { key, label, sort_order } = req.body || {};
  if (!key || !CATALOG_KEY_RE.test(key)) return res.status(400).json({ error: 'validation_error', message: '"key" is required (letters, numbers, dot, underscore, hyphen only)' });
  if (!label) return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
  if (db.prepare('SELECT 1 FROM parameters WHERE key = ?').get(key)) return res.status(409).json({ error: 'conflict', message: `Parameter '${key}' already exists` });
  try {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM parameters').get().m;
    const order = Number.isInteger(sort_order) ? sort_order : maxOrder + 1;
    db.prepare('INSERT INTO parameters (key, label, sort_order) VALUES (?, ?, ?)').run(key, label, order);
    res.status(201).json(db.prepare('SELECT * FROM parameters WHERE key = ?').get(key));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.put('/api/parameters/:key', (req, res) => {
  const key = req.params.key;
  const existing = db.prepare('SELECT * FROM parameters WHERE key = ?').get(key);
  if (!existing) return res.status(404).json({ error: 'not_found', message: `Parameter '${key}' not found` });
  const label = req.body.label != null ? req.body.label : existing.label;
  const sortOrder = Number.isInteger(req.body.sort_order) ? req.body.sort_order : existing.sort_order;
  if (!label) return res.status(400).json({ error: 'validation_error', message: '"label" is required' });
  // `key` nunca é alterável por esta API (ver comentário em schema.sql).
  try {
    db.prepare('UPDATE parameters SET label = ?, sort_order = ? WHERE key = ?').run(label, sortOrder, key);
    res.json(db.prepare('SELECT * FROM parameters WHERE key = ?').get(key));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});
app.delete('/api/parameters/:key', (req, res) => {
  const key = req.params.key;
  const existing = db.prepare('SELECT * FROM parameters WHERE key = ?').get(key);
  if (!existing) return res.status(404).json({ error: 'not_found', message: `Parameter '${key}' not found` });
  const structCount = parameterStructuralDependencyCount(key);
  if (structCount > 0) {
    return res.status(409).json({
      error: 'structural_dependency',
      message: `Parameter '${key}' is read directly by ${structCount} command(s)' empty-state logic (requires_ips/requires_ip_port) and cannot be deleted`,
      count: structCount,
    });
  }
  const usage = countParameterTemplateUsage(key);
  if (usage > 0) return res.status(409).json({ error: 'in_use', message: `Parameter '${key}' is used by ${usage} command(s)`, count: usage });
  try {
    db.prepare('DELETE FROM parameters WHERE key = ?').run(key);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// Backup e restauração do banco de dados (menu Configurações → "Backup &
// Restore" — ver js/backup.js). Os arquivos ficam numa pasta "backup" ao
// lado do commands.db (server/backup/ por padrão; ou {DB_PATH}/../backup no
// Docker, já dentro do volume persistente cg-toolbox-data — sobrevive a
// rebuild/restart). Cada arquivo é uma cópia .db completa e consistente,
// gerada com Database#backup() do better-sqlite3 (backup "a quente", sem
// precisar parar o servidor).
//
// O agendamento (diário/semanal/mensal + horário) é guardado nas MESMAS
// chaves de /api/global-settings (tabela user_data, username sentinela
// GLOBAL_SETTINGS_USER) — reaproveita a infra já existente em vez de criar
// tabela/arquivo novo. Isso também significa que restaurar um backup antigo
// pode trazer de volta uma configuração de agendamento antiga — aceitável,
// pois é parte do mesmo "estado do sistema" sendo restaurado.
// ════════════════════════════════════════════════
const BACKUP_DIR = path.join(path.dirname(DB_PATH), 'backup');

function pad2(n) { return String(n).padStart(2, '0'); }

function backupTimestamp(d = new Date()) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

async function performBackup(prefix = 'backup') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const filename = `${prefix}-${backupTimestamp()}.db`;
  await db.backup(path.join(BACKUP_DIR, filename));
  return filename;
}

function listBackupFiles() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.db'))
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

function readGlobalSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM user_data WHERE username = ? AND data_key = ?').get(GLOBAL_SETTINGS_USER, key);
  return row ? row.value : fallback;
}

function writeGlobalSetting(key, value) {
  db.prepare(`
    INSERT INTO user_data (username, data_key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(username, data_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(GLOBAL_SETTINGS_USER, key, String(value));
}

app.get('/api/backups', (req, res) => {
  try {
    res.json(listBackupFiles());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

app.post('/api/backups', async (req, res) => {
  try {
    const filename = await performBackup('backup');
    res.status(201).json({ filename });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

app.get('/api/backups/:filename/download', (req, res) => {
  const full = resolveBackupPath(req.params.filename);
  if (!full) return res.status(404).json({ error: 'not_found' });
  res.download(full, req.params.filename);
});

app.delete('/api/backups/:filename', (req, res) => {
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
// Depois de trocar o arquivo, o processo encerra de propósito — o systemd
// (ou o "restart: unless-stopped" do Docker) sobe o serviço de novo sozinho,
// já lendo o arquivo restaurado (evita ter que "hot-swap" a conexão
// better-sqlite3 em uso pelo resto deste arquivo).
app.post('/api/backups/:filename/restore', async (req, res) => {
  const full = resolveBackupPath(req.params.filename);
  if (!full) return res.status(404).json({ error: 'not_found' });
  try {
    await performBackup('pre-restore');
    db.close();
    fs.copyFileSync(full, DB_PATH);
    res.json({ ok: true, message: 'Restore concluído. O serviço vai reiniciar em instantes — recarregue a página em alguns segundos.' });
    setTimeout(() => process.exit(0), 400);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

app.get('/api/backup-schedule', (req, res) => {
  try {
    res.json({
      enabled: readGlobalSetting('backupScheduleEnabled', '0') === '1',
      frequency: readGlobalSetting('backupScheduleFrequency', 'daily'),
      weeklyDays: (readGlobalSetting('backupScheduleWeeklyDays', '') || '').split(',').map(s => s.trim()).filter(Boolean).map(Number),
      monthlyDay: parseInt(readGlobalSetting('backupScheduleMonthlyDay', '1'), 10) || 1,
      time: readGlobalSetting('backupScheduleTime', '02:00'),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

app.put('/api/backup-schedule', (req, res) => {
  try {
    const body = req.body || {};
    const frequency = ['daily', 'weekly', 'monthly'].includes(body.frequency) ? body.frequency : 'daily';
    const weeklyDays = Array.isArray(body.weeklyDays) ? body.weeklyDays.map(Number).filter(n => n >= 0 && n <= 6) : [];
    const monthlyDay = Math.min(31, Math.max(1, parseInt(body.monthlyDay, 10) || 1));
    const time = /^\d{2}:\d{2}$/.test(body.time) ? body.time : '02:00';
    writeGlobalSetting('backupScheduleEnabled', body.enabled ? '1' : '0');
    writeGlobalSetting('backupScheduleFrequency', frequency);
    writeGlobalSetting('backupScheduleWeeklyDays', weeklyDays.join(','));
    writeGlobalSetting('backupScheduleMonthlyDay', String(monthlyDay));
    writeGlobalSetting('backupScheduleTime', time);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ════════════════════════════════════════════════
// UPDATE CHECK / APPLY — só repassam pro serviço companion "updater" (ver
// UPDATER_URL acima e updater/server.js). Este processo nunca roda git nem
// docker diretamente. Timeout curto no check (é só git fetch+rev-parse);
// timeout maior não faz sentido no apply porque a resposta do updater
// chega antes do rebuild terminar (ver updater/server.js — responde 202 e
// continua em background), então aqui só repassamos essa resposta rápida.
// ════════════════════════════════════════════════
async function callUpdater(path, options) {
  if (!UPDATER_URL) {
    const err = new Error('not_configured');
    err.notConfigured = true;
    throw err;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${UPDATER_URL}${path}`, {
      ...options,
      headers: { ...(options && options.headers), 'X-Updater-Token': UPDATER_TOKEN },
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || `updater responded ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

app.get('/api/system/update-check', async (req, res) => {
  try {
    const data = await callUpdater('/status', { method: 'GET' });
    res.json(data);
  } catch (err) {
    if (err.notConfigured) return res.status(501).json({ error: 'not_configured', message: 'Update checking isn\'t available in this installation.' });
    console.error('update-check failed:', err);
    res.status(502).json({ error: 'updater_unreachable', message: 'Could not reach the updater service. Check that it is running (docker compose ps).' });
  }
});

app.post('/api/system/update-apply', async (req, res) => {
  try {
    const data = await callUpdater('/apply', { method: 'POST' });
    res.status(202).json(data);
  } catch (err) {
    if (err.notConfigured) return res.status(501).json({ error: 'not_configured', message: 'Updating isn\'t available in this installation.' });
    console.error('update-apply failed:', err);
    res.status(502).json({ error: 'updater_unreachable', message: 'Could not reach the updater service. Check that it is running (docker compose ps).' });
  }
});

// Checagem a cada minuto — dispara o backup automático quando o horário
// configurado bate com o horário atual, respeitando a frequência (diário
// sempre; semanal só nos dias da semana marcados — 0=domingo..6=sábado;
// mensal só no dia do mês configurado, com ajuste para meses mais curtos,
// ex.: dia 31 configurado roda no último dia de fevereiro/abril/etc.).
// backupScheduleLastRunDate evita rodar mais de uma vez no mesmo dia.
function checkScheduledBackup() {
  try {
    if (readGlobalSetting('backupScheduleEnabled', '0') !== '1') return;
    const time = readGlobalSetting('backupScheduleTime', '02:00');
    const now = new Date();
    if (`${pad2(now.getHours())}:${pad2(now.getMinutes())}` !== time) return;

    const todayKey = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    if (readGlobalSetting('backupScheduleLastRunDate', '') === todayKey) return;

    const frequency = readGlobalSetting('backupScheduleFrequency', 'daily');
    if (frequency === 'weekly') {
      const days = (readGlobalSetting('backupScheduleWeeklyDays', '') || '').split(',').map(s => s.trim()).filter(Boolean).map(Number);
      if (!days.includes(now.getDay())) return;
    } else if (frequency === 'monthly') {
      const configuredDay = parseInt(readGlobalSetting('backupScheduleMonthlyDay', '1'), 10) || 1;
      const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      if (now.getDate() !== Math.min(configuredDay, lastDayOfMonth)) return;
    }

    performBackup('scheduled')
      .then(filename => {
        writeGlobalSetting('backupScheduleLastRunDate', todayKey);
        console.log(`[backup] Backup agendado criado: ${filename}`);
      })
      .catch(err => console.error('[backup] Falha ao criar backup agendado:', err));
  } catch (err) {
    console.error('[backup] Erro ao checar agendamento de backup:', err);
  }
}
setInterval(checkScheduledBackup, 60 * 1000);
checkScheduledBackup();

// Loga e derruba SÓ esse listener em caso de erro de bind (porta ocupada,
// ou sem permissão — ex.: tentar abrir a porta 443 dentro de um container
// Docker rodando como usuário não-root, onde portas <1024 exigem root/
// CAP_NET_BIND_SERVICE). Sem isso, um erro de 'listen' não tratado derruba
// o processo inteiro (Node relança como excessão não capturada), tirando
// do ar até a porta que tinha dado bind certo.
function onListenError(port, label) {
  return err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Erro: a porta ${port} já está em uso por outro processo — ${label} não vai subir nesta porta.`);
    } else if (err.code === 'EACCES') {
      console.error(`Erro: sem permissão para abrir a porta ${port} (${label}). Portas < 1024 exigem root/CAP_NET_BIND_SERVICE — ` +
        `em Docker, prefira mapear a porta do host para uma porta alta no container (ver docker-compose.yml) em vez de usar HTTP_PORT/HTTPS_PORT < 1024 diretamente.`);
    } else {
      console.error(`Erro ao abrir a porta ${port} (${label}):`, err);
    }
  };
}

function startPlainHttp(port, extraLabel) {
  http.createServer(app)
    .on('error', onListenError(port, 'HTTP'))
    .listen(port, () => {
      console.log(`CG Toolbox server listening on port ${port} (HTTP)${extraLabel ? ' ' + extraLabel : ''}`);
    });
}

// Porta HTTP — sempre ativa.
startPlainHttp(HTTP_PORT);

// Porta HTTPS — ativa em paralelo, só se for diferente da porta HTTP acima
// (evita tentar abrir a mesma porta duas vezes).
if (Number(HTTPS_PORT) !== Number(HTTP_PORT)) {
  const certConfigurado = Boolean(TLS_CERT_PATH && TLS_KEY_PATH);
  const certValido = certConfigurado && fs.existsSync(TLS_CERT_PATH) && fs.existsSync(TLS_KEY_PATH);

  if (certValido) {
    const credentials = {
      cert: fs.readFileSync(TLS_CERT_PATH, 'utf8'),
      key: fs.readFileSync(TLS_KEY_PATH, 'utf8'),
    };
    https.createServer(credentials, app)
      .on('error', onListenError(HTTPS_PORT, 'HTTPS'))
      .listen(HTTPS_PORT, () => {
        console.log(`CG Toolbox server listening on port ${HTTPS_PORT} (HTTPS)`);
      });
  } else {
    if (certConfigurado) {
      console.warn(`Aviso: TLS_CERT_PATH/TLS_KEY_PATH configurados, mas o(s) arquivo(s) não foi(ram) encontrado(s) (cert: ${TLS_CERT_PATH}, key: ${TLS_KEY_PATH}) — porta ${HTTPS_PORT} vai subir em HTTP puro (sem cadeado) até isso ser corrigido.`);
    } else {
      console.warn(`Aviso: nenhum certificado configurado (TLS_CERT_PATH/TLS_KEY_PATH) — porta ${HTTPS_PORT} está respondendo em HTTP puro, não HTTPS. Configure um certificado (--tls-cert/--tls-key no install-cgtoolbox.sh) para habilitar HTTPS de verdade nesta porta.`);
    }
    startPlainHttp(HTTPS_PORT, '— sem TLS, configure um certificado quando disponível');
  }
}
