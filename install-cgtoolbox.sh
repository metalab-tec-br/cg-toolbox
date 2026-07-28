#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════
# CG Toolbox — automated Linux installer / updater
#
# Sets up (or updates) CG Toolbox as a systemd service on this machine:
#   - installs Node.js 20 LTS if missing (NodeSource repo)
#   - installs build tools needed to compile the native SQLite driver
#   - runs a CLEAN "npm install" in server/ (never reuses a copied
#     node_modules — better-sqlite3 ships a compiled binary that is
#     specific to this machine's OS/architecture)
#   - creates a dedicated, unprivileged system user to run the service
#   - registers + starts a systemd unit (auto-restart, survives reboot)
#   - opens the app's ports in ufw/firewalld, if either is active
#
# By default the app listens on BOTH port 80 and port 443 at the same time
# (no redirect between them — each serves the app directly). Port 443 uses
# real HTTPS if --tls-cert/--tls-key point to a valid certificate/key;
# otherwise it serves plain HTTP too (with a warning in the logs) so the
# app is never unreachable while waiting for a certificate.
#
# Usage:
#   sudo ./install-cgtoolbox.sh                     # install/update — ports 80 (HTTP) + 443 (HTTP until a cert is set)
#   sudo ./install-cgtoolbox.sh --http-port 8080 --https-port 8443
#   sudo ./install-cgtoolbox.sh --user cgtoolbox
#   sudo ./install-cgtoolbox.sh --ntlm-disabled      # dev/test box, not on a Windows domain
#   sudo ./install-cgtoolbox.sh --skip-node-install  # Node already installed the way you want it
#   sudo ./install-cgtoolbox.sh --tls-cert /etc/cg-toolbox/tls/cert.pem --tls-key /etc/cg-toolbox/tls/key.pem
#                                                 # turns on real HTTPS on --https-port (self-signed or CA-issued cert/key already on disk)
#   sudo ./install-cgtoolbox.sh --uninstall          # stop + remove the service (keeps the files/DB)
#
# Safe to re-run: re-running with the app already installed treats this as
# an UPDATE (stops the service, reinstalls dependencies, restarts) instead
# of failing. server/commands.db is never touched by this script.
# ════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── defaults (override via flags below) ────────────────────────────────
HTTP_PORT=80
HTTPS_PORT=443
SERVICE_NAME="cg-toolbox"
SERVICE_USER="cgtoolbox"
NTLM_DISABLED=0
SKIP_NODE_INSTALL=0
UNINSTALL=0
NODE_MAJOR=20
TLS_CERT=""
TLS_KEY=""

# ── colors (fall back to plain text if not a terminal) ─────────────────
if [ -t 1 ]; then
  C_INFO='\033[1;34m'; C_OK='\033[1;32m'; C_WARN='\033[1;33m'; C_ERR='\033[1;31m'; C_RESET='\033[0m'
else
  C_INFO=''; C_OK=''; C_WARN=''; C_ERR=''; C_RESET=''
fi
info()  { echo -e "${C_INFO}==>${C_RESET} $*"; }
ok()    { echo -e "${C_OK}OK${C_RESET}  $*"; }
warn()  { echo -e "${C_WARN}!!${C_RESET}  $*"; }
err()   { echo -e "${C_ERR}ERRO${C_RESET} $*" >&2; }

# ── parse flags ─────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --http-port) HTTP_PORT="$2"; shift 2 ;;
    --https-port) HTTPS_PORT="$2"; shift 2 ;;
    --port) warn "--port está obsoleto (agora o app sobe em duas portas ao mesmo tempo) — tratando como --http-port. Use --http-port/--https-port."; HTTP_PORT="$2"; shift 2 ;;
    --user) SERVICE_USER="$2"; shift 2 ;;
    --ntlm-disabled) NTLM_DISABLED=1; shift ;;
    --skip-node-install) SKIP_NODE_INSTALL=1; shift ;;
    --tls-cert) TLS_CERT="$2"; shift 2 ;;
    --tls-key) TLS_KEY="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help)
      sed -n '2,29p' "$0"; exit 0 ;;
    *) err "Opção desconhecida: $1"; exit 1 ;;
  esac
