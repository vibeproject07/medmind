-- MedMind - Schema PostgreSQL (Neon/Replit)
-- Recria todas as tabelas. Execute com: psql $DATABASE_URL -f schema.sql
-- ou use o script: node scripts/neon/seed.js

-- pgvector must be enabled before any table that uses the vector type
CREATE EXTENSION IF NOT EXISTS vector;

-- Remover tabelas na ordem inversa de dependência (FK)
DROP TABLE IF EXISTS note_questions;
DROP TABLE IF EXISTS email_tokens;
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS questions;
DROP TABLE IF EXISTS provas;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS companies;

-- companies (sem FK)
CREATE TABLE companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- users (FK companies)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'regular' CHECK (role IN ('admin', 'manager', 'regular')),
  company_id INTEGER REFERENCES companies(id),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  email_verified INTEGER DEFAULT 0,
  academic_status TEXT,
  academic_period INTEGER,
  institution TEXT,
  teaching_methodology TEXT,
  residency_status TEXT,
  interests_tags TEXT,
  residency_name TEXT,
  residency_year TEXT,
  wants_new_residency_exam TEXT,
  next_residency_interests TEXT,
  specialty_area TEXT,
  wants_another_residency TEXT,
  intended_residency TEXT,
  wants_residency TEXT,
  intended_residency_generalist TEXT,
  has_residency TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- settings
CREATE TABLE settings (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- email_tokens (FK users)
CREATE TABLE email_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('email_verification', 'password_reset')),
  expires_at TIMESTAMPTZ NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_tokens_token ON email_tokens(token);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user_id ON email_tokens(user_id);

-- provas (independente)
CREATE TABLE provas (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  banca TEXT,
  regiao TEXT,
  ano TEXT,
  tipo TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_provas_created_at ON provas(created_at);
-- Assinatura da sequência de questões (dedup por conteúdo, não só por nome)
ALTER TABLE provas ADD COLUMN IF NOT EXISTS content_fingerprint TEXT;
CREATE INDEX IF NOT EXISTS idx_provas_content_fingerprint
  ON provas(content_fingerprint) WHERE content_fingerprint IS NOT NULL;

-- notes (FK users)
CREATE TABLE notes (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  tags TEXT,
  images TEXT,
  areas_conhecimento TEXT,
  assuntos TEXT,
  fontes_resumo_melhorado TEXT,
  fontes_resumo_original TEXT,
  fontes_arquivos TEXT,
  embedding vector(3072),
  decs_terms JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at);
-- pgvector 0.8+: halfvec cast for HNSW on dims > 2000
CREATE INDEX IF NOT EXISTS notes_embedding_hnsw_idx ON notes USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops) WHERE embedding IS NOT NULL;

-- questions (FK provas opcional)
CREATE TABLE questions (
  id SERIAL PRIMARY KEY,
  statement TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT,
  option_d TEXT,
  option_e TEXT,
  correct_answer TEXT NOT NULL CHECK (correct_answer IN ('A', 'B', 'C', 'D', 'E')),
  explanation TEXT,
  tags TEXT,
  images TEXT,
  exam_year INTEGER,
  exam_board TEXT,
  exam_institution TEXT,
  exam_region TEXT,
  exam_type TEXT,
  prova_id INTEGER REFERENCES provas(id),
  numero_na_prova INTEGER,
  areas_conhecimento TEXT,
  assuntos TEXT,
  anulada BOOLEAN DEFAULT FALSE,
  decs_terms TEXT,
  embedding vector(3072),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_questions_created_at ON questions(created_at);
CREATE INDEX IF NOT EXISTS idx_questions_prova_id ON questions(prova_id);
-- pgvector 0.8+: use halfvec cast for HNSW on dimensions > 2000
CREATE INDEX IF NOT EXISTS questions_embedding_hnsw_idx ON questions USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops) WHERE embedding IS NOT NULL;

-- note_questions (FK notes, questions)
CREATE TABLE note_questions (
  id SERIAL PRIMARY KEY,
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(note_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_note_questions_note_id ON note_questions(note_id);
CREATE INDEX IF NOT EXISTS idx_note_questions_question_id ON note_questions(question_id);

-- decs_descriptors (DeCS 2026 — 35,034 descritores com pgvector cosine)
-- Importar: node --env-file=.env.local scripts/import-decs-xml.mjs
-- Vetorizar: node --env-file=.env.local scripts/embed-decs-descriptors.mjs
CREATE TABLE IF NOT EXISTS decs_descriptors (
  id               SERIAL PRIMARY KEY,
  ui               TEXT    NOT NULL,
  name_pt          TEXT    NOT NULL DEFAULT '',
  name_en          TEXT    NOT NULL DEFAULT '',
  descriptor_class TEXT    NOT NULL DEFAULT '1',
  scope_note       TEXT    NOT NULL DEFAULT '',
  entry_terms      JSONB   NOT NULL DEFAULT '[]'::jsonb,
  tree_numbers     JSONB   NOT NULL DEFAULT '[]'::jsonb,
  see_related      JSONB   NOT NULL DEFAULT '[]'::jsonb,
  qualifiers       JSONB   NOT NULL DEFAULT '[]'::jsonb,
  date_established TEXT,
  embedding        vector(3072),
  created_at       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS decs_descriptors_ui_idx ON decs_descriptors(ui);
CREATE INDEX IF NOT EXISTS decs_descriptors_name_pt_idx ON decs_descriptors USING gin(to_tsvector('portuguese', name_pt));
-- pgvector 0.8+: use halfvec cast for HNSW on dimensions > 2000
CREATE INDEX IF NOT EXISTS decs_descriptors_embedding_hnsw_idx ON decs_descriptors USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops) WHERE embedding IS NOT NULL;

-- content_links: pré-computed semantic similarity pairs
-- Batch: node --env-file=.env.local scripts/compute-similarities.mjs
CREATE TABLE IF NOT EXISTS content_links (
  id          SERIAL PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('question', 'note')),
  source_id   INTEGER NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('question', 'note')),
  target_id   INTEGER NOT NULL,
  similarity  FLOAT NOT NULL,
  computed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_type, source_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS content_links_source_idx ON content_links(source_type, source_id);
CREATE INDEX IF NOT EXISTS content_links_target_idx ON content_links(target_type, target_id);
