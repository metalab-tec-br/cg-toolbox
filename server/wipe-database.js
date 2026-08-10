#!/usr/bin/env node
// wipe-database.js — apaga TODO o conteúdo do banco cg-toolbox, exceto:
//   1) o usuário 'admin'
//   2) qualquer pasta chamada exatamente 'Favorites' (de qualquer usuário)
//
// Pedido do usuário: "crie um script para eu limpar o banco de dados.
// o que nunca pode ser excluido: usuário admin, pasta favorites."
// Escopo confirmado (perguntas de esclarecimento): apagar TAMBÉM os
// catálogos (Vendors/Systems/Versions/Environments/Topics/Parameters/
// Prompts) e TAMBÉM audit_log e api_keys — ou seja, "apagar tudo".
//
// O que é apagado:
//   - Todos os comandos (commands) e tudo que depende deles em cascata:
//     command_vendors, command_systems, command_versions,
//     command_environments, command_topics, command_lines, command_diffs,
//     command_diff_lines, folder_commands, user_favorites (legado).
//   - Todos os catálogos: vendors (cascata: systems, versions),
//     environments (cascata: version_environments, environment_topics),
//     topics, parameters, prompts.
//   - Todas as notas (notes), de qualquer pasta (inclusive Favorites — a
//     PASTA sobrevive, vazia; o conteúdo dela não).
//   - audit_log, api_keys, sessions, user_data (config/preferências de
//     TODOS os usuários, inclusive admin — ver aviso abaixo).
//   - Todas as pastas (folders) cujo nome NÃO seja exatamente 'Favorites'.
//   - Todos os usuários cujo username NÃO seja 'admin'.
//
// O que NUNCA é apagado:
//   - O registro do usuário 'admin' em si (users.username = 'admin').
//   - Qualquer pasta cujo nome seja exatamente 'Favorites' (de admin ou de
//     qualquer outro usuário que ainda exista após a limpeza — o que hoje
//     em dia, com a regra acima, só pode ser o próprio admin).
//
// Efeitos colaterais importantes que o usuário não foi perguntado
// diretamente, mas que decorrem de "apagar tudo" (ver avisos impressos
// no console ao rodar o script):
//   - O tópico protegido especial 'environment' (topics.is_protected=1,
//     usado internamente para os cards "Ambiente específico") é apagado
//     junto com a tabela topics e NÃO pode ser recriado pela UI normal
//     (POST /api/topics sempre cria com is_protected=0) — só via SQL manual.
//   - user_data é limpo por inteiro, o que reseta as preferências de UI do
//     próprio admin E a configuração global de agendamento de backup
//     (guardada sob o username sentinela '__global_defaults__').
//
// Uso:
//   node wipe-database.js               -> mostra este resumo e sai (não faz nada)
//   node wipe-database.js --dry-run     -> conecta no banco e mostra CONTAGENS
//                                          do que seria apagado/preservado,
//                                          sem alterar nada
//   node wipe-database.js --yes         -> executa a limpeza de verdade,
//                                          dentro de uma única transação
//
// Recomendação: rode um backup (Settings -> Backup & Restore, ou
// `pg_dump`) antes de usar --yes. A operação é irreversível.
'use strict';

const { pool, withTransaction } = require('./db');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CONFIRMED = args.includes('--yes');

const WARNINGS = [
  `O tópico protegido 'environment' (usado nos cards "Ambiente específico") será perdido e NÃO pode ser recriado pela tela de Register — só via SQL manual (INSERT INTO topics (key,label,is_protected) VALUES ('environment','Ambiente específico',1)).`,
  `A tabela user_data será limpa por inteiro: isso reseta as preferências de UI do admin E a configuração global de agendamento de backup (chave guardada sob '__global_defaults__').`,
  `O conteúdo das pastas (notas e comandos vinculados) é apagado mesmo em pastas chamadas 'Favorites' — só a PASTA em si é preservada (fica vazia), não o que estava dentro dela.`,
];

function printHeader() {
  console.log('='.repeat(78));
  console.log('wipe-database.js — limpeza total do banco cg-toolbox');
  console.log('Preserva SEMPRE: usuário "admin" e qualquer pasta chamada "Favorites".');
  console.log('='.repeat(78));
  console.log('\nAvisos (efeitos colaterais de "apagar tudo"):');
  WARNINGS.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
  console.log('');
}

