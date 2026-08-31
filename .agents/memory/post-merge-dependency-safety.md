---
name: Post-merge dependency safety
description: Regra operacional para sincronizar dependências com o firewall de pacotes do Replit após merges.
---

O setup pós-merge deve usar instalação incremental e não destrutiva, evitando `npm ci`.

**Why:** O firewall pode bloquear uma dependência vulnerável durante o download. Como `npm ci` remove `node_modules` primeiro, uma única rejeição pode deixar todo o ambiente sem dependências e derrubar builds posteriores.

**How to apply:** Prefira `npm install --prefer-offline --no-audit --no-fund`. Quando o firewall bloquear um pacote, atualize o pacote direto ou aplique uma versão transitiva corrigida via override; não ignore nem contorne o firewall.