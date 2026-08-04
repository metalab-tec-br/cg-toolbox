# ════════════════════════════════════════════════════════════════════════
# CG Toolbox — imagem do serviço "updater" (companion do container principal)
#
# Só existe pra dar ao botão "Check for updates"/"Update now" (Settings →
# System) acesso a git + docker CLI, SEM dar esse acesso ao container da
# aplicação (cg-toolbox), que fica exposto na rede/porta 80. Ver
# updater/server.js para o racional completo e docker-compose.yml para como
# o socket do Docker do host e o diretório do repositório são montados.
#
# git/docker.io vêm dos repositórios padrão do Debian (não do repositório
# oficial do Docker) de propósito — evita repetir o problema de GPG key /
# PMTU já enfrentado com download.docker.com no Dockerfile principal.
#
# O plugin "docker compose" NÃO vem do apt: o pacote "docker-compose-v2" não
# existe nos repositórios padrão desta imagem (confirmado em build real —
# "E: Unable to locate package docker-compose-v2"), e o nome/disponibilidade
# desse pacote varia entre versões do Debian. Em vez de depender disso, o
# binário oficial é baixado direto da página de releases do projeto
# (github.com/docker/compose) e verificado por checksum — é exatamente o
# método de instalação manual documentado oficialmente para o plugin, sem
# precisar adicionar repositório nenhum.
# ════════════════════════════════════════════════════════════════════════
FROM node:20-bookworm-slim
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends git docker.io ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Atualize COMPOSE_VERSION se quiser uma versão mais nova do plugin — não
# precisa bater com a versão do Docker Engine do host, plugins do compose
# são independentes da versão do daemon.
ARG COMPOSE_VERSION=v5.1.4
RUN mkdir -p /usr/local/lib/docker/cli-plugins \
    && curl -fsSL -o /tmp/docker-compose \
       "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
    && curl -fsSL -o /tmp/docker-compose.sha256 \
       "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64.sha256" \
    && [ "$(awk '{print $1}' /tmp/docker-compose.sha256)" = "$(sha256sum /tmp/docker-compose | awk '{print $1}')" ] \
    && mv /tmp/docker-compose /usr/local/lib/docker/cli-plugins/docker-compose \
    && chmod +x /usr/local/lib/docker/cli-plugins/docker-compose \
    && rm -f /tmp/docker-compose.sha256

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
