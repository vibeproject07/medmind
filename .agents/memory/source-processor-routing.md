---
name: Source processor routing
description: Define a separação durável entre transcrição de mídia, extração documental e status dos agentes.
---

Áudio, vídeo e YouTube devem usar Groq Whisper com preparação pelo ffmpeg. Documentos, imagens e links documentais usam o agente abrangente de extração. Um agente marcado como inativo não pode continuar referenciado por rotas da aplicação.

**Why:** Manter chaves de agentes inativos em caminhos de execução causa falhas tardias e torna o painel inconsistente com o comportamento real. Transcrição e extração também possuem requisitos e provedores diferentes.

**How to apply:** Ao criar ou alterar uma rota de fonte, associe mídia ao pipeline Groq/ffmpeg e conteúdo documental ao extrator abrangente. Atualize o catálogo de rotas do editor e acrescente uma regressão que impeça referências a agentes legados inativos.