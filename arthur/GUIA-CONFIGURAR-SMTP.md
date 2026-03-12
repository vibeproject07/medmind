# 📧 Guia: Configurar SMTP para Envio de Emails

## 🔍 Problema Identificado

O sistema não consegue enviar emails de confirmação porque a configuração SMTP não está completa ou está com credenciais inválidas.

---

## ✅ Solução: Configurar SMTP

### Opção 1: Via Dashboard (Recomendado)

1. **Faça login no sistema:**
   - Acesse: http://localhost:3000/login
   - Use: `admin` / `a123456`

2. **Acesse Configurações:**
   - No menu lateral, clique em **"Configurações"**
   - OU acesse: http://localhost:3000/dashboard/settings

3. **Configure o Email SMTP:**
   - Clique em **"Configurar"** ou **"Editar"** na seção "Configuração de Email (SMTP)"
   - Preencha os campos:
     - **Host SMTP:** (ex: `smtp.gmail.com`)
     - **Porta:** (ex: `587` para Gmail)
     - **Usuário/Email:** Seu email
     - **Senha:** Sua senha ou senha de app

4. **Teste o Email:**
   - Clique em **"Testar Email"**
   - Se funcionar, você receberá um email de teste

5. **Salve:**
   - Clique em **"Salvar"**

---

## 📋 Configurações Comuns por Provedor

### Gmail

**Configuração:**
- **Host:** `smtp.gmail.com`
- **Porta:** `587` (TLS) ou `465` (SSL)
- **Usuário:** Seu email Gmail completo
- **Senha:** **Senha de App** (não sua senha normal!)

**Como criar Senha de App no Gmail:**
1. Acesse: https://myaccount.google.com/apppasswords
2. Se não aparecer, ative a **Verificação em duas etapas** primeiro
3. Selecione "App" e "Email"
4. Gere a senha de app
5. Use essa senha no campo "Senha" do SMTP

---

### Outlook/Hotmail

**Configuração:**
- **Host:** `smtp-mail.outlook.com`
- **Porta:** `587`
- **Usuário:** Seu email Outlook completo
- **Senha:** Sua senha normal

---

### Yahoo

**Configuração:**
- **Host:** `smtp.mail.yahoo.com`
- **Porta:** `587` ou `465`
- **Usuário:** Seu email Yahoo completo
- **Senha:** Sua senha normal (ou senha de app se tiver 2FA)

---

### Servidor SMTP Personalizado

Se você tem um servidor SMTP próprio:
- **Host:** Seu servidor SMTP
- **Porta:** Geralmente `587` (TLS) ou `465` (SSL)
- **Usuário:** Seu usuário SMTP
- **Senha:** Sua senha SMTP

---

## 🧪 Testar a Configuração

### Via Dashboard:
1. Após configurar, clique em **"Testar Email"**
2. Você deve receber um email de teste no endereço configurado

### Via Script:
```bash
node verificar-smtp.js
```

---

## ⚠️ Problemas Comuns

### "Erro de autenticação" (EAUTH)
- **Gmail:** Use uma **Senha de App**, não sua senha normal
- **Outros:** Verifique se a senha está correta

### "Não foi possível conectar"
- Verifique se a **porta** está correta
- Verifique se seu **firewall** não está bloqueando
- Tente a porta alternativa (587 ou 465)

### "Timeout"
- Verifique sua **conexão com internet**
- Verifique se o **host SMTP** está correto

---

## 🔧 Solução Rápida: Desabilitar Verificação de Email (Desenvolvimento)

Se você está apenas desenvolvendo e não precisa de emails reais, pode:

1. **Modificar temporariamente o código** para não exigir verificação
2. **OU** usar um serviço de email de teste como:
   - **Mailtrap** (gratuito para desenvolvimento)
   - **Ethereal Email** (gratuito)
   - **MailHog** (local)

---

## 📝 Configuração via Script (Avançado)

Se preferir configurar via script:

```bash
node configurar-smtp.js
```

Ou edite diretamente no banco de dados via DBeaver na tabela `settings`.

---

## ✅ Após Configurar

1. **Teste o envio** usando o botão "Testar Email"
2. **Tente se cadastrar novamente**
3. **Verifique sua caixa de entrada** (e spam)
4. **Clique no link de confirmação** no email

---

## 🆘 Ainda com Problemas?

1. Verifique os **logs do servidor** (terminal onde roda `npm run dev`)
2. Verifique se a **configuração está salva** no banco
3. Teste com **outro provedor de email**
4. Use um **serviço de email de teste** para desenvolvimento

---

**Dica:** Para desenvolvimento, considere usar um serviço como **Mailtrap** que captura todos os emails sem enviá-los de verdade!
