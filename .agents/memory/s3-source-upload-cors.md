---
name: S3 source upload CORS
description: Regra externa do bucket necessária para uploads diretos de fontes pelo navegador.
---

Uploads diretos de fontes dependem da regra CORS identificada como `MedMindSourceUploads`. Preserve todas as outras regras do bucket e acrescente à regra dedicada cada origem real usada pelo aplicativo.

**Why:** Sem essa regra, o POST assinado pode chegar ao S3, mas o navegador recebe status 0 e dispara erro de rede/CORS porque a resposta não inclui `Access-Control-Allow-Origin`.

**How to apply:** Ao preparar um upload, normalize a origem HTTP(S) da requisição, mescle-a sem duplicação na regra dedicada e permita `POST` com os cabeçalhos do formulário assinado. Não substitua regras CORS de outros consumidores.