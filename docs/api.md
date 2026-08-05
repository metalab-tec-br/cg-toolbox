# CG Toolbox — Referência da API

API REST exposta pelo container `cg-toolbox-backend` (ver `server/index.js`), acessada
pelo navegador através do proxy reverso do `cg-toolbox-frontend` (`/api/*`) ou
diretamente por integrações externas via API key. Todas as respostas são JSON; corpos
de requisição em `POST`/`PUT` também devem ser JSON (`Content-Type: application/json`).

## Autenticação

Toda a API usa uma identificação de "usuário atual" (`username`) para favoritos,
auditoria (`created_by`/`modified_by`) e preferências — não existe login/senha próprio.
Duas formas, nessa ordem de prioridade:

1. **API key** (integrações externas, scripts) — header `X-API-Key: <key>`. Pula o NTLM
   inteiramente. O usuário efetivo aparece como `api:<nome da key>` (ex.: `api:Zabbix`).
   Chaves são criadas/revogadas em **Settings → System → API access** na própria
   aplicação, ou via `/api/api-keys` (abaixo) — a key em texto puro só existe na
   resposta do `POST`, nunca mais depois disso.
2. **NTLM** (navegador) — login do Windows resolvido automaticamente pelo
   `express-ntlm`, sem prompt de senha (zona "Intranet local"). Se `NTLM_DISABLED=1`
   estiver definido no backend, cai no header `x-dev-user` (ou `?__user=` na query
   string), com fallback final para o usuário do sistema operacional do container.

Não há autorização por papel/permissão além disso — qualquer chamada autenticada (por
NTLM ou por qualquer API key válida) pode ler e escrever em qualquer endpoint abaixo.

