# MedMind

Plataforma de estudos médicos voltada para estudantes e profissionais recém-formados de medicina. A aplicação oferece organização de cases e materiais de estudo com apoio de IA.

## Tecnologias

- **Next.js 14** - Framework React
- **TypeScript** - Tipagem estática
- **SQLite** - Banco de dados
- **Tailwind CSS** - Estilização
- **JWT** - Autenticação
- **bcryptjs** - Hash de senhas

## Funcionalidades

- ✅ Landing page
- ✅ Sistema de autenticação (Login/Cadastro)
- ✅ Validação de email por link
- ✅ Recuperação de senha por email
- ✅ Dashboard com Sidebar e Topbar
- ✅ CRUD de Usuários (com controle de permissões)
- ✅ CRUD de Configurações
- ✅ Configuração de Email (SMTP) armazenada no banco de dados
- ✅ Teste de envio de email

## Instalação

1. Instale as dependências:
```bash
npm install
```

2. Crie um arquivo `.env.local` na raiz do projeto:
```
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
```

3. Execute o projeto:
```bash
npm run dev
```

4. Acesse `http://localhost:3000`

## Estrutura do Projeto

```
MedMind/
├── app/
│   ├── api/              # APIs do sistema
│   ├── dashboard/        # Páginas do dashboard
│   ├── login/            # Página de login/cadastro
│   ├── layout.tsx        # Layout principal
│   ├── page.tsx          # Landing page
│   └── globals.css       # Estilos globais
├── components/
│   └── Dashboard/        # Componentes do dashboard
├── lib/
│   ├── db.ts             # Configuração do banco de dados
│   └── auth.ts           # Funções de autenticação
└── middleware.ts         # Middleware de autenticação
```

## Banco de Dados

O banco de dados SQLite é criado automaticamente na primeira execução. O arquivo `medmind.db` será gerado na raiz do projeto.

### Tabelas

- **users**: Usuários do sistema
- **settings**: Configurações do sistema (incluindo SMTP)

## Configuração de Email

A configuração de email (SMTP) é armazenada no banco de dados, não em variáveis de ambiente. Acesse o dashboard > Configurações para configurar.

## Scripts Disponíveis

- `npm run dev` - Inicia o servidor de desenvolvimento
- `npm run build` - Cria build de produção
- `npm run start` - Inicia o servidor de produção
- `npm run lint` - Executa o linter

## Licença

Este projeto é privado.

