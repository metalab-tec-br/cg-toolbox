-- ATENÇÃO — APAGA ABSOLUTAMENTE TUDO, sem exceção: todos os comandos,
-- pastas, notes, catálogos (Vendor/System/Version/Environment/Topic/
-- Parameters/Prompts), API keys, sessões e USUÁRIOS (inclusive o admin).
-- Pedido explícito do usuário: "podemos apagar todos os dados e começar do
-- zero". Isso é IRREVERSÍVEL — não há como desfazer depois de rodar.
--
-- Recomendação: tire um backup antes (Configurações → System → Backup &
-- Restore no próprio app, ou pg_dump manual) caso queira poder voltar atrás.
--
-- As TABELAS em si não são apagadas (TRUNCATE, não DROP) — só o conteúdo.
-- RESTART IDENTITY zera os contadores SERIAL (commands.id, folders.id,
-- command_lines.id etc. voltam a começar do 1). CASCADE cobre automaticamente
-- todas as foreign keys entre as tabelas, então a ordem na lista não importa.
--
-- Depois de rodar, reinicie o container do backend para os seeds padrão
-- rodarem de novo no boot (usuário admin/admin, pastas Favorites, catálogos
-- de fábrica — Vendor/System/Version/Environment/Parameters/Prompts):
--   docker compose restart cg-toolbox-backend
-- (ou: docker restart cg-toolbox-backend)
--
-- Como rodar:
--   docker exec -i cg-toolbox-db psql -U cgtoolbox -d cgtoolbox < server/reset-database-full.sql

TRUNCATE TABLE
  commands,
  command_vendors,
  command_systems,
  command_versions,
  command_environments,
  command_topics,
  command_lines,
  vendors,
  systems,
  versions,
  environments,
  version_environments,
  topics,
  environment_topics,
  parameters,
  prompts,
  user_favorites,
  folders,
  folder_commands,
  notes,
  user_data,
  audit_log,
  api_keys,
  users,
  sessions
RESTART IDENTITY CASCADE;

-- Confirma que tudo esvaziou:
SELECT
  (SELECT COUNT(*) FROM commands)  AS commands,
  (SELECT COUNT(*) FROM folders)   AS folders,
  (SELECT COUNT(*) FROM users)     AS users,
  (SELECT COUNT(*) FROM vendors)   AS vendors,
  (SELECT COUNT(*) FROM parameters) AS parameters;
