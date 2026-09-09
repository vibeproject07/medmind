---
name: Backend processing metadata
description: Separação durável entre conteúdo exibido nas notas e artefatos internos de extração, NLP e busca vetorial.
---

Persistir extração, tokenização, chunking e embeddings como metadados internos de processamento, sem incorporá-los ao conteúdo que o usuário edita ou visualiza. Chunks válidos são vetorizados; blocos descartados são preservados para auditoria, mas não recebem embedding.

**Why:** O conteúdo da nota pode ser editado ou resumido para apresentação, enquanto o backend precisa manter proveniência, limites de sentenças, versões do pipeline, hashes e vetores reproduzíveis.

**How to apply:** Novos classificadores e buscas semânticas devem consumir os chunks persistidos e respeitar `user_id` e os vínculos opcionais com nota/fonte. Preserve status e erros por etapa para permitir reprocessamento seguro.