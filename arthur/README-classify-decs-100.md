# Classificação DeCS — 100 questões (sequencial)

Script que classifica questões usando **`lib/decs-pipeline.ts`** (`runDeCSPipeline`), espelhando o fluxo do botão **Gerar V1**, mas executado localmente via linha de comando.

## Características

- **Uma questão por vez** — sem batch/concorrência (`Promise.all` entre questões).
- **Isolamento total** — cada questão usa nova instância Gemini, texto próprio e estado local; nada é reutilizado entre questões.
- **Relatório** — lista todas as questões classificadas + uso de tokens por questão e totais.
- **Pipeline real** — importa `runDeCSPipeline` do código de produção (não é réplica .mjs).

## Pré-requisitos

1. `.env.local` na raiz com:
   - `DATABASE_URL`
   - `GEMINI_API_KEY` (ou `GOOGLE_API_KEY`)
   - `DECS_API_KEY`
2. Agente `decs_classifier` configurado em `ai_agents`.
3. Tabela `decs_descriptors` populada (para busca vetorial local).

## Execução

Na **raiz do repositório**:

```bash
node arthur/run-classify-decs-100.mjs
```

Com opções:

```bash
node arthur/run-classify-decs-100.mjs --limit 100 --save
node arthur/run-classify-decs-100.mjs --offset 50 --limit 100
node arthur/run-classify-decs-100.mjs --include-classified --delay-ms 1000
node arthur/run-classify-decs-100.mjs --out arthur/exports/meu-run.json
```

| Flag | Padrão | Descrição |
|------|--------|-----------|
| `--limit` | 100 | Quantidade de questões |
| `--offset` | 0 | Pular N questões (ordenadas por `id`) |
| `--include-classified` | — | Incluir questões que já têm `ai_decs_descriptors` |
| `--save` | — | Gravar no banco + artifact v1 |
| `--delay-ms` | 600 | Pausa entre questões (rate limit suave) |
| `--out` | auto | Caminho do JSON de relatório |

## Tokens

O relatório inclui, por questão:

- **Classifier** — `usageMetadata` do Gemini (`decs_classifier`)
- **Embeddings** — chamadas `embedContent` durante busca vetorial no pipeline (caracteres faturáveis)
- **Total estimado** — tokens do classifier + REST + `ceil(chars/4)` dos embeddings

## Saída

- Console: progresso linha a linha + lista final das classificadas
- JSON: `arthur/exports/classify-decs-100-<timestamp>.json`

## Fluxo por questão

```
1. SELECT questão do banco
2. Gemini (decs_classifier) → temas primary/secondary  [independente]
3. runDeCSPipeline(themes) → descritores DeCS         [lib/decs-pipeline.ts]
4. (opcional --save) UPDATE questions + artifact
5. delay-ms → próxima questão
```
