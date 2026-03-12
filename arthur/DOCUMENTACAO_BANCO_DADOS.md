# Documentação - Dados Salvos no Banco de Dados

## Estrutura do Banco de Dados

O sistema utiliza SQLite com o arquivo `medmind.db` na raiz do projeto.

---

## Tabelas e Dados Salvos

### 1. **users** (Usuários)

#### Colunas:
- `id` (INTEGER, PRIMARY KEY, AUTOINCREMENT)
- `name` (TEXT, NOT NULL) - Nome do usuário
- `username` (TEXT, UNIQUE) - Username único (opcional)
- `email` (TEXT, UNIQUE, NOT NULL) - Email único
- `password` (TEXT, NOT NULL) - Senha criptografada com bcrypt
- `role` (TEXT, DEFAULT 'regular') - Papel: 'admin', 'manager' ou 'regular'
- `company_id` (INTEGER) - ID da empresa (opcional, para managers)
- `email_verified` (INTEGER, DEFAULT 0) - 0 = não verificado, 1 = verificado
- `academic_status` (TEXT) - Status acadêmico (ex: 'student', 'generalist', 'resident', 'specialist', 'graduate')
- `academic_period` (INTEGER) - Período acadêmico (1-12, apenas para estudantes)
- `institution` (TEXT) - Instituição de ensino (apenas para estudantes)
- `teaching_methodology` (TEXT) - Metodologia de ensino preferida
- `created_at` (DATETIME, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (DATETIME, DEFAULT CURRENT_TIMESTAMP)

#### Operações que salvam dados:

**POST /api/auth/register** (Cadastro público:
- name, username, email, password
- academic_status, academic_period, institution, teaching_methodology (opcionais)
- role sempre 'regular'
- email_verified = 0
- created_at e updated_at automáticos

**POST /api/users** (Criação por admin/manager):
- name, username, email, password, role, company_id
- created_at e updated_at automáticos

**PUT /api/users/[id]** (Atualização por admin/manager):
- name, username, email, role, company_id
- password (opcional, se fornecido)
- updated_at = CURRENT_TIMESTAMP

**PUT /api/auth/reset-password** (Redefinição de senha):
- password (atualizado)

**GET /api/auth/verify-email** (Verificação de email):
- email_verified = 1

---

### 2. **email_tokens** (Tokens de Email)

#### Colunas:
- `id` (INTEGER, PRIMARY KEY, AUTOINCREMENT)
- `user_id` (INTEGER, NOT NULL) - ID do usuário
- `token` (TEXT, UNIQUE, NOT NULL) - Token único
- `type` (TEXT, NOT NULL) - Tipo: 'email_verification' ou 'password_reset'
- `expires_at` (DATETIME, NOT NULL) - Data de expiração
- `used` (INTEGER, DEFAULT 0) - 0 = não usado, 1 = usado
- `created_at` (DATETIME, DEFAULT CURRENT_TIMESTAMP)

#### Operações que salvam dados:

**POST /api/auth/register** (Token de verificação de email):
- user_id, token, type='email_verification', expires_at (24 horas)

**POST /api/auth/forgot-password** (Token de recuperação):
- user_id, token, type='password_reset', expires_at (1 hora)

---

### 3. **companies** (Empresas)

#### Colunas:
- `id` (INTEGER, PRIMARY KEY, AUTOINCREMENT)
- `name` (TEXT, NOT NULL) - Nome da empresa
- `created_at` (DATETIME, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (DATETIME, DEFAULT CURRENT_TIMESTAMP)

#### Operações que salvam dados:
- Atualmente não há endpoint POST para criar empresas (apenas leitura)

---

### 4. **settings** (Configurações)

#### Colunas:
- `id` (INTEGER, PRIMARY KEY, AUTOINCREMENT)
- `key` (TEXT, UNIQUE, NOT NULL) - Chave da configuração
- `value` (TEXT, NOT NULL) - Valor (JSON string)
- `description` (TEXT) - Descrição da configuração
- `created_at` (DATETIME, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (DATETIME, DEFAULT CURRENT_TIMESTAMP)

#### Operações que salvam dados:

**PUT /api/settings/email_smtp** (Configuração SMTP):
- key = 'email_smtp'
- value = JSON.stringify({ host, port, user, password })
- description = 'Configuração de SMTP para envio de emails'
- updated_at = CURRENT_TIMESTAMP

**Inicialização automática:**
- Ao criar o banco, insere configuração padrão vazia de email_smtp

---

### 5. **notes** (Notas)

#### Colunas:
- `id` (INTEGER, PRIMARY KEY, AUTOINCREMENT)
- `user_id` (INTEGER, NOT NULL) - ID do usuário que criou
- `title` (TEXT, NOT NULL) - Título da nota
- `description` (TEXT, NOT NULL) - Descrição/conteúdo
- `tags` (TEXT) - Array JSON de tags
- `images` (TEXT) - Array JSON de imagens (base64)
- `created_at` (DATETIME, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (DATETIME, DEFAULT CURRENT_TIMESTAMP)

#### Operações que salvam dados:

**POST /api/notes** (Criação de nota):
- user_id (do token JWT)
- title, description
- tags (array convertido para JSON string)
- images (array de base64 convertido para JSON string)
- created_at e updated_at automáticos

**PUT /api/notes/[id]** (Atualização de nota):
- title, description
- tags (array convertido para JSON string)
- images (array de base64 convertido para JSON string)
- updated_at = CURRENT_TIMESTAMP

**DELETE /api/notes/[id]** (Exclusão:
- Remove a nota do banco (CASCADE remove associações em note_questions)

---

### 6. **questions** (Questões)

#### Colunas:
- `id` (INTEGER, PRIMARY KEY, AUTOINCREMENT)
- `statement` (TEXT, NOT NULL) - Enunciado da questão
- `option_a` (TEXT, NOT NULL) - Alternativa A
- `option_b` (TEXT, NOT NULL) - Alternativa B
- `option_c` (TEXT) - Alternativa C (opcional)
- `option_d` (TEXT) - Alternativa D (opcional)
- `option_e` (TEXT) - Alternativa E (opcional)
- `correct_answer` (TEXT, NOT NULL) - Resposta correta: 'A', 'B', 'C', 'D' ou 'E'
- `explanation` (TEXT) - Explicação da resposta (opcional)
- `tags` (TEXT) - Array JSON de tags
- `images` (TEXT) - Array JSON de imagens (base64)
- `created_at` (DATETIME, DEFAULT CURRENT_TIMESTAMP)
- `updated_at` (DATETIME, DEFAULT CURRENT_TIMESTAMP)

#### Operações que salvam dados:

**POST /api/questions** (Criação de questão - apenas admin):
- statement, option_a, option_b (obrigatórios)
- option_c, option_d, option_e (opcionais)
- correct_answer (obrigatório, deve ser uma das alternativas preenchidas)
- explanation (opcional)
- tags (array convertido para JSON string)
- images (array de base64 convertido para JSON string)
- created_at e updated_at automáticos

**PUT /api/questions/[id]** (Atualização de questão - apenas admin):
- statement, option_a, option_b, correct_answer (obrigatórios)
- option_c, option_d, option_e (opcionais)
- explanation (opcional)
- tags (array convertido para JSON string)
- images (array de base64 convertido para JSON string)
- updated_at = CURRENT_TIMESTAMP

**DELETE /api/questions/[id]** (Exclusão - apenas admin):
- Remove a questão do banco (CASCADE remove associações em note_questions)

---

### 7. **note_questions** (Associação Nota-Questão)

#### Colunas:
- `id` (INTEGER, PRIMARY KEY, AUTOINCREMENT)
- `note_id` (INTEGER, NOT NULL) - ID da nota
- `question_id` (INTEGER, NOT NULL) - ID da questão
- `created_at` (DATETIME, DEFAULT CURRENT_TIMESTAMP)
- UNIQUE(note_id, question_id) - Evita duplicatas

#### Operações que salvam dados:

**POST /api/notes** (Criação de nota com questões):
- Se question_ids for fornecido no body, cria associações
- Insere em note_questions: note_id, question_id

**POST /api/notes/[id]/questions** (Associar questões a uma nota):
- Remove todas as associações existentes (DELETE)
- Insere novas associações baseadas no array question_ids fornecido
- Valida se as questões existem antes de associar

---

## Dados NÃO Salvos no Banco de Dados

### Resultados de Simulados
- **Localização**: `localStorage` do navegador (chave: `'simulateResults'`)
- **Estrutura**:
  ```json
  {
    "id": number,
    "total_questions": number,
    "correct_answers": number,
    "percentage": number,
    "tags": string[],
    "created_at": string,
    "user_id": number,
    "user_name": string,
    "user_username": string,
    "user_email": string
  }
  ```
- **Motivo**: Armazenamento temporário no frontend

### Rascunhos de Notas
- **Localização**: `localStorage` do navegador (chave: `'draftNote'`)
- **Estrutura**: Dados do formulário de criação de nota (title, description, tags, images)
- **Motivo**: Salvamento temporário para não perder dados ao navegar

### Questões Selecionadas Temporariamente
- **Localização**: `localStorage` do navegador (chave: `'selectedQuestionIds'`)
- **Estrutura**: Array de IDs de questões
- **Motivo**: Seleção temporária antes de salvar a nota

---

## Índices Criados

Para otimização de consultas:

1. **email_tokens**:
   - `idx_email_tokens_token` (token)
   - `idx_email_tokens_user_id` (user_id)

2. **notes**:
   - `idx_notes_user_id` (user_id)
   - `idx_notes_created_at` (created_at)

3. **note_questions**:
   - `idx_note_questions_note_id` (note_id)
   - `idx_note_questions_question_id` (question_id)

4. **questions**:
   - `idx_questions_created_at` (created_at)

---

## Dados Iniciais (Seed)

### Usuário Admin Padrão
- **Email**: 'admin'
- **Username**: 'admin'
- **Senha**: 'a123456' (criptografada)
- **Role**: 'admin'
- **Email verificado**: Sim (email_verified = 1)

### Configuração SMTP Padrão
- **Key**: 'email_smtp'
- **Value**: `{"host":"","port":"","user":"","password":""}`
- **Description**: 'Configuração de SMTP para envio de emails'

---

## Observações Importantes

1. **Senhas**: Todas as senhas são criptografadas com bcrypt antes de serem salvas
2. **JSON Storage**: Tags e imagens são armazenadas como strings JSON no banco
3. **Timestamps**: created_at e updated_at são gerenciados automaticamente pelo SQLite
4. **CASCADE**: Deletar um usuário ou nota remove automaticamente registros relacionados (email_tokens, note_questions)
5. **Validações**: 
   - Emails e usernames devem ser únicos
   - Roles válidos: 'admin', 'manager', 'regular'
   - Respostas corretas devem ser uma das alternativas preenchidas
6. **Permissões**: 
   - Apenas admin pode criar/editar/excluir questões
   - Apenas admin/manager podem criar/editar usuários
   - Usuários regulares só veem suas próprias notas
