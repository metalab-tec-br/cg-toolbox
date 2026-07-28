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
#   - opens the app's port in ufw/firewalld, if either is active
#
# Usage:
#   sudo ./install-linux.sh                     # install/update with defaults
#   sudo ./install-linux.sh --port 3000
#   sudo ./install-linux.sh --user cgtoolbox
#   sudo ./install-linux.sh --ntlm-disabled      # dev/test box, not on a Windows domain
#   sudo ./install-linux.sh --skip-node-install  # Node already installed the way you want it
#   sudo ./install-linux.sh --uninstall          # stop + remove the service (keeps the files/DB)
#
# Safe to re-run: re-running with the app already installed treats this as
# an UPDATE (stops the service, reinstalls dependencies, restarts) instead
# of failing. server/commands.db is never touched by this script.
# ════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── defaults (override via flags below) ────────────────────────────────
PORT=3000
SERVICE_NAME="cg-toolbox"
SERVICE_USER="cgtoolbox"
NTLM_DISABLED=0
SKIP_NODE_INSTALL=0
UNINSTALL=0
NODE_MAJOR=20

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
    --port) PORT="$2"; shift 2 ;;
    --user) SERVICE_USER="$2"; shift 2 ;;
    --ntlm-disabled) NTLM_DISABLED=1; shift ;;
    --skip-node-install) SKIP_NODE_INSTALL=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help)
      sed -n '2,25p' "$0"; exit 0 ;;
    *) err "Opção desconhecida: $1"; exit 1 ;;
  esac
done

# ── must run as root (systemd, useradd, apt, firewall) ─────────────────
if [ "$(id -u)" -ne 0 ]; then
  err "Rode este script com sudo: sudo $0 $*"
  exit 1
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
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
  ok "Node.js instalado: $(node -v)"
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
Environment=PORT=${PORT}
${NTLM_ENV_LINE}

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
# 6) Firewall — abre a porta se ufw ou firewalld estiverem ativos ───────
# ════════════════════════════════════════════════════════════════════
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  info "ufw ativo — liberando porta ${PORT}/tcp..."
  ufw allow "${PORT}/tcp" >/dev/null
  ok "Porta liberada no ufw."
elif command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  info "firewalld ativo — liberando porta ${PORT}/tcp..."
  firewall-cmd --permanent --add-port="${PORT}/tcp" >/dev/null
  firewall-cmd --reload >/dev/null
  ok "Porta liberada no firewalld."
else
  warn "Nenhum firewall ativo detectado (ufw/firewalld) — nada para liberar."
fi

# ════════════════════════════════════════════════════════════════════
# Resumo final ───────────────────────────────────────────────────────
# ════════════════════════════════════════════════════════════════════
IP_ADDR="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
ok "Instalação concluída."
echo "  Acesse em:        http://${IP_ADDR:-<ip-do-servidor>}:${PORT}"
echo "  Ver status:       systemctl status ${SERVICE_NAME}"
echo "  Ver logs:         journalctl -u ${SERVICE_NAME} -f"
echo "  Reiniciar:        sudo systemctl restart ${SERVICE_NAME}"
echo "  Atualizar depois: rode este script de novo (sudo $0)"
echo "  Desinstalar:      sudo $0 --uninstall"