async function getCounts(q) {
  const tables = [
    'commands', 'vendors', 'systems', 'versions', 'environments', 'topics',
    'parameters', 'prompts', 'notes', 'audit_log', 'api_keys', 'sessions',
    'user_data', 'user_favorites', 'users', 'folders',
  ];
  const counts = {};
  for (const t of tables) {
    const { rows } = await q(`SELECT COUNT(*) AS n FROM ${t}`);
    counts[t] = Number(rows[0].n);
  }
  const { rows: favRows } = await q(`SELECT COUNT(*) AS n FROM folders WHERE name = 'Favorites'`);
  counts.folders_favorites = Number(favRows[0].n);
  counts.folders_other = counts.folders - counts.folders_favorites;
  const { rows: adminRows } = await q(`SELECT COUNT(*) AS n FROM users WHERE username = 'admin'`);
  counts.users_admin = Number(adminRows[0].n);
  counts.users_other = counts.users - counts.users_admin;
  return counts;
}

async function preflightCheckAdminExists(q) {
  const { rows } = await q(`SELECT username FROM users WHERE username = 'admin'`);
  if (rows.length === 0) {
    throw new Error(
      "Nenhum usuário com username 'admin' encontrado no banco. Abortando por segurança " +
      "(a limpeza apaga 'WHERE username <> admin' — sem um admin existente, TODOS os " +
      "usuários seriam apagados). Crie/restaure o usuário admin antes de rodar --yes."
    );
  }
}

async function runDryRun() {
  const before = await getCounts((sql) => pool.query(sql));
  console.log('Situação ATUAL do banco (nada foi alterado — modo --dry-run):\n');
  console.log(`  Comandos (commands):                 ${before.commands}`);
  console.log(`  Vendors / Systems / Versions:         ${before.vendors} / ${before.systems} / ${before.versions}`);
  console.log(`  Environments / Topics / Parameters:   ${before.environments} / ${before.topics} / ${before.parameters}`);
  console.log(`  Prompts:                              ${before.prompts}`);
  console.log(`  Notas (notes):                        ${before.notes}`);
  console.log(`  Audit log:                            ${before.audit_log}`);
  console.log(`  API keys:                             ${before.api_keys}`);
  console.log(`  Sessões (sessions):                   ${before.sessions}`);
  console.log(`  Preferências salvas (user_data):      ${before.user_data}`);
  console.log(`  Favoritos legado (user_favorites):    ${before.user_favorites}`);
  console.log(`  Pastas (folders) — total:             ${before.folders}`);
  console.log(`    - chamadas "Favorites" (PRESERVADAS): ${before.folders_favorites}`);
  console.log(`    - demais (SERÃO APAGADAS):             ${before.folders_other}`);
  console.log(`  Usuários — total:                     ${before.users}`);
  console.log(`    - 'admin' (PRESERVADO):                ${before.users_admin}`);
  console.log(`    - demais (SERÃO APAGADOS):              ${before.users_other}`);
  console.log('\nNenhuma alteração foi feita. Rode com --yes para executar de verdade.');
}