done

# ── must run as root (systemd, useradd, apt, firewall) ─────────────────
if [ "$(id -u)" -ne 0 ]; then
  err "Rode este script com sudo: sudo $0 $*"
  exit 1
fi

# ── validação de --tls-cert / --tls-key: ou os dois, ou nenhum ─────────
if [ -n "$TLS_CERT" ] || [ -n "$TLS_KEY" ]; then
  if [ -z "$TLS_CERT" ] || [ -z "$TLS_KEY" ]; then
    err "--tls-cert e --tls-key precisam ser usados juntos (você passou só um dos dois)."
    exit 1
  fi
  if [ ! -f "$TLS_CERT" ]; then
    err "Certificado não encontrado: $TLS_CERT"
    exit 1
  fi
  if [ ! -f "$TLS_KEY" ]; then
    err "Chave privada não encontrada: $TLS_KEY"
    exit 1
  fi
fi

# ── resolve app dir: assume this script lives at the project root
#    (same folder as index.html / server/) ─────────────────────────────
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$APP_DIR/server"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

if [ ! -f "$SERVER_DIR/index.js" ]; then
  err "Não encontrei $SERVER_DIR/index.js — rode este script de dentro da pasta do projeto (onde ficam index.html e server/)."
  exit 1
fi

# ════════════════════════════════════════════════════════════════════
# --uninstall: stop + remove the service, leave files/DB untouched
# ════════════════════════════════════════════════════════════════════
if [ "$UNINSTALL" -eq 1 ]; then
  info "Removendo o serviço ${SERVICE_NAME}..."
  systemctl stop "${SERVICE_NAME}" 2>/dev/null || true
  systemctl disable "${SERVICE_NAME}" 2>/dev/null || true
  rm -f "$UNIT_PATH"
  systemctl daemon-reload
  ok "Serviço removido. Os arquivos do projeto e o banco de dados (server/commands.db) NÃO foram apagados."
  exit 0
fi

# ════════════════════════════════════════════════════════════════════
# 1) Node.js
# ════════════════════════════════════════════════════════════════════
node_ok=0
if command -v node >/dev/null 2>&1; then
  cur_major="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [ "$cur_major" -ge 18 ]; then
    node_ok=1
    ok "Node.js já instalado: $(node -v)"
  else
    warn "Node.js $(node -v) encontrado, mas é muito antigo (precisa de 18+)."
  fi
fi

if [ "$node_ok" -eq 0 ]; then
  if [ "$SKIP_NODE_INSTALL" -eq 1 ]; then
    err "Node.js 18+ não encontrado e --skip-node-install foi usado. Instale o Node manualmente e rode de novo."
    exit 1
  fi
  info "Instalando Node.js ${NODE_MAJOR}.x (NodeSource)..."
  # Se outro repositório apt da máquina estiver com problema (ex.: chave GPG
  # não confiável de um repo do Docker já configurado), o próprio script da
  # NodeSource pode reportar erro e não conseguir registrar o repositório —
  # sem abortar o "curl | bash" (ele mesmo segue retornando 0). Nesse caso o
  # 'apt-get install -y nodejs' abaixo cai silenciosamente no pacote nodejs
  # da distro em vez do da NodeSource — mais antigo e, no caso do
  # Ubuntu/Debian, sem o npm embutido (ver checagem de npm logo abaixo).
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - || warn "Script da NodeSource retornou erro — seguindo com o nodejs disponível nos repositórios já configurados."
  apt-get install -y nodejs
  ok "Node.js instalado: $(node -v)"
fi

