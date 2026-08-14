-- Correção pontual dos rótulos dos parâmetros fixos da linha única de busca
-- (ver ccBuildQueryChipsFixedRow em js/catalogs.js). Rode ESTE script uma
-- única vez direto no banco de dados em produção — o código da aplicação
-- não força mais esses valores a cada boot (pedido do usuário: "não precisa
-- forçar no código, apenas ajuste no banco de dados").
--
-- Como rodar:
--   psql -U <usuario> -d <banco> -f fix-parameter-labels.sql
-- ou, se o Postgres estiver rodando em container Docker:
--   docker exec -i <container_do_postgres> psql -U <usuario> -d <banco> < fix-parameter-labels.sql
--
-- Idempotente: pode ser rodado mais de uma vez sem problema.

UPDATE parameters SET label = 'Source'            WHERE key = 'src_ip';
UPDATE parameters SET label = 'Destination'       WHERE key = 'dst_ip';
UPDATE parameters SET label = 'Source Port'       WHERE key = 'src_port';
UPDATE parameters SET label = 'Destination Port'  WHERE key = 'dest_port';
UPDATE parameters SET label = 'User'              WHERE key = 'user';
UPDATE parameters SET label = 'Host'              WHERE key = 'host';
UPDATE parameters SET label = 'License'           WHERE key = 'license';
UPDATE parameters SET label = 'Signature'         WHERE key = 'signature';

-- Confirma o resultado:
SELECT key, label, sort_order FROM parameters ORDER BY sort_order;