async function runWipe() {
  await preflightCheckAdminExists((sql) => pool.query(sql));

  const before = await getCounts((sql) => pool.query(sql));

  await withTransaction(async (client) => {
    const q = (sql) => client.query(sql);

    // Repita a checagem de segurança DENTRO da transação — evita uma
    // condição de corrida caso o admin seja removido por outra sessão entre
    // o preflight acima e o início desta transação.
    const { rows: adminCheck } = await q(`SELECT username FROM users WHERE username = 'admin'`);
    if (adminCheck.length === 0) {
      throw new Error("Usuário 'admin' desapareceu entre a checagem inicial e a transação — abortando.");
    }

    // 1) Comandos + catálogos: um único TRUNCATE ... CASCADE cobre também
    //    todas as tabelas filhas via FK ON DELETE CASCADE (ver schema.sql):
    //    command_vendors/systems/versions/environments/topics, command_lines,
    //    command_diffs -> command_diff_lines, folder_commands (FK command_id),
    //    systems/versions (FK vendor/system), version_environments,
    //    environment_topics. RESTART IDENTITY zera as sequences SERIAL.
    await q(`
      TRUNCATE TABLE
        commands, notes, audit_log, api_keys, user_favorites,
        vendors, environments, topics, parameters, prompts
      RESTART IDENTITY CASCADE
    `);

    // 2) Sessões e preferências: sem relação com o TRUNCATE acima, limpos
    //    incondicionalmente (inclusive as do próprio admin, que terá que
    //    logar de novo e reconfigurar preferências/agendamento de backup).
    await q(`TRUNCATE TABLE sessions`);
    await q(`TRUNCATE TABLE user_data`);

    // 3) Pastas: apaga todas MENOS as chamadas exatamente 'Favorites'.
    //    (Cascata ON DELETE em folder_commands/notes para as pastas
    //    removidas já foi coberta indiretamente acima — folder_commands foi
    //    truncada junto com commands; notes já foi truncada no passo 1.)
    await q(`DELETE FROM folders WHERE name <> 'Favorites'`);

    // 4) Usuários: apaga todos MENOS 'admin'. Cascata ON DELETE CASCADE
    //    remove as sessions remanescentes desses usuários (já truncada, mas
    //    o CASCADE aqui é inofensivo/idempotente).
    await q(`DELETE FROM users WHERE username <> 'admin'`);
  });

  const after = await getCounts((sql) => pool.query(sql));

  console.log('Limpeza concluída com sucesso.\n');
  console.log('Resumo (antes -> depois):');
  console.log(`  Comandos:        ${before.commands} -> ${after.commands}`);
  console.log(`  Catálogos:       vendors ${before.vendors}->${after.vendors}, systems ${before.systems}->${after.systems}, versions ${before.versions}->${after.versions}, environments ${before.environments}->${after.environments}, topics ${before.topics}->${after.topics}, parameters ${before.parameters}->${after.parameters}, prompts ${before.prompts}->${after.prompts}`);
  console.log(`  Notas:           ${before.notes} -> ${after.notes}`);
  console.log(`  Audit log:       ${before.audit_log} -> ${after.audit_log}`);
  console.log(`  API keys:        ${before.api_keys} -> ${after.api_keys}`);
  console.log(`  Sessões:         ${before.sessions} -> ${after.sessions}`);
  console.log(`  user_data:       ${before.user_data} -> ${after.user_data}`);
  console.log(`  Usuários:        ${before.users} -> ${after.users} (deve sobrar só 'admin': ${after.users_admin === 1 ? 'OK' : 'ATENÇÃO'})`);
  console.log(`  Pastas:          ${before.folders} -> ${after.folders} (todas devem ser 'Favorites': ${after.folders === after.folders_favorites ? 'OK' : 'ATENÇÃO'})`);

  if (after.users !== 1 || after.users_admin !== 1) {
    console.warn('\n[ATENÇÃO] Após a limpeza, a tabela users não contém exatamente 1 registro ("admin"). Verifique manualmente.');
  }
  if (after.folders !== after.folders_favorites) {
    console.warn('[ATENÇÃO] Após a limpeza, existem pastas que não se chamam "Favorites". Verifique manualmente.');
  }
}

async function main() {
  printHeader();

  if (DRY_RUN && CONFIRMED) {
    console.log('--dry-run e --yes foram passados juntos: por segurança, rodando em modo --dry-run (nenhuma alteração será feita).\n');
  }

  if (DRY_RUN || CONFIRMED) {
    try {
      if (DRY_RUN) {
        await runDryRun();
      } else {
        console.log('Executando limpeza REAL (--yes). Isto é irreversível.\n');
        await runWipe();
      }
    } catch (err) {
      console.error('\n[ERRO] A operação falhou e foi cancelada (ROLLBACK, se já dentro de transação):');
      console.error(`  ${err.message}`);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
    return;
  }

  console.log('Nenhuma flag informada — nada foi feito (modo seguro por padrão).\n');
  console.log('Uso:');
  console.log('  node wipe-database.js --dry-run   # mostra o que seria apagado, sem alterar nada');
  console.log('  node wipe-database.js --yes       # executa a limpeza de verdade (irreversível)');
  console.log('\nRecomendado: rode --dry-run primeiro, depois faça um backup (Settings -> Backup & Restore), e só então rode --yes.');
  await pool.end();
}

main();