# O pacote "nodejs" do Ubuntu/Debian (repositório da própria distro, não da
# NodeSource) vem SEM o npm — só acontece quando o passo acima não conseguiu
# usar o repositório da NodeSource (ver comentário logo acima). Sempre
# verificamos e instalamos separadamente se faltar, independente do caminho
# que o Node tomou para chegar aqui.
if ! command -v npm >/dev/null 2>&1; then
  warn "npm não encontrado (comum quando o 'nodejs' vem do repositório da própria distro) — instalando separadamente..."
  apt-get install -y npm
  if ! command -v npm >/dev/null 2>&1; then
    err "Não foi possível instalar o npm. Verifique o apt manualmente (ex.: repositórios com chave GPG inválida) e rode este script de novo."
    exit 1
  fi
  ok "npm instalado: $(npm -v)"
fi

# Ferramentas de build — necessárias caso o better-sqlite3 não encontre um
# binário pré-compilado para esta distro/arquitetura e precise compilar na
# hora (ver README do projeto).
info "Garantindo build-essential/python3 (necessário para compilar dependências nativas, se preciso)..."
apt-get install -y build-essential python3 >/dev/null

# ════════════════════════════════════════════════════════════════════
# 2) Usuário de serviço dedicado (sem login, sem home) ──────────────────
# ════════════════════════════════════════════════════════════════════
if id "$SERVICE_USER" >/dev/null 2>&1; then
  ok "Usuário de serviço '$SERVICE_USER' já existe."
else
  info "Criando usuário de serviço '$SERVICE_USER' (sem login)..."
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  ok "Usuário '$SERVICE_USER' criado."
fi

# ════════════════════════════════════════════════════════════════════
# 3) Parar o serviço antes de mexer nos arquivos (caso já exista — modo
#    "atualização") ───────────────────────────────────────────────────
# ════════════════════════════════════════════════════════════════════
if systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1 && systemctl is-active --quiet "${SERVICE_NAME}"; then
  info "Serviço já rodando — parando para atualizar..."
  systemctl stop "${SERVICE_NAME}"
fi

# ════════════════════════════════════════════════════════════════════
# 4) npm install limpo — NUNCA reaproveita um node_modules copiado de
#    outra máquina/SO (o binário do better-sqlite3 é específico da
#    plataforma onde foi instalado). ─────────────────────────────────
# ════════════════════════════════════════════════════════════════════
info "Instalando dependências (server/npm install)..."
rm -rf "$SERVER_DIR/node_modules"
( cd "$SERVER_DIR" && npm install --omit=dev )
ok "Dependências instaladas."

# Dono dos arquivos: o usuário de serviço precisa poder ler o projeto e
# escrever em server/commands.db (banco de dados, criado/atualizado em
# tempo de execução).
chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

# ════════════════════════════════════════════════════════════════════
# 4.5) Confere se o usuário de serviço consegue ATRAVESSAR até o diretório
#      do servidor. O chown acima só alcança $APP_DIR pra baixo — se o
#      projeto foi clonado dentro do home de outro usuário (ex.:
#      /home/fulano/projeto), o próprio /home/fulano costuma ser 750 e
#      bloqueia qualquer usuário fora do dono, mesmo com $APP_DIR certo.
#      Sem essa checagem, o serviço fica reiniciando em loop (systemd
#      status=200/CHDIR) até o restart-limit do systemd desistir, sem
#      nenhuma pista clara do motivo. ─────────────────────────────────
# ════════════════════════════════════════════════════════════════════
blocking_dir=""
d="$SERVER_DIR"
while [ "$d" != "/" ] && [ -n "$d" ]; do
  if ! sudo -u "$SERVICE_USER" test -x "$d" 2>/dev/null; then
    blocking_dir="$d"
  fi
  d="$(dirname "$d")"
