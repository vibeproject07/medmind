# 📊 Guia Completo: DBeaver + MedMind Database

## 🔗 Conectar ao Banco de Dados

### Caminho do Banco:
```
C:\Users\Lenovo\Downloads\vibeproject07 - medmind\projetoGIT\medmind\medmind.db
```

### Passos para Conectar:
1. Abra o DBeaver
2. **Database** → **New Database Connection** (ou `Ctrl+Shift+N`)
3. Selecione **SQLite**
4. No campo **Path**, clique em **Browse** e selecione o arquivo `medmind.db`
5. Clique em **Test Connection**
6. Se aparecer "Connected", clique em **Finish**

---

## 🔄 CONFIGURAR ATUALIZAÇÃO AUTOMÁTICA (Auto-Refresh)

### Método 1: Auto-Refresh por Tabela (Recomendado)

#### Passo a Passo Detalhado:

1. **Conecte ao banco** (se ainda não conectou)

2. **Expanda a estrutura no painel esquerdo:**
   ```
   SQLite - medmind
   └── Databases
       └── main
           └── Tables
               ├── users
               ├── settings
               ├── companies
               └── email_tokens
   ```

3. **Clique com o BOTÃO DIREITO na tabela** que você quer monitorar (ex: `users`)

4. **No menu que aparece, procure por:**
   - **"Properties"** ou **"Propriedades"** (pode estar no final do menu)
   - OU procure por **"Edit Table"** → depois vá em **"Properties"**

5. **Na janela de Properties que abrir:**
   - Procure pela aba **"Auto-refresh"** ou **"Auto-atualizar"**
   - Se não encontrar, procure por **"Refresh"** ou **"Atualização"**

6. **Marque a opção:**
   - ✅ **"Enable auto-refresh"** ou **"Habilitar auto-atualização"**
   - Defina o **intervalo** (ex: 5 segundos, 10 segundos)

7. **Clique em "OK" ou "Apply"**

---

### Método 2: Auto-Refresh Global (Para todas as tabelas)

1. **Menu superior:** **Window** → **Preferences** (ou `Ctrl+,`)

2. **No painel esquerdo, navegue até:**
   ```
   DBeaver
   └── Editors
       └── Data Editor
           └── Refresh
   ```

3. **Marque:**
   - ✅ **"Auto-refresh on data change"**
   - Defina o **intervalo** (ex: 5 segundos)

4. **Clique em "Apply" e depois "OK"**

---

### Método 3: Atualização Manual (Mais Confiável)

Se a auto-refresh não funcionar bem, use atualização manual:

#### Atalhos de Teclado:
- **F5** - Atualiza a visualização atual
- **Ctrl+R** - Refresh (mesma função do F5)

#### Menu:
- Clique com **botão direito** na tabela → **"Refresh"** ou **"Atualizar"**
- Ou no menu superior: **View** → **Refresh**

---

## 📋 Visualizar Dados

### Ver Dados de uma Tabela:
1. Clique com **botão direito** na tabela (ex: `users`)
2. Selecione **"View Data"** ou **"Ver Dados"**
3. Os dados aparecerão em formato de tabela

### Editar Dados:
1. Com a tabela aberta, clique em **"Edit"** (modo de edição)
2. Faça suas alterações
3. Clique em **"Save"** para salvar

### Executar SQL:
1. Abra o **SQL Editor**: `Ctrl+\` ou ícone de SQL na barra
2. Digite sua query:
   ```sql
   SELECT * FROM users;
   SELECT * FROM companies;
   ```
3. Execute: `Ctrl+Enter` ou botão "Execute"

---

## 🧪 Teste Realizado

O banco foi populado com dados de teste:

- ✅ **4 usuários** (incluindo admin)
- ✅ **1 empresa** (Hospital Teste)
- ✅ **1 configuração** (SMTP)
- ✅ **2 tokens** (verificação e recuperação)

### Dados Inseridos:

**Usuários:**
- Admin (admin/admin) - Role: admin
- Dr. João Silva (joao.silva@medmind.com) - Role: regular
- Dra. Maria Santos (maria.santos@medmind.com) - Role: regular
- Gerente Teste (gerente@medmind.com) - Role: manager

**Empresa:**
- Hospital Teste (ID: 1)

**Tokens:**
- 1 token de verificação (ativo)
- 1 token de recuperação (usado)

---

## 💡 Dicas Importantes

1. **Sempre dê F5 após fazer alterações** no código que modifica o banco
2. **O DBeaver pode não detectar mudanças externas automaticamente** - use F5
3. **Para ver mudanças em tempo real**, configure auto-refresh com intervalo curto (5-10 segundos)
4. **Se auto-refresh não funcionar**, use F5 manualmente - é mais confiável

---

## 🔧 Solução de Problemas

### Auto-refresh não está funcionando?
- Use **F5** manualmente (mais confiável)
- Verifique se marcou a opção corretamente
- Tente reiniciar o DBeaver

### Não consigo editar dados?
- Certifique-se de estar em modo "Edit" (botão Edit na barra)
- Verifique se tem permissões de escrita no arquivo

### Conexão não funciona?
- Verifique se o caminho do arquivo está correto
- Certifique-se de que o arquivo `medmind.db` existe
- Tente fechar e reabrir a conexão

---

## 📝 Scripts Úteis

- `test-db.js` - Popula o banco com dados de teste
- `abrir-dbeaver.bat` - Abre o explorador na pasta do banco

Para executar o teste novamente:
```bash
node test-db.js
```
