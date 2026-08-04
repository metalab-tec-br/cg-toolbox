// ════════════════════════════════════════════════
// CG Toolbox — UPDATER (serviço companion, container separado)
//
// Por quê este serviço existe separado do app principal: o container
// "cg-toolbox" roda non-root e propositalmente sem git/docker CLI (ver
// Dockerfile na raiz) — enxuto e sem acesso ao Docker do host. Mas o botão
// "Check for updates"/"Update now" (Configurações → System) precisa rodar
// `git pull` + `docker compose up -d --build`, o que exige acesso ao socket
// do Docker do host. Em vez de dar esse acesso ao container da aplicação
// (que fica exposto na rede/porta 80 e processa uploads/CSV de usuários —
// superfície de ataque real), isolamos esse acesso aqui: um container
// dedicado, SEM porta publicada pro host (só alcançável pela rede interna
// do docker compose, pelo serviço cg-toolbox), que só sabe fazer duas
// coisas fixas — checar e aplicar update. Não existe injeção de comando
// possível a partir da requisição HTTP: os dois endpoints não recebem
// nenhum parâmetro do chamador, só disparam os comandos fixos abaixo.
//
// Mesmo assim, se o container cg-toolbox for comprometido, um invasor
// conseguiria disparar um rebuild a partir do HEAD atual do repositório
// remoto (git pull) — não é zero risco, mas é MUITO menor do que dar ao
// container público acesso irrestrito ao docker.sock do host. Um token
// compartilhado (UPDATER_TOKEN) reduz ainda mais isso: só quem conhece o
// token (só o cg-toolbox, via variável de ambiente) consegue chamar.
// ════════════════════════════════════════════════

const http = require('http');
const { execFile } = require('child_process');

const REPO_DIR = process.env.REPO_DIR || '/repo';
const TOKEN = process.env.UPDATER_TOKEN || '';
const PORT = process.env.UPDATER_PORT || 8080;

function run(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: REPO_DIR, timeout: 15 * 60 * 1000, maxBuffer: 10 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; return reject(err); }
      resolve({ stdout, stderr });
    });
  });
}

async function getStatus() {
  // git fetch primeiro, pra comparar contra o que há de mais novo no
  // remoto (sem isso, origin/main só refletiria o último fetch já feito).
  await run('git', ['fetch', '--quiet', 'origin']);
  const { stdout: currentOut } = await run('git', ['rev-parse', 'HEAD']);
  const { stdout: remoteOut } = await run('git', ['rev-parse', 'origin/main']);
  const current = currentOut.trim();
  const remote = remoteOut.trim();
  const updateAvailable = current !== remote;
  let log = [];
  if (updateAvailable) {
    const { stdout: logOut } = await run('git', ['log', '--oneline', `${current}..${remote}`, '-20']);
    log = logOut.split('\n').map(s => s.trim()).filter(Boolean);
  }
  return { current, remote, updateAvailable, log };
}

async function applyUpdate() {
  await run('git', ['pull', '--ff-only', 'origin', 'main']);
  // "--build" reconstrói só a imagem cg-toolbox (Dockerfile na raiz do
  // repo) — o serviço updater não é rebuildado por si mesmo aqui (evita o
  // container se derrubar no meio da própria execução); se o Dockerfile de
  // updater/ mudar, rode "docker compose up -d --build updater" manualmente
  // uma vez, depois os próximos updates via botão já cobrem os dois.
  await run('docker', ['compose', 'up', '-d', '--build', 'cg-toolbox']);
}

function send(res, code, body) {
  const json = JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function checkAuth(req) {
  if (!TOKEN) return true; // sem token configurado = sem checagem (rede já é interna/sem porta publicada)
  return req.headers['x-updater-token'] === TOKEN;
}

const server = http.createServer(async (req, res) => {
  if (!checkAuth(req)) return send(res, 401, { error: 'unauthorized' });

  if (req.method === 'GET' && req.url === '/status') {
    try {
      const status = await getStatus();
      return send(res, 200, status);
    } catch (err) {
      console.error('update-check failed:', err);
      return send(res, 500, { error: 'update_check_failed', message: (err && err.stderr) || (err && err.message) || 'unknown error' });
    }
  }

  if (req.method === 'POST' && req.url === '/apply') {
    // Responde imediatamente e roda em background — o "docker compose up
    // --build cg-toolbox" recria o container que respondeu à requisição
    // original (a página que chamou isso é servida pelo cg-toolbox, que vai
    // reiniciar no meio do processo), então esperar a resposta terminar
    // deixaria o chamador pendurado. O frontend faz polling depois disso
    // pra saber quando o app voltou (ver js/system-update.js).
    send(res, 202, { started: true });
    try {
      await applyUpdate();
      console.log('Update applied successfully.');
    } catch (err) {
      console.error('Update apply failed:', err);
    }
    return;
  }

  send(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => console.log(`updater listening on :${PORT} (repo: ${REPO_DIR})`));
