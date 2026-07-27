# Task: feat/themes-agent-and-table

Branch: `feat/themes-agent-and-table`  
Status: **implementação concluída** (2026-07-24)

## Objetivo

Fazer o fluxo de **temas e subtemas** funcionar de ponta a ponta, com o agente `question_themes_assigner` e o código usando como fonte de verdade a tabela administrada em **Temas e Subtemas** (`themes_catalog`).

## Checklist

- [x] Exportar `buildDeCSQuestionText` em `lib/decs-pipeline.ts`
- [x] Restaurar `resolveSystemInstruction` em `getRuntimeAgent`
- [x] Default único nested + `{{QUESTAO}}` / `{{LISTA_TEMAS}}` / `{{RESPOSTA_CORRETA}}`
- [x] Sync do prompt em `ai_agents` (smoke script)
- [x] `classifyQuestionThemes`: agrupar catálogo + placeholders
- [x] Parser nested com subtemas vazios → fallback `[tema]`
- [x] Lista de questões → `/themes-assign` + `ai_question_themes`
- [x] Legado `/themes` delega ao fluxo canônico
- [x] Smoke Q26696 → persistido com rótulos do catálogo

## Smoke

```
npx tsx scripts/smoke-themes.ts
```

Resultado: temas `Tromboembolia pulmonar` + `Perioperatório` do catálogo; `pendingInserted: 0`.

## Objetivo

Fazer o fluxo de **temas e subtemas** funcionar de ponta a ponta, com o agente `question_themes_assigner` e o código usando como fonte de verdade a tabela administrada em **Temas e Subtemas** (`themes_catalog`).

---

## Diagnóstico (auditoria)

### O que já funciona (plumbing)

- UI da questão: `QuestionThemesAssignSection` → `POST /api/questions/[id]/themes-assign`
- Classificação: `classifyQuestionThemes` em `lib/taxonomy-agents.ts`
- Admin CRUD: `/dashboard/admin/temas` → `/api/admin/themes` (+ pending)
- Tabelas: `themes_catalog` (**537** pares tema/subtema), `themes_pending` (0), coluna `questions.ai_question_themes`
- Agente no DB (`question_themes_assigner`) presente (~1,2k chars, formato flat)

### O que não funciona / está desalinhado

1. **`buildDeCSQuestionText` não exportado em `lib/decs-pipeline.ts`**  
   `classifyQuestionThemes` / `classifyQuestionHabilities` importam a função, mas ela **não existe** no módulo → runtime `TypeError` (quebra silenciosa do fluxo).

2. **Catálogo injetado de forma fraca**  
   Código faz `SELECT tema, subtema` e anexa ao **user message** com “prefira estes”.  
   Prompt do agente **não** menciona catálogo nem tem `{{LISTA_TEMAS}}` (sem paridade com competências).

3. **Defaults duplicados** em `lib/ai-agents-defaults.ts`  
   - 1º `question_themes_assigner` (flat: `temas[]`, `subtemas[]`, `tema_principal`) — **é o que está no DB**  
   - 2º nested: `temas:[{tema, subtemas}]` — alinhado à UI/admin, mas seed usa o primeiro

4. **`getRuntimeAgent`** usa só `system_prompt` (`resolveSystemInstruction` comentado).

5. **Zero questões** com `ai_question_themes` preenchido.

6. **Caminho legado** ainda vivo: `POST /api/questions/[id]/themes` → coluna `questions.temas` (sem catálogo, sem pending). Lista de questões pode ainda apontar para ele.

7. **Tabela legada `temas_catalogo`** (337 temas, `subtemas JSONB`) — não usada pelo app; `themes_catalog` já parece populada a partir dela (537 pares).

### Dados

| Tabela | Rows | Papel |
|--------|------|--------|
| `themes_catalog` | 537 | SoT admin + (hoje) injeção fraca |
| `themes_pending` | 0 | Fila de validação |
| `temas_catalogo` | 337 | Legado hierárquico (não usado pelo código) |
| `ai_agents.question_themes_assigner` | 1 | Prompt flat em produção |
| `questions.ai_question_themes` | 0 | Resultado IA |

---

## Decisão de arquitetura (recomendação)

**Fonte única: `themes_catalog`** (página admin).  
Não manter `temas_catalogo` no caminho quente do agente.

