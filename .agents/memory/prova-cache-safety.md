---
name: Prova cache safety
description: Regra para evitar que o cache leve de provas apague imagens ao editar questões.
---

O cache de provas pode omitir imagens para não exceder o limite de armazenamento local e deve ser tratado apenas como uma visualização temporária. Não permita iniciar ou salvar edições de questões enquanto a resposta atualizada da API da prova não tiver chegado.

**Why:** Uma lista de imagens vazia no cache significa “dados não carregados”, não “questão sem imagens”. Persistir essa lista apagaria imagens reais.

**How to apply:** Ao acrescentar novos campos omitidos do cache ou novos fluxos de edição dentro da prova, bloqueie a mutação até que os dados autoritativos estejam disponíveis ou busque explicitamente os dados completos do item.