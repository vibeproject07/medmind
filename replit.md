# MedMind

Medical study platform built with Next.js 14, TypeScript, Tailwind CSS, and JWT authentication. Uses PostgreSQL + pgvector for data storage and semantic search.

## Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Auth**: JWT (jsonwebtoken)
- **Database**: PostgreSQL 16.10 + pgvector 0.8.0 (via `pg` pool)
- **Port**: 5000 (dev server)
- **AI**: Anthropic Claude (via `gerar_comentarios.py`), Groq, Gemini
- **Embeddings**: Google `gemini-embedding-001` (3072 dims) via REST API

## Project Structure

```
app/
  api/
    auth/          - Login / register endpoints
    questions/     - CRUD for questions (+ [id])
    comentarios/   - AI commentary (import + [questionId])
    decs/          - DeCS/BVS proxy routes (search, tree)
    groq/          - Groq AI endpoint
    gemini/        - Gemini AI endpoint
    simulados/     - Simulado results API
    notas/         - Notes API
    provas/        - Provas API
    users/         - User management (admin)
  dashboard/
    questions/     - Question list + edit modal + simulado wizard
    questions/[id] - Question detail + edit inline
    simulados/     - Simulado list + novo (wizard)
    settings/      - Settings page (import comments)
    notes/         - Notes page
    profile/       - User profile
components/
  Common/
    TagAutocomplete.tsx     - Tag selection component
    DeCSAutocomplete.tsx    - DeCS/MeSH medical term autocomplete
    ImageLightbox.tsx       - Lightbox for images
    FloatingButton.tsx      - FAB component
lib/
  db.ts           - PostgreSQL pool
  jwt.ts          - JWT verify/sign
  areas-assuntos.ts - Medical areas/subjects mappings
scripts/
  gerar_comentarios.py - Generate AI comments via Claude Batches API
```

## Database Tables

- `users` — user accounts (id, email, password_hash, role, name, username)
- `questions` — question bank (id, statement, options A-E, correct_answer, explanation, tags, images, areas_conhecimento, assuntos, decs_terms, exam_*, anulada)
- `comentarios` — AI commentary per question (questao_id UNIQUE)
- `notas` — user notes
- `simulado_results` — simulado result history
- `provas` — exam metadata
- `note_questions` — junction table notes ↔ questions

## Key Features

1. **Questions**: CRUD with area/subject/tag/DeCS classification, image upload (base64)
2. **Simulados**: Wizard-based exam creation, progress persistence in localStorage, split-screen AI commentary
3. **AI Commentary**: `gerar_comentarios.py` script uses Claude Batches API; imported via `/api/comentarios/import` (JSON or CSV)
4. **DeCS Integration**: `/api/decs/search` and `/api/decs/tree` proxy routes to BVS API; `DeCSAutocomplete` component in question edit forms; `decs_terms` column in questions table
5. **Notes**: Markdown notes linked to questions
6. **Settings**: Admin import panel for AI comments (JSON/CSV)

## Environment Variables (.env.local)

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — JWT signing secret
- `GROQ_API_KEY` — Groq API key
- `GEMINI_API_KEY` — Gemini API key
- `ANTHROPIC_API_KEY` — Anthropic/Claude API key
- `DECS_API_KEY` — BVS DeCS API key (stored securely in .env.local)
- `TAVILY_API_KEY` — Tavily web search API key

## DeCS API

- Base URL: `https://api.bvsalud.org/decs/v2/`
- Auth header: `apikey: <DECS_API_KEY>`
- Endpoints: `/search-by-words`, `/get-tree`
- Response: JSON with `objects[0].decsws_response.record_list.record[]`
- Term field: `descriptor_list[].descriptor` (filter by `attr.lang === 'pt'` or `'pt-br'`)
- Hierarchical codes: `tree_id_list[].tree_id` (array)
- Routes require user JWT authentication

## Vector Search Architecture

### pgvector (local / fallback)
- Extension: `pgvector 0.8.0` on PostgreSQL 16.10
- Column: `questions.embedding vector(3072)` (cosine similarity)
- Index: HNSW `questions_embedding_hnsw_idx` (auto-created after batch)
- Lib: `lib/embeddings.ts` — `generateEmbedding`, `buildQuestionText`, `findSimilarQuestions`, `semanticSearchQuestions`

### Pinecone (managed / primary when key set)
- SDK: `@pinecone-database/pinecone` v7.2.0
- Lib: `lib/pinecone.ts` — `upsertQuestionEmbedding`, `queryPineconeSimilar`, `getPineconeIndexStats`
- Index: `medmind-questions` (auto-created on first use) — 3072 dims, cosine, serverless AWS us-east-1
- Config: `PINECONE_API_KEY` + `PINECONE_INDEX_NAME` in `.env.local`
- Vector ID format: `q-{questionId}`

### Routing logic
- When `PINECONE_API_KEY` is set → Pinecone is primary; pgvector serves as local cache
- When not set → pgvector only fallback

### Embedding model
- `gemini-embedding-001` (3072 dims) via Google REST API `v1beta`
- **taskType**: questions indexed with `RETRIEVAL_DOCUMENT`; search queries use `RETRIEVAL_QUERY`
- **Migration note**: existing embeddings were generated without taskType (SEMANTIC_SIMILARITY).
  To activate `RETRIEVAL_QUERY` for searches, first re-run the batch script (which now uses `RETRIEVAL_DOCUMENT`),
  then set `EMBEDDING_TASK_TYPE=retrieval` in `.env.local` and restart.