### Forma correta e eficiente de dar acesso ao agente

1. **Agrupar** o catálogo antes de injetar (economiza tokens vs 537 linhas flat):
   ```json
   [
     { "tema": "Abdome agudo", "subtemas": ["Abdome agudo hemorrágico", "…"] },
     { "tema": "Cardiologia", "subtemas": ["…"] }
   ]
   ```

2. **Injeção via placeholders** (espelhar competências):
   - Prompt com `{{QUESTAO}}`, `{{RESPOSTA_CORRETA}}`, `{{LISTA_TEMAS}}`
   - Em `classifyQuestionThemes`: se houver placeholders → `fillPromptPlaceholders`; senão → append no user message (fallback)

3. **Prompt único nested** alinhado ao parser/UI:
   ```json
   { "temas": [ { "tema": "…", "subtemas": ["…"], "principal": true } ] }
   ```
   Regras: preferir rótulos do catálogo; inventar só quando necessário → cai em `themes_pending`.

4. **Admin** continua CRUD em `themes_catalog` (já correto).

5. **Deprecar** `/themes` + `questions.temas` para classificação IA; unificar em `/themes-assign` + `ai_question_themes`.

6. **Não** precisa de busca vetorial com ~300–500 temas; lista agrupada no prompt é suficiente. Se o prompt estourar limites no futuro, filtrar por área da questão ou top-K — fora do escopo mínimo.

---

## Checklist de implementação

### 1. Runtime / utilitário
- [ ] Exportar `buildDeCSQuestionText` em `lib/decs-pipeline.ts` (ou helper local compartilhado)
- [ ] Restaurar `resolveSystemInstruction` em `getRuntimeAgent`

### 2. Defaults / agente
- [ ] Remover duplicata de `question_themes_assigner` em `ai-agents-defaults.ts`
- [ ] Default único: schema nested + `{{QUESTAO}}` / `{{LISTA_TEMAS}}` / `{{RESPOSTA_CORRETA}}`
- [ ] Atualizar prompt em `ai_agents` (Editor ou script de sync) para o default novo — **sem** sobrescrever acidentalmente com o flat antigo no seed

### 3. Injeção no agente
- [ ] Em `classifyQuestionThemes`: agrupar `themes_catalog` por `tema`
- [ ] Branch de placeholders igual a `classifyQuestionHabilities`
- [ ] Payload `LISTA_TEMAS` = array agrupado

### 4. Parse + pending
- [ ] Confirmar `parseThemesAssignResult` cobre nested + flat legado
- [ ] Pending para pares fora do catálogo (já existe) — validar após mudança de prompt
- [ ] Opcional: campo `novas_temas` no JSON (como competências) — nice-to-have

### 5. Unificar APIs/UI
- [ ] Garantir detalhe da questão usa só `/themes-assign`
- [ ] Migrar lista (`questions/page.tsx`) de `/themes` → `/themes-assign` se ainda legado
- [ ] Documentar depreciação de `questions.temas` / rota `/themes`

### 6. Smoke test
- [ ] Admin: listar 537, editar 1 par
- [ ] Questão: Gerar classificação → `ai_question_themes` gravado
- [ ] Preferência por rótulos do catálogo; inventados → `themes_pending`
- [ ] Aprovar pending → reaparece no catálogo `origin=gerado`

---

## Arquivos principais

| Área | Arquivos |
|------|----------|
| Schema | `lib/taxonomy-schema.ts` |
| Agente | `lib/taxonomy-agents.ts`, `lib/ai-agent-runtime.ts`, `lib/ai-agents-defaults.ts` |
| Util | `lib/decs-pipeline.ts` (`buildDeCSQuestionText`) |
| API questão | `app/api/questions/[id]/themes-assign/route.ts`, `.../similar/route.ts` |
| Legacy | `app/api/questions/[id]/themes/route.ts` |
| API admin | `app/api/admin/themes/route.ts`, `.../pending/route.ts` |
| UI | `components/Dashboard/QuestionThemesAssignSection.tsx`, `app/dashboard/admin/temas/page.tsx` |

---

## Fora de escopo desta task

- Alterações do fluxo DeCS / validador
- Drop físico de `temas_catalogo` antes de confirmar que `themes_catalog` é completo
- RAG/embeddings sobre temas
