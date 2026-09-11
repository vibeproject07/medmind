---
name: Read-only diagnostics
description: Regra para manter validadores e health checks sem efeitos colaterais persistentes.
---

Rotas de validação e diagnóstico devem executar somente leituras, verificações de configuração e health checks. Não devem chamar inicializadores de schema que também façam DDL, migrações ou backfills.

**Why:** Uma ação apresentada ao usuário como “validar” pode alterar dados persistidos sem que ele espere ou autorize essa alteração.

**How to apply:** Antes de reutilizar helpers de inicialização em endpoints diagnósticos, verifique se eles têm writes. Execute preparação de schema no startup, migrations ou fluxos de processamento, nunca no clique de validação.