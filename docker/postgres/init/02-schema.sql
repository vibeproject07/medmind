-- Schema local mínimo para o dump exports/questions-20.sql + login do app.
-- Colunas extras de questions acompanham o dump de produção (sem embedding).

CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'regular' CHECK (role IN ('admin', 'manager', 'regular')),
  company_id INTEGER REFERENCES companies(id),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  email_verified INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS provas (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  banca TEXT,
  regiao TEXT,
  ano TEXT,
  tipo TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  content_fingerprint TEXT
);

CREATE TABLE IF NOT EXISTS questions (
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
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  ai_decs_descriptors TEXT,
  ai_decs_v2 TEXT,
  ai_decs_classified_text TEXT,
  images_meta TEXT,
  competencias TEXT,
  temas TEXT,
  ai_habilities TEXT,
  ai_question_themes TEXT,
  decs_validation_meta JSONB,
  input_tokens INTEGER,
  output_tokens INTEGER,
  ai_token_usage JSONB
);

CREATE INDEX IF NOT EXISTS idx_questions_prova_id ON questions(prova_id);

CREATE TABLE IF NOT EXISTS notes (
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
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
