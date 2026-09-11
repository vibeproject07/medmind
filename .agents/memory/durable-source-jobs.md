---
name: Durable source jobs
description: Regras de concorrência e retomada para processamento longo de fontes e embeddings.
---

O checkpoint de extração deve ser gravado na mesma transação que cria o run e seus chunks, condicionado ao claim atual. Escritas de vetorização devem verificar o claim, e leases longos devem ser renovados enquanto o provedor externo trabalha.

**Why:** Separar persistência e checkpoint permite que um restart perca o resultado visível; leases sem fencing deixam workers antigos sobrescreverem jobs retomados; seleção local entre filas não evita starvation entre réplicas.

**How to apply:** Use compare-and-swap por claim/run em transições, rollback se o claim for perdido, mantenha somente um run atual por fonte e coordene a escolha global de jobs no banco.