done
if [ -n "$blocking_dir" ]; then
  err "O usuário de serviço '$SERVICE_USER' não consegue atravessar '$blocking_dir' (falta permissão de trânsito/+x para 'outros')."
  warn "Isso é comum quando o projeto foi clonado dentro do home de outro usuário (ex.: /home/usuario/...), que normalmente bloqueia outros usuários por padrão."
  warn "Corrija com:  sudo chmod o+x '$blocking_dir'   (libera só a passagem, não lista o conteúdo)"
  warn "Ou, mais correto para produção: mova o projeto para fora de qualquer home, ex. /opt/cg-toolbox, e rode este script de lá."
  exit 1
fi

# ════════════════════════════════════════════════════════════════════
# 4.6) Confere se o usuário de serviço consegue LER o certificado/chave TLS,
#      quando informados — evita descobrir isso só depois pelo journalctl
#      (EACCES), já que é comum gerar o certificado com sudo/root e esquecer
#      de ajustar o dono. ─────────────────────────────────────────────────
# ════════════════════════════════════════════════════════════════════
if [ -n "$TLS_CERT" ] && [ -n "$TLS_KEY" ]; then
  if ! sudo -u "$SERVICE_USER" test -r "$TLS_CERT"; then
    err "O usuário de serviço '$SERVICE_USER' não consegue LER o certificado: $TLS_CERT"
    warn "Corrija com:  sudo chown ${SERVICE_USER}:${SERVICE_USER} '$TLS_CERT'"
    exit 1
  fi
  if ! sudo -u "$SERVICE_USER" test -r "$TLS_KEY"; then
    err "O usuário de serviço '$SERVICE_USER' não consegue LER a chave privada: $TLS_KEY"
    warn "Corrija com:  sudo chown ${SERVICE_USER}:${SERVICE_USER} '$TLS_KEY'"
    exit 1
  fi
fi

# ════════════════════════════════════════════════════════════════════
# 5) Unit systemd ────────────────────────────────────────────────────
# ════════════════════════════════════════════════════════════════════
NODE_BIN="$(command -v node)"

# Pré-computa a linha opcional de NTLM_DISABLED (evita usar uma
# substituição de comando com teste condicional falível dentro do
# heredoc abaixo — mais simples e mais previsível sob 'set -e').
NTLM_ENV_LINE=""
if [ "$NTLM_DISABLED" -eq 1 ]; then
  NTLM_ENV_LINE="Environment=NTLM_DISABLED=1"
fi

# Portas < 1024 (ex.: 443, 80 — os padrões deste script) são "privilegiadas"
# no Linux — um processo rodando como usuário sem privilégio (nosso
# $SERVICE_USER) não consegue abri-las sozinho, e por design não rodamos o
# Node como root. Em vez disso, concedemos só a capability específica de
# abrir portas baixas (CAP_NET_BIND_SERVICE) diretamente no systemd — mais
# cirúrgico que usar 'setcap' no binário do node inteiro (que valeria pra
# qualquer processo, não só este serviço). Cobre as duas portas de uma vez
# (a capability não é por porta).
CAP_LINE=""
if [ "$HTTP_PORT" -lt 1024 ] || [ "$HTTPS_PORT" -lt 1024 ]; then
  CAP_LINE="AmbientCapabilities=CAP_NET_BIND_SERVICE"
fi

# Idem para TLS_CERT_PATH/TLS_KEY_PATH — só presentes se --tls-cert/--tls-key
# foram passados (já validados acima: ou os dois, ou nenhum, e legíveis pelo
# usuário de serviço). Ver server/index.js: a porta HTTPS_PORT sobe com TLS
# de verdade se essas variáveis apontarem pra um certificado/chave válidos;
# senão sobe em HTTP puro também (nunca fica indisponível esperando o
# certificado definitivo).
TLS_ENV_LINES=""
if [ -n "$TLS_CERT" ] && [ -n "$TLS_KEY" ]; then
  TLS_ENV_LINES="Environment=TLS_CERT_PATH=${TLS_CERT}
