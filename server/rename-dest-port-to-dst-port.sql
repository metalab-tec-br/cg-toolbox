-- Renomeia a chave do parâmetro "Destination Port" de dest_port para
-- dst_port — pedido do usuário. Isso também CORRIGE uma inconsistência já
-- existente no código: js/render.js e os RESOLVERS de js/db-render-engine.js
-- (fwmonitor, tcpdump, logexport etc.) já leem/desestruturam a chave como
-- `dst_port`, mas o catálogo `parameters` continuava cadastrado como
-- `dest_port` — ou seja, o campo "Destination Port" da barra de busca nunca
-- alimentava esses comandos corretamente (o valor digitado ficava só no
-- input, sem chegar no filtro), e qualquer comando com {{dest_port}} no
-- texto nunca era substituído de verdade (ficava sempre como o placeholder
-- "<Destination Port>"). Depois deste script os dois lados baterão em
-- `dst_port`.
--
-- Rode ESTE script uma única vez direto no banco de dados em produção:
--   psql -U <usuario> -d <banco> -f rename-dest-port-to-dst-port.sql
-- ou, se o Postgres estiver rodando em container Docker:
--   docker exec -i <container_do_postgres> psql -U <usuario> -d <banco> < rename-dest-port-to-dst-port.sql
--
-- Idempotente: pode ser rodado mais de uma vez sem problema (cada passo só
-- age se ainda houver algo em "dest_port" pra corrigir).

BEGIN;

-- 1) Renomeia a linha do catálogo — só se dest_port existir e dst_port ainda
--    não tiver sido criado por outro caminho (ex.: um boot mais recente do
--    app, que já semeia dst_port como novo se dest_port não existir mais).
UPDATE parameters SET key = 'dst_port', label = 'Destination Port'
WHERE key = 'dest_port'
  AND NOT EXISTS (SELECT 1 FROM parameters WHERE key = 'dst_port');

-- Caso as duas chaves já coexistam (ex.: um boot recente já criou dst_port
-- como linha nova, ver FIXED_PARAM_DEFAULTS em server/db.js, sem apagar a
-- dest_port antiga) — mantém só dst_port e remove a duplicata dest_port.
DELETE FROM parameters WHERE key = 'dest_port' AND EXISTS (SELECT 1 FROM parameters WHERE key = 'dst_port');

-- 2) Reescreve o token literal {{dest_port}} -> {{dst_port}} em todo texto
--    de comando que possa conter o placeholder (mesmas colunas passadas por
--    resolveTokens()/resolveTokensMarked() em js/db-render-engine.js).
UPDATE commands SET name        = REPLACE(name,        '{{dest_port}}', '{{dst_port}}') WHERE name        LIKE '%{{dest_port}}%';
UPDATE commands SET desc        = REPLACE(desc,        '{{dest_port}}', '{{dst_port}}') WHERE desc        LIKE '%{{dest_port}}%';
UPDATE commands SET name_empty  = REPLACE(name_empty,  '{{dest_port}}', '{{dst_port}}') WHERE name_empty  LIKE '%{{dest_port}}%';
UPDATE commands SET desc_empty  = REPLACE(desc_empty,  '{{dest_port}}', '{{dst_port}}') WHERE desc_empty  LIKE '%{{dest_port}}%';
UPDATE commands SET details     = REPLACE(details,     '{{dest_port}}', '{{dst_port}}') WHERE details     LIKE '%{{dest_port}}%';
UPDATE command_lines SET content = REPLACE(content, '{{dest_port}}', '{{dst_port}}') WHERE content LIKE '%{{dest_port}}%';
UPDATE command_lines SET prompt  = REPLACE(prompt,  '{{dest_port}}', '{{dst_port}}') WHERE prompt  LIKE '%{{dest_port}}%';

COMMIT;

-- Confirma o resultado:
SELECT key, label, sort_order FROM parameters ORDER BY sort_order;
