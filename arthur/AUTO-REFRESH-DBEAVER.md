# 🔄 Guia Detalhado: Auto-Refresh no DBeaver

## ⚠️ IMPORTANTE: Por que Auto-Refresh pode não funcionar?

O DBeaver **não detecta automaticamente** mudanças feitas por outros programas (como nosso código Node.js) no arquivo SQLite. Isso é uma limitação do SQLite quando usado via arquivo.

**Solução mais confiável:** Use **F5** manualmente após cada mudança.

---

## 📋 MÉTODO 1: Auto-Refresh por Tabela (Tente este primeiro)

### Passo a Passo Visual:

1. **No painel esquerdo do DBeaver**, expanda até ver suas tabelas:
   ```
   SQLite - medmind
   └── Databases
       └── main
           └── Tables
               └── users  ← Clique AQUI com botão direito
   ```

2. **Clique com BOTÃO DIREITO** na tabela `users`

3. **No menu de contexto**, procure por uma destas opções:
   - **"Properties"** (mais comum)
   - **"Propriedades"** (se estiver em português)
   - **"Edit Table"** → depois procure "Properties"
   - **"Table Properties"**

4. **Uma janela vai abrir**. Procure por:
   - Aba **"Auto-refresh"**
   - OU aba **"Refresh"**
   - OU seção **"Auto-refresh"** dentro de outra aba

5. **Marque a opção:**
   ```
   ☑ Enable auto-refresh
   ```

6. **Configure o intervalo:**
   - Intervalo: **5 segundos** (ou o que preferir)
   - Ou selecione **"On data change"** se disponível

7. **Clique em "OK" ou "Apply"**

---

## 📋 MÉTODO 2: Auto-Refresh Global (Para todas as tabelas)

### Passo a Passo:

1. **Menu superior do DBeaver:**
   - **Window** → **Preferences**
   - OU pressione `Ctrl+,` (vírgula)

2. **No painel esquerdo**, navegue até:
   ```
   DBeaver
   └── Editors
       └── Data Editor
           └── Refresh  ← Clique aqui
   ```

3. **Na área direita**, procure por:
   - ☑ **"Auto-refresh on data change"**
   - OU ☑ **"Enable auto-refresh"**

4. **Configure:**
   - **Refresh interval:** 5 segundos (ou o que preferir)
   - **Refresh on focus:** Marque se quiser atualizar ao focar na janela

5. **Clique em "Apply" e depois "OK"**

---

## 📋 MÉTODO 3: Atualização Manual (MAIS CONFIÁVEL) ⭐

### Este é o método mais confiável e recomendado:

#### Opção A: Teclado
- Pressione **F5** na janela da tabela
- OU **Ctrl+R**

#### Opção B: Menu
- Clique com **botão direito** na tabela
- Selecione **"Refresh"** ou **"Atualizar"**

#### Opção C: Barra de Ferramentas
- Procure o ícone de **refresh** (seta circular) na barra
- Clique nele

---

## 🧪 TESTE: Verificar se está funcionando

### Teste Rápido:

1. **No DBeaver**, abra a tabela `users` (View Data)

2. **Anote quantos registros** você vê (deve ter 5 agora)

3. **Execute este comando no terminal:**
   ```bash
   node atualizar-banco.js
   ```

4. **No DBeaver:**
   - Se configurou auto-refresh: **Aguarde 5-10 segundos**
   - Se não configurou: **Pressione F5**

5. **Verifique:** Deve aparecer um novo registro ou mudanças

---

## 💡 DICAS IMPORTANTES

### Por que F5 é mais confiável?
- ✅ Funciona **sempre**
- ✅ Atualiza **imediatamente**
- ✅ Não depende de configurações
- ✅ Detecta **todas** as mudanças

### Quando usar Auto-Refresh?
- Quando você está **editando diretamente no DBeaver**
- Quando quer ver mudanças de **outros usuários** (se fosse banco remoto)
- Para **monitoramento contínuo** (mas ainda pode não detectar mudanças externas)

### Limitação do SQLite:
- SQLite via arquivo **não notifica** outros programas sobre mudanças
- O DBeaver precisa **verificar manualmente** (F5) ou **periodicamente** (auto-refresh)
- Auto-refresh funciona melhor para mudanças **feitas dentro do próprio DBeaver**

---

## 🔧 SOLUÇÃO RECOMENDADA

### Workflow Sugerido:

1. **Faça mudanças no código** (Node.js, etc.)

2. **Execute o código** que modifica o banco

3. **No DBeaver, pressione F5** na tabela

4. **Veja as mudanças imediatamente**

### Script para facilitar:

Criei o arquivo `atualizar-banco.js` que você pode executar sempre que quiser testar:

```bash
node atualizar-banco.js
```

Depois, no DBeaver, pressione **F5** para ver as mudanças.

---

## 📊 Estado Atual do Banco

Após os testes, você deve ter:

- ✅ **5 usuários** (admin + 4 de teste)
- ✅ **2 empresas** (Hospital Teste + Clínica Teste)
- ✅ **1 configuração** (SMTP atualizada)
- ✅ **2 tokens** (verificação e recuperação)

---

## ❓ Ainda não conseguiu configurar?

**Não se preocupe!** Use **F5** manualmente. É:
- ✅ Mais rápido
- ✅ Mais confiável
- ✅ Mais simples
- ✅ Funciona sempre

A auto-refresh é útil, mas **não é essencial**. O importante é conseguir visualizar os dados, e o F5 faz isso perfeitamente!

---

## 📝 Resumo dos Arquivos Criados

1. **`test-db.js`** - Popula o banco com dados de teste
2. **`atualizar-banco.js`** - Adiciona/atualiza dados para testar visualização
3. **`GUIA-DBEAVER.md`** - Guia completo de uso do DBeaver
4. **`AUTO-REFRESH-DBEAVER.md`** - Este arquivo (guia de auto-refresh)
5. **`abrir-dbeaver.bat`** - Abre o explorador na pasta do banco

---

**Dica Final:** Configure um atalho mental: **"Mudou algo no banco? Pressione F5!"** 🚀