Environment=TLS_KEY_PATH=${TLS_KEY}"
fi

info "Gravando unit systemd em $UNIT_PATH..."
cat > "$UNIT_PATH" <<EOF
[Unit]
Description=CG Toolbox
After=network.target

[Service]
Type=simple
WorkingDirectory=${SERVER_DIR}
ExecStart=${NODE_BIN} index.js
Restart=always
RestartSec=3
User=${SERVICE_USER}
${CAP_LINE}
Environment=HTTP_PORT=${HTTP_PORT}
Environment=HTTPS_PORT=${HTTPS_PORT}
${NTLM_ENV_LINE}
${TLS_ENV_LINES}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" >/dev/null
systemctl restart "${SERVICE_NAME}"
sleep 1

if systemctl is-active --quiet "${SERVICE_NAME}"; then
  ok "Serviço '${SERVICE_NAME}' rodando."
else
  err "O serviço não subiu. Veja o log com: journalctl -u ${SERVICE_NAME} -n 50 --no-pager"
  exit 1
fi

# ════════════════════════════════════════════════════════════════════
# 6) Firewall — abre as portas se ufw ou firewalld estiverem ativos ─────
# ════════════════════════════════════════════════════════════════════
# Lista sem duplicar caso HTTP_PORT == HTTPS_PORT (uso incomum, mas possível).
PORTS_TO_OPEN="$HTTP_PORT"
if [ "$HTTPS_PORT" != "$HTTP_PORT" ]; then
  PORTS_TO_OPEN="$PORTS_TO_OPEN $HTTPS_PORT"
fi

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  for p in $PORTS_TO_OPEN; do
    info "ufw ativo — liberando porta ${p}/tcp..."
    ufw allow "${p}/tcp" >/dev/null
  done
  ok "Porta(s) liberada(s) no ufw."
elif command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  for p in $PORTS_TO_OPEN; do
    info "firewalld ativo — liberando porta ${p}/tcp..."
    firewall-cmd --permanent --add-port="${p}/tcp" >/dev/null
  done
  firewall-cmd --reload >/dev/null
  ok "Porta(s) liberada(s) no firewalld."
else
  warn "Nenhum firewall ativo detectado (ufw/firewalld) — nada para liberar."
fi

# ════════════════════════════════════════════════════════════════════
# Resumo final ───────────────────────────────────────────────────────
# ════════════════════════════════════════════════════════════════════
IP_ADDR="$(hostname -I 2>/dev/null | awk '{print $1}')"
HTTPS_REAL=0
if [ -n "$TLS_CERT" ] && [ -n "$TLS_KEY" ]; then
  HTTPS_REAL=1
fi

echo
ok "Instalação concluída."
echo "  Acesse em:        http://${IP_ADDR:-<ip-do-servidor>}:${HTTP_PORT}"
if [ "$HTTPS_PORT" != "$HTTP_PORT" ]; then
  if [ "$HTTPS_REAL" -eq 1 ]; then
    echo "  Acesse em:        https://${IP_ADDR:-<ip-do-servidor>}:${HTTPS_PORT}"
    warn "Se o certificado for autoassinado, o navegador vai mostrar um aviso de segurança até você instalar um certificado emitido por uma CA confiável (pode trocar os arquivos e reiniciar o serviço depois, sem mudar nada no código)."
  else
    echo "  Acesse em:        http://${IP_ADDR:-<ip-do-servidor>}:${HTTPS_PORT}  (ainda sem certificado — HTTPS real só quando --tls-cert/--tls-key forem configurados)"
  fi
fi
echo "  Ver status:       systemctl status ${SERVICE_NAME}"
echo "  Ver logs:         journalctl -u ${SERVICE_NAME} -f"
echo "  Reiniciar:        sudo systemctl restart ${SERVICE_NAME}"
echo "  Atualizar depois: rode este script de novo (sudo $0)"
echo "  Desinstalar:      sudo $0 --uninstall"
