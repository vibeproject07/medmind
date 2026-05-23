# Classificação DeCS via API

Script que classifica questões em lote usando o **mesmo endpoint** da interface admin: `POST /api/questions/[id]/decs-ai`.

## Pré-requisitos

1. App rodando com variáveis de ambiente carregadas:

   ```bash
   npm run dev
   ```

   O servidor usa a porta **5000** (ver `package.json`).

2. Questões já cadastradas na tabela `questions` com os ids listados no script.

3. Agentes `decs_classifier` e `decs_validator` configurados no painel/banco.

## Configuração

Edite [`classify-decs-via-api.mjs`](classify-decs-via-api.mjs):

- `ADMIN_TOKEN_PASTED` — JWT de usuário **admin** (copiar do login no navegador), ou variável de ambiente `ADMIN_TOKEN` na hora de rodar.
- `QUESTION_IDS` — array com os ids a classificar.
- `API_BASE_URL` — padrão `http://127.0.0.1:5000`.

**Não commite o token.** Esvazie `ADMIN_TOKEN` antes de push ou use um arquivo local ignorado pelo git.

## Execução

Na **raiz do repositório**:

```bash
node matheus/classify-decs-via-api.mjs
node matheus/classify-decs-via-api.mjs --force
node matheus/classify-decs-via-api.mjs --dry-run
```

| Flag | Efeito |
|------|--------|
| `--force` | Reclassifica mesmo que já exista saída ok no manifest |
| `--dry-run` | Lista o que seria processado, sem chamar a API |

## Saída

Pasta `classification-output/` na raiz do repo:

- `manifest.jsonl` — histórico de tentativas (append)
- `questions/{id}.json` — auditoria + resposta da API em sucesso
- `errors/{id}.json` — falhas (404, 422, 500, etc.)

Cada `questions/{id}.json` inclui:

- `question` — enunciado, `alternatives` (A–E) e `correct_answer`
- `decs_before` — `ai_decs_descriptors` e `decs_terms` **antes** do `POST decs-ai` (snapshot via `GET /api/questions/[id]`)
- `api_response` — resultado novo (`result`, `themes_identified`, `pipeline_stats`)

JSONs gerados antes dessa versão não têm `question` nem `decs_before`; use `--force` para regerar com auditoria.

A API também grava:

- coluna `questions.ai_decs_descriptors`
- `data/decs-classification/question-{id}-v1.json`

## Comportamento

- Pula ids já com `status: "ok"` no manifest **e** arquivo em `questions/{id}.json` (use `--force` para repetir).
- Retry com backoff em HTTP 429/503.
- Erro 401/403 interrompe o lote (token inválido ou sem permissão).
- Pausa de 2s entre questões (configurável via `DELAY_MS` no script).
- Antes de cada classificação: `GET` da questão para gravar `decs_before` (o POST sobrescreve `ai_decs_descriptors` no banco).