**Exemplo (curl, API key):**
```bash
curl https://cgtoolbox.metalab.tec.br/api/commands \
  -H "X-API-Key: cgtb_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

## Formato de erro

Respostas de erro (4xx/5xx) sempre têm o formato:
```json
{ "error": "validation_error", "message": "\"name\" is required" }
```
Códigos de `error` usados: `validation_error` (400), `not_found` (404), `conflict` (409),
`in_use` (409 — item de catálogo em uso por comandos), `protected` (409 — tópico
protegido), `structural_dependency` (409 — parâmetro estrutural, ver Parâmetros),
`invalid_api_key` (401), `internal_error` (500). Alguns erros `in_use`/
`structural_dependency` também trazem `"count": <n>`.

---

## Comandos (`/api/commands`)

O recurso central da aplicação — cada comando de terminal (fw monitor, cplic print,
etc.) com suas linhas, variações por versão e escopo (vendor/sistema/versão/ambiente/
tópico).

### `GET /api/commands`
Lista comandos. Filtros opcionais via query string — todos combináveis (AND):

| Parâmetro     | Efeito                                                                 |
|---------------|-------------------------------------------------------------------------|
| `topic`       | Só comandos com esse tópico entre os `topics[]` (topic é obrigatório, então isto SEMPRE restringe) |
| `vendor`      | Comandos sem vendor definido OU com esse vendor entre os `vendors[]`   |
| `system`      | Idem, para `systems[]`                                                 |
| `version`     | Idem, para `versions[]`                                                |
| `environment` | Idem, para `environments[]`                                            |
| `sort`        | `creator` ordena por `created_by` (desempate: `sort_order`, `id`); padrão é `sort_order, id` |

Retorna um array de objetos **Command** (formato completo, ver abaixo).

### `GET /api/commands/:id`
Um único **Command**. `404 not_found` se não existir.

### `POST /api/commands`
Cria um comando. Corpo (campos obrigatórios em **negrito**):

```json
{
  "id": "fwmonitor",
  "name": "fw monitor",
  "desc": "Captures traffic at kernel level",
  "name_empty": "fw monitor (fill SRC/DST)",
  "desc_empty": null,
  "icon": "📄",
  "sort_order": 0,
  "vendors": ["check-point"],
  "systems": ["gaia"],
  "versions": ["r8110"],
  "environments": ["standalone"],
  "topics": ["troubleshooting"],
  "requires_ips": true,
  "requires_ip_port": false,
  "placeholder_resolver": null,
  "raw_template": "fw monitor -e \"accept src={{src_ip}};\" -o {{capFile}}",
  "about_icon": "ℹ️",
  "about_purpose": "...",
  "about_when": "...",
  "about_obs": "...",
  "tags": [{ "css_class": "t-red", "label": "KERNEL", "sort_order": 0 }],
  "lines": [
    { "variant": "default", "sort_order": 0, "line_type": "cmd", "prompt": "[Expert@FW]#", "content": "fw monitor -e \"...\"", "supports_export": true }
  ],
  "diffs": [
    { "version": "R82+", "note": "Syntax changed in R82", "sort_order": 0,
      "lines": [{ "line_type": "cmd", "prompt": "[Expert@FW]#", "content": "fw monitor -o {{capFile}} (R82+)" }] }
  ]
}
```

Campos obrigatórios: **`id`**, **`name`**, **`vendors`** (exatamente 1 item — um
comando pertence a um único vendor), **`systems`** (≥1), **`versions`** (≥1),
**`environments`** (≥1), **`topics`** (≥1 — ou o campo legado `topic`, string única).

`created_by`/`modified_by` são preenchidos automaticamente com o usuário atual —
não são aceitos no corpo.

**Guarda importante**: `requires_ips`/`requires_ip_port` só são persistidos como `true`
se `lines` contiver pelo menos uma linha com `"variant": "empty"` e `content` não vazio
— essas linhas são o que aparece no card quando SRC/DST (ou IP/Porta) ainda não foram
preenchidos. Sem isso, a flag é rebaixada para `false` no servidor (em vez de deixar o
comando entrar num estado "invisível" na UI — ver histórico do bug em
`server/index.js`, `buildCommandColumns`).

Retorna `201` com o **Command** criado. `400 validation_error` se faltar campo
obrigatório. `409 conflict` se `id` já existir.

### `PUT /api/commands/:id`
Mesmo corpo do `POST` (substitui TODOS os filhos — tags/linhas/diffs/escopo). Se `id`
vier no corpo, precisa bater com o da URL. Sem restrição de dono — qualquer usuário
autenticado pode editar qualquer comando, inclusive os com `created_by: "System"`.
`modified_by` é atualizado para o usuário atual. `404 not_found` / `400
validation_error`.

### `DELETE /api/commands/:id`
Remove o comando e (via `ON DELETE CASCADE`) todas as suas linhas/tags/diffs/escopo/
favoritos. `204` no sucesso, `404 not_found`.

### Formato do objeto **Command** (resposta)
```json
{
  "id": "fwmonitor",
  "topic": "troubleshooting",
  "topics": ["troubleshooting"],
  "favorite_count": 2,
  "favorited_by": ["rsilva", "CG2000\\jsilva"],
  "icon": "📄",
  "sort_order": 0,
  "requires_ips": true,
  "requires_ip_port": false,
  "placeholder_resolver": null,
  "raw_template": "fw monitor -e \"accept src={{src_ip}};\" -o {{capFile}}",
  "name": "fw monitor",
  "name_empty": "fw monitor (fill SRC/DST)",
  "desc": "Captures traffic at kernel level",
  "desc_empty": null,
  "about": { "icon": "ℹ️", "purpose": "...", "when": "...", "obs": "..." },
  "tags": [{ "css_class": "t-red", "label": "KERNEL" }],
  "vendors": ["check-point"],
  "systems": ["gaia"],
  "versions": ["r8110"],
  "environments": ["standalone"],
  "lines": {
    "default": [{ "line_type": "cmd", "prompt": "[Expert@FW]#", "content": "...", "supports_export": true, "image_data": null }],
    "empty": [{ "line_type": "note", "prompt": null, "content": "Fill SRC/DST to see the full command", "supports_export": false, "image_data": null }]
  },
  "diffs": [{ "version": "R82+", "note": "Syntax changed in R82", "lines": [{ "line_type": "cmd", "prompt": "[Expert@FW]#", "content": "..." }] }],
  "created_at": "2026-08-04T12:00:00.000Z",
  "updated_at": "2026-08-04T12:00:00.000Z",
  "created_by": "rsilva",
  "modified_by": "rsilva",
  "is_system": false
}
```

---

## Favoritos (`/api/favorites`)
Por usuário atual (independente de NTLM ou API key). `favorite_count`/`favorited_by`
no **Command** já agregam todos os usuários — estes endpoints são só para o "meu".

- `GET /api/favorites` → array de `command_id` (strings) favoritados pelo usuário atual.
- `POST /api/favorites/:commandId` → `204`. `404 not_found` se o comando não existir.
  Idempotente (favoritar de novo não duplica nem dá erro).
- `DELETE /api/favorites/:commandId` → `204` (idempotente, mesmo se não era favorito).

---

## `GET /api/me`
Identifica o chamador atual.
```json
{ "username": "CG2000\\rsilva", "upn": "rsilva@empresa.com" }
```
`upn` vem de uma consulta LDAP ao Active Directory (se `AD_DOMAIN_CONTROLLER`/
`AD_BASE_DN` estiverem configurados no backend) — cai em `username` se não configurado
ou indisponível. Para chamadas com API key, `username` é `api:<nome da key>` e `upn`
espelha o mesmo valor (não há UPN de verdade para uma key).

---

## Log de auditoria (`GET /api/audit-log`)
Histórico de criação/edição/exclusão de comandos, últimos 30 dias (retenção automática),
mais recente primeiro, limite de 1000 linhas.
```json
[{ "id": 42, "ts": "2026-08-04T12:00:00.000Z", "username": "rsilva", "action": "update", "command_id": "fwmonitor", "command_name": "fw monitor" }]
```
`action` é `create` | `update` | `delete`.

---

## Dados por usuário (`/api/user-data`, `/api/global-settings`)
Armazenamento genérico chave/valor (tema, idioma, filtros, históricos de busca — o que
antes vivia só no `localStorage` do navegador).

- `GET /api/user-data` → `{ "cpa-theme": "dark", "cpa-settings": "{...}", ... }` (tudo do
  usuário atual).
- `PUT /api/user-data` → corpo `{ chave: valor, ... }`, upsert parcial (só as chaves
  enviadas; `null`/`undefined` são ignorados, não apagam a chave). `204`.
- `GET`/`PUT /api/global-settings` → mesmo formato, mas grava sob um usuário sentinela
  compartilhado (`__global_defaults__`) — são os **defaults** herdados por quem ainda
  não tem preferência própria salva (não afeta quem já personalizou algo).

---

## API keys (`/api/api-keys`)
Ver também a seção Autenticação acima e `api_keys` em `server/schema.sql`.

- `GET /api/api-keys` → lista (sem o valor da key, só metadados):
  ```json
  [{ "id": 3, "name": "Zabbix", "key_prefix": "cgtb_a1b2c3d4", "created_by": "rsilva", "created_at": "...", "last_used_at": "...", "revoked_at": null }]
  ```
- `POST /api/api-keys` — corpo `{ "name": "Zabbix" }` → `201`, **a única vez** que a key
  completa aparece:
  ```json
  { "id": 3, "name": "Zabbix", "key_prefix": "cgtb_a1b2c3d4", "created_by": "rsilva", "created_at": "...", "key": "cgtb_a1b2c3d4e5f6...(64 hex)" }
  ```
- `DELETE /api/api-keys/:id` → revoga (soft-delete — `revoked_at = NOW()`, não apaga a
  linha). Uma key revogada nunca mais autentica. `204`, `404 not_found`.

---

## Catálogos administráveis

Hierarquia estrita **Vendor → Sistema → Versão** (1:N reais, FK obrigatória) e N:N
livre **Versão ↔ Ambiente** / **Ambiente ↔ Tópico**. `key` de cada item é gerado no
servidor a partir do `label` (slug) e nunca é editável depois de criado — exclusão é
bloqueada (`409 in_use`) enquanto algum comando referenciar aquele valor.

### `GET /api/catalogs`
Todos os catálogos de uma vez (usado no boot do front-end):
```json
{
  "vendors": [{ "key": "check-point", "label": "Check Point", "color": "#e2231a", "sort_order": 0 }],
  "systems": [{ "key": "gaia", "vendor": "check-point", "label": "Gaia", "color": "...", "sort_order": 0 }],
  "versions": [{ "system": "gaia", "vendor": "check-point", "key": "r8110", "label": "R81.10", "color": "...", "sort_order": 0 }],
  "environments": [{ "key": "standalone", "label": "Standalone", "color": "...", "sort_order": 0 }],
  "topics": [{ "key": "troubleshooting", "label": "Troubleshooting", "color": "...", "sort_order": 0, "is_protected": 0 }],
  "parameters": [{ "key": "src_ip", "label": "Source IP", "sort_order": 0 }],
  "version_environments": [{ "version": "r8110", "environment": "standalone" }],
  "environment_topics": [{ "environment": "standalone", "topic": "troubleshooting" }]
}
```

### Vendors — `/api/vendors`
- `POST` — corpo `{ "label", "color"? }` → `201` (key gerada a partir do label).
- `PUT /api/vendors/:key` — corpo `{ "label"?, "color"?, "sort_order"? }` → `200`.
- `DELETE /api/vendors/:key` — `204`; `409 in_use` se algum comando usa; cascata apaga
  os `systems`/`versions` filhos.

### Sistemas — `/api/systems`
Igual a Vendors, mas exige `vendor` (key de um vendor existente) na criação/edição —
`400 validation_error` se o vendor não existir. Trocar o `vendor` de um sistema também
realinha `versions.vendor` dos filhos automaticamente.

### Versões — `/api/versions`
Chave primária composta (`system`, `key`) — o mesmo `key` pode existir em sistemas
diferentes, mas não duas vezes no MESMO vendor (`UNIQUE(vendor, key)`).
- `POST` — corpo `{ "label", "system", "color"? }` (system obrigatório) → `201`.
- `PUT /api/versions/:system/:key` — pode inclusive mover a versão para outro `system`
  no corpo (`{ "system": "novo-sistema" }`) — valida conflito antes de mover.
- `DELETE /api/versions/:system/:key` — `409 in_use` se algum comando usa.

### Ambientes — `/api/environments`
CRUD simples (`POST` / `PUT /:key` / `DELETE /:key`), igual a Vendors.

- `PUT /api/environments/:key/versions` — corpo `{ "versions": ["r8110", "r8210"] }`
  substitui TODO o conjunto de versões vinculadas a esse ambiente (N:N).

### Tópicos — `/api/topics`
Igual a Ambientes, mas com `is_protected` (só o tópico interno `environment` tem
`is_protected=1` — usado nos cards de "Ambiente específico"; não pode ser excluído e
fica fora dos filtros de Tópico da UI).

- `PUT /api/topics/:key/environments` — corpo `{ "environments": [...] }`, mesmo padrão
  N:N do endpoint de versões acima.

### Parâmetros — `/api/parameters`
Os tokens `{{key}}` usados nos templates de comando (`src_ip`, `dst_ip`, `ip`, `port`,
etc.), administrados na aba Parâmetros da tela de catálogo.
- `POST` — corpo `{ "key", "label", "sort_order"? }` — **`key` é digitado pelo usuário**
  (diferente dos outros catálogos, que geram slug automaticamente), validado contra
  `^[A-Za-z0-9._-]{1,40}$`. `409 conflict` se já existir.
- `PUT /api/parameters/:key` — só `label`/`sort_order` (key imutável).
- `DELETE /api/parameters/:key` — bloqueado com `409` se: (a) `{{key}}` aparece em
  algum `raw_template`/linha/diff de algum comando (`error: "in_use"`); ou (b) é
  `src_ip`/`dst_ip` e algum comando tem `requires_ips=true`, ou é `ip`/`port` e algum
  comando tem `requires_ip_port=true` (`error: "structural_dependency"` — esses 4 são
  lidos diretamente pela lógica de estado vazio do card, não só por substituição de
  template).

---

## Backup & Restore (`/api/backups`, `/api/backup-schedule`)
Dumps do PostgreSQL via `pg_dump`/`pg_restore` (formato "custom"), guardados no volume
`cg-toolbox-backups` do container backend.

- `GET /api/backups` → `[{ "filename": "backup-20260804-020000.dump", "sizeBytes": 123456, "createdAt": "..." }]`.
- `POST /api/backups` → cria um dump agora → `201 { "filename": "..." }`.
- `GET /api/backups/:filename/download` → baixa o arquivo `.dump`.
- `DELETE /api/backups/:filename` → apaga o arquivo → `204`.
- `POST /api/backups/:filename/restore` → tira um snapshot de segurança do estado
  atual (prefixo `pre-restore-`) e então restaura (`pg_restore --clean --if-exists`) →
  `200 { "ok": true, "message": "..." }`.
- `GET`/`PUT /api/backup-schedule` → agendamento diário/semanal/mensal, ex.:
  ```json
  { "enabled": true, "frequency": "daily", "weeklyDays": [], "monthlyDay": 1, "time": "02:00" }
  ```
  Checado a cada minuto pelo backend (`checkScheduledBackup`); `backupScheduleLastRunDate`
  evita rodar duas vezes no mesmo dia.

---

## Referências

- Schema completo do banco: `server/schema.sql`.
- Implementação de cada rota: `server/index.js`.
- Modelo de containers/deploy: `docs/install-instructions.txt`.
