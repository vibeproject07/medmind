---
name: NLP workload bounds
description: Regra para manter tokenização e respostas NLP limitadas em memória e tamanho.
---

O tokenizer deve rejeitar conteúdo acima dos limites de caracteres, tokens ou frases e exigir chunking, em vez de elevar esses limites para acomodar uma fonte isolada. Respostas detalhadas devem permanecer paginadas e sinalizar continuação ou truncamento.

**Why:** Mesmo uma entrada textual aparentemente aceitável pode gerar milhões de objetos Python e respostas JSON muito maiores que a fonte, esgotando memória ou limites do proxy.

**How to apply:** Ao ampliar suporte a documentos e transcrições longas, divida o texto em chunks com offsets globais estáveis e combine os resultados. Não remova paginação nem aumente limites sem teste de pior caso.