### Search pipeline (semantic-search route)
1. Load `busca_vetorial` AI agent system prompt from DB (fallback to built-in default)
2. Expand the user's short query into rich medical text via Gemini 2.5 Flash (10 s timeout)
3. Embed the expanded text (SEMANTIC_SIMILARITY now; RETRIEVAL_QUERY after re-embedding+env var)
4. Run halfvec cosine search against `questions.embedding` HNSW index
- Expansion fallback: if LLM times out or fails, raw query is embedded directly
- `expanded` field in response indicates whether expansion was applied

### API Routes
- `GET  /api/questions/[id]/embedding` — check embedding status
- `POST /api/questions/[id]/embedding` — generate (RETRIEVAL_DOCUMENT) + save to pgvector + Pinecone (admin)
- `GET  /api/questions/[id]/similar` — similar questions (Pinecone → pgvector fallback)
- `GET  /api/questions/semantic-search?q=...` — semantic search with AI query expansion
- `GET  /api/pinecone/status` — index stats (admin only)
- `GET  /api/admin/embed-batch` — live progress (pgvector count + Pinecone vector count)
- `POST /api/admin/embed-batch` — start batch script as detached background process (admin)

### Batch script
- `scripts/batch-embed-questions.mjs` — embeds all questions with `RETRIEVAL_DOCUMENT`, upserts to pgvector + Pinecone
- Options: `--limit N --concurrency 3 --delay 350 --no-resume --pinecone-batch 100`
- Run from API: `POST /api/admin/embed-batch` (uses `--env-file=.env.local` internally)
- Run from terminal: `node --env-file=.env.local scripts/batch-embed-questions.mjs --concurrency 5 --delay 300`
- After run: set `EMBEDDING_TASK_TYPE=retrieval` in `.env.local` and restart to activate RETRIEVAL_QUERY mode

### AI Agent: busca_vetorial
- Key: `busca_vetorial` in `ai_agents` table / `lib/ai-agents-defaults.ts`
- Role: **called automatically** by the semantic search route to expand queries before embedding
- Customizable via the AI agents admin panel (key: `busca_vetorial`)

## DeCS Classification Pipeline

### V1 pipeline (current default)
- Agent `decs_classifier` (Etapa 1) → returns `{primary, secondary}` string themes
- `runDeCSPipeline()` in `lib/decs-pipeline.ts` → vector/text search + BVS API fallback
- Agent `decs_validator` / `VALIDATION_PROMPT` (Etapa 3) → validates candidates
- **Enriched (2025-04)**: candidates now include `scope_note`, `name_en` from `decs_descriptors`; validation prompt uses these for better filtering
- Endpoint: `POST /api/questions/[id]/decs-ai`
- Saved to: `questions.ai_decs_descriptors`

### V2 pipeline (RAG-enhanced, for A/B testing)
- Agent `decs_indexer_v2` → deep semantic interpretation (indexer mindset), same output `{primary, secondary}`
- `runDeCSPipelineV2()` in `lib/decs-pipeline-v2.ts`:
  1. Semantic extraction (decs_indexer_v2)
  2. Per-concept search: vector (local) → text ILIKE fallback → BVS API last resort
  3. Enrich from `decs_descriptors` (scope_note, name_en)
  4. Agent `decs_selector_v2` selects best candidate per concept with full context
  5. Resolve parents/children from `tree_numbers` in DB
- Endpoint: `POST /api/questions/[id]/decs-ai-v2`
- Saved to: `questions.ai_decs_v2`
- UI: "Gerar v2 (RAG)" button in question detail page; expandable results with hierarchy

### DeCS database
- Table: `decs_descriptors` — 35,033 rows
- Columns: `ui`, `name_pt`, `name_en`, `scope_note`, `entry_terms` (JSONB), `tree_numbers` (JSONB), `embedding`
- 93/35,033 descriptors have embeddings (run `scripts/embed-decs-descriptors.mjs` for full coverage)

### UI
- Semantic search bar (violet gradient) on questions list page
- "Questões Similares" section on question detail page
- Admin vectorization dashboard: `/dashboard/admin/vectorization` — live progress for both backends, function references, batch controls

## Development Preferences

- **Mudanças visuais / layout frontend não devem reiniciar o servidor.** Next.js já faz hot-reload automático — o servidor (`npm run dev`) só deve ser reiniciado quando houver mudança em configuração, variáveis de ambiente, dependências (`package.json`) ou arquivos que rodam exclusivamente no servidor (middleware, route handlers que usam módulos Node).
- **A sessão do usuário não deve ser perdida após mudanças simples de layout.** O token JWT fica em `localStorage` — mudanças de componentes React puram não o afetam. Evitar qualquer ação que limpe o `localStorage` ou force um logout durante ajustes de UI.

## Notes

- `lucide-react`: `MessageSquareText` does NOT exist — use `MessageSquare`
- Pre-existing TS error in `simulados/novo/page.tsx` line ~257 (duplicate `if` check)
- All JSON fields (tags, images, areas_conhecimento, assuntos, decs_terms) stored as TEXT in PostgreSQL, parsed on read
- Semantic search only works on questions that have an embedding — run the batch script to populate all
