# ════════════════════════════════════════════════════════════════════════
# CG Toolbox — imagem do serviço "updater" (companion do container principal)
#
# Só existe pra dar ao botão "Check for updates"/"Update now" (Settings →
# System) acesso a git + docker CLI, SEM dar esse acesso ao container da
# aplicação (cg-toolbox), que fica exposto na rede/porta 80. Ver
# updater/server.js para o racional completo e docker-compose.yml para como
# o socket do Docker do host e o diretório do repositório são montados.
#
# git/docker.io/docker-compose-v2 vêm dos repositórios padrão do Debian
# (não do repositório oficial do Docker) de propósito — evita repetir o
# problema de GPG key / PMTU já enfrentado com download.docker.com no
# Dockerfile principal; aqui a versão empacotada pelo Debian é suficiente
# (só precisamos do cliente "docker"/"docker compose", não do daemon).
# ════════════════════════════════════════════════════════════════════════
FROM node:20-bookworm-slim
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends git docker.io docker-compose-v2 \
    && rm -rf /var/lib/apt/lists/*

COPY server.js ./server.js

# Roda como root de propósito: precisa ler/escrever no socket do Docker do
# host (/var/run/docker.sock, montado pelo docker-compose.yml), cujo grupo
# dono varia de host pra host — root sempre tem acesso, evitando ter que
# descobrir e replicar o GID do grupo "docker" do host dentro da imagem.
# Este container NÃO publica porta nenhuma pro host (ver docker-compose.yml)
# — só é alcançável pela rede interna do compose, pelo serviço cg-toolbox.
ENV REPO_DIR=/repo
ENV UPDATER_PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
