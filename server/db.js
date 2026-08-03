// db.js — abre (ou cria) UM ÚNICO arquivo SQLite (commands.db) e aplica
// schema.sql (idempotente — CREATE TABLE IF NOT EXISTS, então re-executar é
// seguro). Antes existiam DOIS arquivos separados (commands.db "system" +
// commands_user.db "usuário") para separar comandos de referência dos
// criados por usuários — isso foi CONSOLIDADO num banco único: a distinção
// System vs. usuário agora vive inteiramente na coluna `commands.created_by`
// (ver schema.sql e server/index.js), não mais em qual arquivo o registro
// mora. commands_user.db não é mais usado por esta aplicação.
//
// Este banco NÃO é semeado automaticamente com dados de fábrica (catálogos,
// comandos, etc.) — a pedido do usuário, todas as tabelas foram esvaziadas e
// devem ser recadastradas manualmente (pela tela de administração de
// catálogo e pelo editor/importação de comandos). Reiniciar o servidor nunca
// recria nada sozinho.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// DB_PATH pode ser sobrescrito por variável de ambiente — usado no Docker
// para apontar o banco para um volume persistente (ex.: /app/data/commands.db)
// em vez do arquivo dentro da própria imagem. Sem a variável, comportamento
// idêntico a antes (server/commands.db, ao lado deste arquivo).
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'commands.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Garante que a pasta do banco exista (relevante só para DB_PATH custom
// apontando para um volume ainda vazio, ex.: /app/data/ recém-criado).
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schemaSql);

module.exports = { db, DB_PATH };
