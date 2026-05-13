# Estrutura do projeto

- **Gerado em:** 2026-05-13T21:33:09.623Z
- **Raiz:** `/home/runner/workspace`

## Pastas excluídas da listagem

Para manter o documento útil, não entram na árvore nem na lista plana:

- `node_modules/`
- `.git/`
- `.next/`
- `artifacts/`
- `.cache/`
- `.local/`
- `.pythonlibs/`

## Totais (após exclusões)

- Arquivos: **392**
- Pastas: **104**
- Linhas na lista plana: **496**

## Árvore (texto)

```
workspace/
  .agents/
    agent_assets_metadata.toml
  .canvas/
    assets/
      asset_-1844010104.png
  .config/
    .vscode-server/
    npm/
      node_global/
        lib/
  .env.example
  .env.local
  .gitattributes
  .gitignore
  .replit
  adicionar-tag-ciclo-basico.js
  app/
    api/
      admin/
        decs-batch-test/
          route.ts
        decs-diagnose/
          route.ts
        embed-batch/
          route.ts
        embed-decs/
          route.ts
        embed-notes/
          route.ts
      ai-agents/
        [key]/
          route.ts
        route.ts
      auth/
        forgot-password/
          route.ts
        login/
          route.ts
        register/
          route.ts
        reset-password/
          route.ts
        verify/
          route.ts
        verify-email/
          route.ts
      comentarios/
        [questionId]/
          feedback/
            route.ts
          route.ts
        import/
          route.ts
      companies/
        route.ts
      decs/
        search/
          route.ts
        tree/
          route.ts
      gemini/
        process-document/
          route.ts
        process-youtube/
          route.ts
        transform/
          route.ts
      groq/
        route.ts
        transcribe/
          route.ts
        transcribe-with-extract/
          route.ts
      notes/
        [id]/
          questions/
            route.ts
          route.ts
          similar/
            route.ts
        route.ts
      pinecone/
        status/
          route.ts
      provas/
        [id]/
          route.ts
        route.ts
      questions/
        [id]/
          decs-ai/
            route.ts
          decs-ai-v2/
            route.ts
          embedding/
            route.ts
          route.ts
          similar/
            route.ts
        by-tags/
          route.ts
        route.ts
        semantic-search/
          route.ts
      settings/
        email_smtp/
          route.ts
          test/
            route.ts
        route.ts
      users/
        [id]/
          route.ts
        me/
          route.ts
        route.ts
    dashboard/
      admin/
        decs-diagnose/
          page.tsx
        decs-test/
          page.tsx
        vectorization/
          page.tsx
      agentes-editor/
        page.tsx
      error.tsx
      layout.tsx
      notes/
        [id]/
          page.tsx
        new/
          page.tsx
        page.tsx
        select-questions/
          page.tsx
      page.tsx
      provas/
        [id]/
          page.tsx
        page.tsx
      questions/
        [id]/
          page.tsx
        page.tsx
        simulate/
          page.tsx
      settings/
        agentes-ia/
          page.tsx
        page.tsx
      simulados/
        novo/
          page.tsx
        page.tsx
      users/
        page.tsx
    error.tsx
    globals.css
    layout.tsx
    login/
      page.tsx
    not-found.tsx
    page.tsx
    reset-password/
      page.tsx
    verify-email/
      page.tsx
  arthur/
    __pycache__/
      crawler_contador_questoes.cpython-312.pyc
      web_crawler_4.cpython-314.pyc
    .env.example
    1.2MedMind.html
    abrir-dbeaver.bat
    AUTO-REFRESH-DBEAVER.md
    chunks_50_recentes/
      chunk_01.json
      chunk_02.json
      chunk_03.json
      chunk_04.json
      chunk_05.json
      index.json
    COMPONENTES-MEDMIND.md
    crawler_contador_questoes.py
    DOCKER-LEIA-ME.txt
    Dockerfile
    DOCUMENTACAO_BANCO_DADOS.md
    GUIA-CONFIGURAR-SMTP.md
    GUIA-DBEAVER.md
    README-CRAWLER-SEGURO.md
    requirements-crawler.txt
    resultado_crawl_compativel.json
    resultado_crawl.json
    web_crawler (1).py
    web_crawler (2).py
    web_crawler.py
  attached_assets/
    100_questoes_sem_imagem_1775606130916.json
    100_questoes_sem_imagem_1775684176641.json
    100questoes_1775685300018.json
    100questoes_1775685300026.csv
    100questoes_1775685687873.json
    100questoes_1775685687879.csv
    100questoes_1775779105339.json
    100questoes_1775779105342.csv
    100questoes_modificado.csv
    100questoes_modificado.json
    Captura_de_Tela_2026-04-16_às_00.16.16_1776309379677.png
    decs_pt_2026_1776458030474.tgz
    image_1775684368068.png
    image_1775687064122.png
    image_1775691872126.png
    image_1775774965014.png
    image_1775775401647.png
    image_1775862683158.png
    image_1775863032262.png
    image_1775863075945.png
    image_1776993165702.png
    image_1777069984902.png
    image_1777512251643.png
    image_1777512957558.png
    image_1777592737593.png
    image_1777593612910.png
    image_1777593931326.png
    image_1777594062267.png
    image_1777594615517.png
    image_1778614568581.png
    modelo-resumo_1777598116356.pdf
    Novo_prompt_1777074120661.pdf
    Pasted--BUSCA-PARA-CLASSIFICA-O-POR-TERMOS-DeCS-sub-Temas-1-O-_1776883207137.txt
    Pasted-An-lise-Detalhada-Pipelines-DeCS-V1-e-V2-vs-os-6-Pontos_1777511540021.txt
    Pasted-Essa-uma-percep-o-muito-comum-ao-transicionar-do-chat-i_1777507309163.txt
    Pasted-Voc-um-especialista-em-indexa-o-biom-dica-utilizando-o-_1777422906081.txt
    pipeline_provas_analise_1774476092549.pdf
    pipeline_provas_analise_1774476104703.docx
    Prompt_—_Agente_Comentarista_de_Questões_de_Residência_Médica_1775179034315.docx
    prova_pdf_1775176858147.json
    prova_pdf_1775687624456.json
    resultado_crawl_1775684131674.json
    resultado_crawl_1775688818210.json
    resultado_crawl_1776387948033.json
    resultado_crawl_clean_1776387948028.json
    resultado_crawl_uou_1776387652092.json
    web_crawler_merged_29_1774478137385.py
    web_crawler_modified_30_1775687485807.py
  atualizar-banco.js
  backup_completo.sql
  backup_completo.sql.gz
  classification_test_partial.json
  classification_test_results_100_recent.zip
  classification_test_results.json
  components/
    Common/
      DeCSAutocomplete.tsx
      ImageLightbox.tsx
      QuestionAutocomplete.tsx
      TagAutocomplete.tsx
    Dashboard/
      CriarAgenteModal.tsx
      CriarNotaModal.tsx
      FloatingButton.tsx
      ResumoAulasModal.tsx
      Sidebar.tsx
      Topbar.tsx
  configurar-smtp.js
  content_links.json
  contexts/
    DashboardSearchContext.tsx
    SidebarContext.tsx
  data/
    decs-classification/
      question-25552-v1.json
      question-25553-v1.json
      question-25553-v2.json
      question-25554-v2.json
      question-25555-v1.json
      question-25555-v2.json
      question-25556-v2.json
      question-25557-v2.json
      question-25558-v1.json
      question-25558-v2.json
      question-25559-v2.json
      question-25560-v2.json
      question-25561-v1.json
      question-25561-v2.json
      question-25562-v2.json
      question-25563-v2.json
      question-25564-v2.json
      question-25565-v2.json
      question-25566-v1.json
      question-25566-v2.json
      question-25567-v1.json
      question-25568-v1.json
      question-25568-v2.json
      question-25569-v2.json
      question-25570-v2.json
      question-25571-v2.json
      question-25572-v2.json
      question-25573-v2.json
      question-25574-v1.json
      question-25576-v2.json
      question-25577-v2.json
      question-25578-v2.json
      question-25580-v2.json
      question-25582-v2.json
      question-25583-v1.json
      question-25583-v2.json
      question-25584-v2.json
      question-25585-v2.json
      question-25587-v2.json
      question-25588-v2.json
      question-25589-v1.json
      question-25589-v2.json
      question-25590-v2.json
      question-25591-v2.json
      question-25592-v2.json
      question-25594-v2.json
      question-25595-v1.json
      question-25595-v2.json
      question-25596-v1.json
      question-25596-v2.json
      question-25597-v1.json
      question-25598-v2.json
      question-25599-v2.json
      question-25600-v1.json
      question-25600-v2.json
      question-25601-v2.json
      question-25602-v2.json
      question-25604-v2.json
      question-25605-v1.json
      question-25605-v2.json
      question-25606-v2.json
      question-25607-v1.json
      question-25607-v2.json
      question-25608-v1.json
      question-25608-v2.json
      question-25609-v2.json
      question-25610-v2.json
      question-25611-v2.json
      question-25613-v1.json
      question-25613-v2.json
      question-25614-v1.json
      question-25615-v2.json
      question-25616-v1.json
      question-25616-v2.json
      question-25617-v1.json
      question-25617-v2.json
      question-25619-v2.json
      question-25620-v1.json
      question-25620-v2.json
      question-25621-v2.json
      question-25622-v1.json
      question-25622-v2.json
      question-25623-v2.json
      question-25625-v1.json
      question-25625-v2.json
      question-25626-v2.json
      question-25627-v1.json
      question-25627-v2.json
      question-25628-v1.json
      question-25628-v2.json
      question-25629-v1.json
      question-25629-v2.json
      question-25630-v1.json
      question-25630-v2.json
      question-25631-v1.json
      question-25631-v2.json
      question-25632-v1.json
      question-25632-v2.json
      question-25633-v1.json
      question-25633-v2.json
      question-25634-v1.json
      question-25634-v2.json
      question-25635-v1.json
      question-25635-v2.json
      question-25636-v1.json
      question-25636-v2.json
      question-25637-v1.json
      question-25637-v2.json
      question-25638-v1.json
      question-25638-v2.json
      question-25640-v1.json
      question-25640-v2.json
      question-25642-v1.json
      question-25642-v2.json
      question-25643-v1.json
      question-25643-v2.json
      question-25644-v1.json
      question-25644-v2.json
      question-25645-v1.json
      question-25645-v2.json
      question-25646-v1.json
      question-25646-v2.json
      question-25647-v1.json
      question-25647-v2.json
      question-25648-v1.json
      question-25648-v2.json
      question-25649-v1.json
      question-25649-v2.json
      question-25650-v1.json
      question-25650-v2.json
      question-25651-v1.json
      question-25651-v2.json
  decs_200_recent_questions.json
  decs_200_recent_v2_part2.json
  decs_200_recent_v2.json
  decs_500_questions.json
  decs_classification_results_100_recent.zip
  decs_classification_results.json
  embedding_test_results.json
  lib/
    ai-agents-defaults.ts
    ai-agents.ts
    api-client.ts
    areas-assuntos.ts
    auth.ts
    db.ts
    decs-classification-storage.ts
    decs-pipeline-v2.ts
    decs-pipeline.ts
    document-extract.ts
    email.ts
    embeddings.ts
    enrichment.ts
    gemini.ts
    groq-stt.ts
    groq.ts
    jwt.ts
    pinecone.ts
  medmind-crawler-docker.zip
  medmind.db
  medmind.db-shm
  medmind.db-wal
  middleware.ts
  next-env.d.ts
  next.config.js
  nohup.out
  package-lock.json
  package.json
  postcss.config.js
  README.md
  replit.md
  scripts/
    add-username-column.js
    batch-decs-classify-notes.mjs
    batch-decs-classify.mjs
    batch-embed-questions.mjs
    comentarios_output/
      100questoes.csv
      100questoes.json
      comentarios_20260408_000154.csv
      comentarios_20260408_000154.json
      progresso.log
    compute-similarities.mjs
    criar-zip-docker-crawler.ps1
    debug-pipeline-steps.mjs
    embed-decs-descriptors.mjs
    embed-notes.mjs
    fix_crawler_json.py
    gerar_comentarios.py
    import-decs-xml.mjs
    init-db.js
    neon/
      README.md
      schema.sql
      seed.js
      sync_provas_to_production.sql
    pipeline/
      __pycache__/
        pipeline_analise_provas_gemini.cpython-312.pyc
        pipeline_analise_provas_tavily.cpython-312.pyc
      pipeline_analise_provas_gemini.py
      pipeline_analise_provas_tavily.py
      pipeline_analise_provas.py
      requirements.txt
    test-classification-sample.mjs
    test-embedding-backends.mjs
    test-groq.js
    teste_comentarios/
      comentarios_20260403_004343.csv
      comentarios_20260403_004343.json
      comentarios_20260403_012005.csv
      comentarios_20260403_012005.json
      comentarios_20260403_013217.csv
      comentarios_20260403_013217.json
    teste_output/
      comentarios_20260407_235844.csv
      comentarios_20260407_235844.json
  tailwind.config.js
  test_100_questions_full.json
  test-db.js
  tsconfig.json
  tsconfig.tsbuildinfo
  verificar-smtp.js
```

## Lista plana (caminhos relativos à raiz)

- `workspace/`
- `workspace/.agents/`
- `workspace/.agents/agent_assets_metadata.toml`
- `workspace/.canvas/`
- `workspace/.canvas/assets/`
- `workspace/.canvas/assets/asset_-1844010104.png`
- `workspace/.config/`
- `workspace/.config/.vscode-server/`
- `workspace/.config/npm/`
- `workspace/.config/npm/node_global/`
- `workspace/.config/npm/node_global/lib/`
- `workspace/.env.example`
- `workspace/.env.local`
- `workspace/.gitattributes`
- `workspace/.gitignore`
- `workspace/.replit`
- `workspace/README.md`
- `workspace/adicionar-tag-ciclo-basico.js`
- `workspace/app/`
- `workspace/app/api/`
- `workspace/app/api/admin/`
- `workspace/app/api/admin/decs-batch-test/`
- `workspace/app/api/admin/decs-batch-test/route.ts`
- `workspace/app/api/admin/decs-diagnose/`
- `workspace/app/api/admin/decs-diagnose/route.ts`
- `workspace/app/api/admin/embed-batch/`
- `workspace/app/api/admin/embed-batch/route.ts`
- `workspace/app/api/admin/embed-decs/`
- `workspace/app/api/admin/embed-decs/route.ts`
- `workspace/app/api/admin/embed-notes/`
- `workspace/app/api/admin/embed-notes/route.ts`
- `workspace/app/api/ai-agents/`
- `workspace/app/api/ai-agents/[key]/`
- `workspace/app/api/ai-agents/[key]/route.ts`
- `workspace/app/api/ai-agents/route.ts`
- `workspace/app/api/auth/`
- `workspace/app/api/auth/forgot-password/`
- `workspace/app/api/auth/forgot-password/route.ts`
- `workspace/app/api/auth/login/`
- `workspace/app/api/auth/login/route.ts`
- `workspace/app/api/auth/register/`
- `workspace/app/api/auth/register/route.ts`
- `workspace/app/api/auth/reset-password/`
- `workspace/app/api/auth/reset-password/route.ts`
- `workspace/app/api/auth/verify-email/`
- `workspace/app/api/auth/verify-email/route.ts`
- `workspace/app/api/auth/verify/`
- `workspace/app/api/auth/verify/route.ts`
- `workspace/app/api/comentarios/`
- `workspace/app/api/comentarios/[questionId]/`
- `workspace/app/api/comentarios/[questionId]/feedback/`
- `workspace/app/api/comentarios/[questionId]/feedback/route.ts`
- `workspace/app/api/comentarios/[questionId]/route.ts`
- `workspace/app/api/comentarios/import/`
- `workspace/app/api/comentarios/import/route.ts`
- `workspace/app/api/companies/`
- `workspace/app/api/companies/route.ts`
- `workspace/app/api/decs/`
- `workspace/app/api/decs/search/`
- `workspace/app/api/decs/search/route.ts`
- `workspace/app/api/decs/tree/`
- `workspace/app/api/decs/tree/route.ts`
- `workspace/app/api/gemini/`
- `workspace/app/api/gemini/process-document/`
- `workspace/app/api/gemini/process-document/route.ts`
- `workspace/app/api/gemini/process-youtube/`
- `workspace/app/api/gemini/process-youtube/route.ts`
- `workspace/app/api/gemini/transform/`
- `workspace/app/api/gemini/transform/route.ts`
- `workspace/app/api/groq/`
- `workspace/app/api/groq/route.ts`
- `workspace/app/api/groq/transcribe-with-extract/`
- `workspace/app/api/groq/transcribe-with-extract/route.ts`
- `workspace/app/api/groq/transcribe/`
- `workspace/app/api/groq/transcribe/route.ts`
- `workspace/app/api/notes/`
- `workspace/app/api/notes/[id]/`
- `workspace/app/api/notes/[id]/questions/`
- `workspace/app/api/notes/[id]/questions/route.ts`
- `workspace/app/api/notes/[id]/route.ts`
- `workspace/app/api/notes/[id]/similar/`
- `workspace/app/api/notes/[id]/similar/route.ts`
- `workspace/app/api/notes/route.ts`
- `workspace/app/api/pinecone/`
- `workspace/app/api/pinecone/status/`
- `workspace/app/api/pinecone/status/route.ts`
- `workspace/app/api/provas/`
- `workspace/app/api/provas/[id]/`
- `workspace/app/api/provas/[id]/route.ts`
- `workspace/app/api/provas/route.ts`
- `workspace/app/api/questions/`
- `workspace/app/api/questions/[id]/`
- `workspace/app/api/questions/[id]/decs-ai-v2/`
- `workspace/app/api/questions/[id]/decs-ai-v2/route.ts`
- `workspace/app/api/questions/[id]/decs-ai/`
- `workspace/app/api/questions/[id]/decs-ai/route.ts`
- `workspace/app/api/questions/[id]/embedding/`
- `workspace/app/api/questions/[id]/embedding/route.ts`
- `workspace/app/api/questions/[id]/route.ts`
- `workspace/app/api/questions/[id]/similar/`
- `workspace/app/api/questions/[id]/similar/route.ts`
- `workspace/app/api/questions/by-tags/`
- `workspace/app/api/questions/by-tags/route.ts`
- `workspace/app/api/questions/route.ts`
- `workspace/app/api/questions/semantic-search/`
- `workspace/app/api/questions/semantic-search/route.ts`
- `workspace/app/api/settings/`
- `workspace/app/api/settings/email_smtp/`
- `workspace/app/api/settings/email_smtp/route.ts`
- `workspace/app/api/settings/email_smtp/test/`
- `workspace/app/api/settings/email_smtp/test/route.ts`
- `workspace/app/api/settings/route.ts`
- `workspace/app/api/users/`
- `workspace/app/api/users/[id]/`
- `workspace/app/api/users/[id]/route.ts`
- `workspace/app/api/users/me/`
- `workspace/app/api/users/me/route.ts`
- `workspace/app/api/users/route.ts`
- `workspace/app/dashboard/`
- `workspace/app/dashboard/admin/`
- `workspace/app/dashboard/admin/decs-diagnose/`
- `workspace/app/dashboard/admin/decs-diagnose/page.tsx`
- `workspace/app/dashboard/admin/decs-test/`
- `workspace/app/dashboard/admin/decs-test/page.tsx`
- `workspace/app/dashboard/admin/vectorization/`
- `workspace/app/dashboard/admin/vectorization/page.tsx`
- `workspace/app/dashboard/agentes-editor/`
- `workspace/app/dashboard/agentes-editor/page.tsx`
- `workspace/app/dashboard/error.tsx`
- `workspace/app/dashboard/layout.tsx`
- `workspace/app/dashboard/notes/`
- `workspace/app/dashboard/notes/[id]/`
- `workspace/app/dashboard/notes/[id]/page.tsx`
- `workspace/app/dashboard/notes/new/`
- `workspace/app/dashboard/notes/new/page.tsx`
- `workspace/app/dashboard/notes/page.tsx`
- `workspace/app/dashboard/notes/select-questions/`
- `workspace/app/dashboard/notes/select-questions/page.tsx`
- `workspace/app/dashboard/page.tsx`
- `workspace/app/dashboard/provas/`
- `workspace/app/dashboard/provas/[id]/`
- `workspace/app/dashboard/provas/[id]/page.tsx`
- `workspace/app/dashboard/provas/page.tsx`
- `workspace/app/dashboard/questions/`
- `workspace/app/dashboard/questions/[id]/`
- `workspace/app/dashboard/questions/[id]/page.tsx`
- `workspace/app/dashboard/questions/page.tsx`
- `workspace/app/dashboard/questions/simulate/`
- `workspace/app/dashboard/questions/simulate/page.tsx`
- `workspace/app/dashboard/settings/`
- `workspace/app/dashboard/settings/agentes-ia/`
- `workspace/app/dashboard/settings/agentes-ia/page.tsx`
- `workspace/app/dashboard/settings/page.tsx`
- `workspace/app/dashboard/simulados/`
- `workspace/app/dashboard/simulados/novo/`
- `workspace/app/dashboard/simulados/novo/page.tsx`
- `workspace/app/dashboard/simulados/page.tsx`
- `workspace/app/dashboard/users/`
- `workspace/app/dashboard/users/page.tsx`
- `workspace/app/error.tsx`
- `workspace/app/globals.css`
- `workspace/app/layout.tsx`
- `workspace/app/login/`
- `workspace/app/login/page.tsx`
- `workspace/app/not-found.tsx`
- `workspace/app/page.tsx`
- `workspace/app/reset-password/`
- `workspace/app/reset-password/page.tsx`
- `workspace/app/verify-email/`
- `workspace/app/verify-email/page.tsx`
- `workspace/arthur/`
- `workspace/arthur/.env.example`
- `workspace/arthur/1.2MedMind.html`
- `workspace/arthur/AUTO-REFRESH-DBEAVER.md`
- `workspace/arthur/COMPONENTES-MEDMIND.md`
- `workspace/arthur/DOCKER-LEIA-ME.txt`
- `workspace/arthur/DOCUMENTACAO_BANCO_DADOS.md`
- `workspace/arthur/Dockerfile`
- `workspace/arthur/GUIA-CONFIGURAR-SMTP.md`
- `workspace/arthur/GUIA-DBEAVER.md`
- `workspace/arthur/README-CRAWLER-SEGURO.md`
- `workspace/arthur/__pycache__/`
- `workspace/arthur/__pycache__/crawler_contador_questoes.cpython-312.pyc`
- `workspace/arthur/__pycache__/web_crawler_4.cpython-314.pyc`
- `workspace/arthur/abrir-dbeaver.bat`
- `workspace/arthur/chunks_50_recentes/`
- `workspace/arthur/chunks_50_recentes/chunk_01.json`
- `workspace/arthur/chunks_50_recentes/chunk_02.json`
- `workspace/arthur/chunks_50_recentes/chunk_03.json`
- `workspace/arthur/chunks_50_recentes/chunk_04.json`
- `workspace/arthur/chunks_50_recentes/chunk_05.json`
- `workspace/arthur/chunks_50_recentes/index.json`
- `workspace/arthur/crawler_contador_questoes.py`
- `workspace/arthur/requirements-crawler.txt`
- `workspace/arthur/resultado_crawl.json`
- `workspace/arthur/resultado_crawl_compativel.json`
- `workspace/arthur/web_crawler (1).py`
- `workspace/arthur/web_crawler (2).py`
- `workspace/arthur/web_crawler.py`
- `workspace/attached_assets/`
- `workspace/attached_assets/100_questoes_sem_imagem_1775606130916.json`
- `workspace/attached_assets/100_questoes_sem_imagem_1775684176641.json`
- `workspace/attached_assets/100questoes_1775685300018.json`
- `workspace/attached_assets/100questoes_1775685300026.csv`
- `workspace/attached_assets/100questoes_1775685687873.json`
- `workspace/attached_assets/100questoes_1775685687879.csv`
- `workspace/attached_assets/100questoes_1775779105339.json`
- `workspace/attached_assets/100questoes_1775779105342.csv`
- `workspace/attached_assets/100questoes_modificado.csv`
- `workspace/attached_assets/100questoes_modificado.json`
- `workspace/attached_assets/Captura_de_Tela_2026-04-16_às_00.16.16_1776309379677.png`
- `workspace/attached_assets/Novo_prompt_1777074120661.pdf`
- `workspace/attached_assets/Pasted--BUSCA-PARA-CLASSIFICA-O-POR-TERMOS-DeCS-sub-Temas-1-O-_1776883207137.txt`
- `workspace/attached_assets/Pasted-An-lise-Detalhada-Pipelines-DeCS-V1-e-V2-vs-os-6-Pontos_1777511540021.txt`
- `workspace/attached_assets/Pasted-Essa-uma-percep-o-muito-comum-ao-transicionar-do-chat-i_1777507309163.txt`
- `workspace/attached_assets/Pasted-Voc-um-especialista-em-indexa-o-biom-dica-utilizando-o-_1777422906081.txt`
- `workspace/attached_assets/Prompt_—_Agente_Comentarista_de_Questões_de_Residência_Médica_1775179034315.docx`
- `workspace/attached_assets/decs_pt_2026_1776458030474.tgz`
- `workspace/attached_assets/image_1775684368068.png`
- `workspace/attached_assets/image_1775687064122.png`
- `workspace/attached_assets/image_1775691872126.png`
- `workspace/attached_assets/image_1775774965014.png`
- `workspace/attached_assets/image_1775775401647.png`
- `workspace/attached_assets/image_1775862683158.png`
- `workspace/attached_assets/image_1775863032262.png`
- `workspace/attached_assets/image_1775863075945.png`
- `workspace/attached_assets/image_1776993165702.png`
- `workspace/attached_assets/image_1777069984902.png`
- `workspace/attached_assets/image_1777512251643.png`
- `workspace/attached_assets/image_1777512957558.png`
- `workspace/attached_assets/image_1777592737593.png`
- `workspace/attached_assets/image_1777593612910.png`
- `workspace/attached_assets/image_1777593931326.png`
- `workspace/attached_assets/image_1777594062267.png`
- `workspace/attached_assets/image_1777594615517.png`
- `workspace/attached_assets/image_1778614568581.png`
- `workspace/attached_assets/modelo-resumo_1777598116356.pdf`
- `workspace/attached_assets/pipeline_provas_analise_1774476092549.pdf`
- `workspace/attached_assets/pipeline_provas_analise_1774476104703.docx`
- `workspace/attached_assets/prova_pdf_1775176858147.json`
- `workspace/attached_assets/prova_pdf_1775687624456.json`
- `workspace/attached_assets/resultado_crawl_1775684131674.json`
- `workspace/attached_assets/resultado_crawl_1775688818210.json`
- `workspace/attached_assets/resultado_crawl_1776387948033.json`
- `workspace/attached_assets/resultado_crawl_clean_1776387948028.json`
- `workspace/attached_assets/resultado_crawl_uou_1776387652092.json`
- `workspace/attached_assets/web_crawler_merged_29_1774478137385.py`
- `workspace/attached_assets/web_crawler_modified_30_1775687485807.py`
- `workspace/atualizar-banco.js`
- `workspace/backup_completo.sql`
- `workspace/backup_completo.sql.gz`
- `workspace/classification_test_partial.json`
- `workspace/classification_test_results.json`
- `workspace/classification_test_results_100_recent.zip`
- `workspace/components/`
- `workspace/components/Common/`
- `workspace/components/Common/DeCSAutocomplete.tsx`
- `workspace/components/Common/ImageLightbox.tsx`
- `workspace/components/Common/QuestionAutocomplete.tsx`
- `workspace/components/Common/TagAutocomplete.tsx`
- `workspace/components/Dashboard/`
- `workspace/components/Dashboard/CriarAgenteModal.tsx`
- `workspace/components/Dashboard/CriarNotaModal.tsx`
- `workspace/components/Dashboard/FloatingButton.tsx`
- `workspace/components/Dashboard/ResumoAulasModal.tsx`
- `workspace/components/Dashboard/Sidebar.tsx`
- `workspace/components/Dashboard/Topbar.tsx`
- `workspace/configurar-smtp.js`
- `workspace/content_links.json`
- `workspace/contexts/`
- `workspace/contexts/DashboardSearchContext.tsx`
- `workspace/contexts/SidebarContext.tsx`
- `workspace/data/`
- `workspace/data/decs-classification/`
- `workspace/data/decs-classification/question-25552-v1.json`
- `workspace/data/decs-classification/question-25553-v1.json`
- `workspace/data/decs-classification/question-25553-v2.json`
- `workspace/data/decs-classification/question-25554-v2.json`
- `workspace/data/decs-classification/question-25555-v1.json`
- `workspace/data/decs-classification/question-25555-v2.json`
- `workspace/data/decs-classification/question-25556-v2.json`
- `workspace/data/decs-classification/question-25557-v2.json`
- `workspace/data/decs-classification/question-25558-v1.json`
- `workspace/data/decs-classification/question-25558-v2.json`
- `workspace/data/decs-classification/question-25559-v2.json`
- `workspace/data/decs-classification/question-25560-v2.json`
- `workspace/data/decs-classification/question-25561-v1.json`
- `workspace/data/decs-classification/question-25561-v2.json`
- `workspace/data/decs-classification/question-25562-v2.json`
- `workspace/data/decs-classification/question-25563-v2.json`
- `workspace/data/decs-classification/question-25564-v2.json`
- `workspace/data/decs-classification/question-25565-v2.json`
- `workspace/data/decs-classification/question-25566-v1.json`
- `workspace/data/decs-classification/question-25566-v2.json`
- `workspace/data/decs-classification/question-25567-v1.json`
- `workspace/data/decs-classification/question-25568-v1.json`
- `workspace/data/decs-classification/question-25568-v2.json`
- `workspace/data/decs-classification/question-25569-v2.json`
- `workspace/data/decs-classification/question-25570-v2.json`
- `workspace/data/decs-classification/question-25571-v2.json`
- `workspace/data/decs-classification/question-25572-v2.json`
- `workspace/data/decs-classification/question-25573-v2.json`
- `workspace/data/decs-classification/question-25574-v1.json`
- `workspace/data/decs-classification/question-25576-v2.json`
- `workspace/data/decs-classification/question-25577-v2.json`
- `workspace/data/decs-classification/question-25578-v2.json`
- `workspace/data/decs-classification/question-25580-v2.json`
- `workspace/data/decs-classification/question-25582-v2.json`
- `workspace/data/decs-classification/question-25583-v1.json`
- `workspace/data/decs-classification/question-25583-v2.json`
- `workspace/data/decs-classification/question-25584-v2.json`
- `workspace/data/decs-classification/question-25585-v2.json`
- `workspace/data/decs-classification/question-25587-v2.json`
- `workspace/data/decs-classification/question-25588-v2.json`
- `workspace/data/decs-classification/question-25589-v1.json`
- `workspace/data/decs-classification/question-25589-v2.json`
- `workspace/data/decs-classification/question-25590-v2.json`
- `workspace/data/decs-classification/question-25591-v2.json`
- `workspace/data/decs-classification/question-25592-v2.json`
- `workspace/data/decs-classification/question-25594-v2.json`
- `workspace/data/decs-classification/question-25595-v1.json`
- `workspace/data/decs-classification/question-25595-v2.json`
- `workspace/data/decs-classification/question-25596-v1.json`
- `workspace/data/decs-classification/question-25596-v2.json`
- `workspace/data/decs-classification/question-25597-v1.json`
- `workspace/data/decs-classification/question-25598-v2.json`
- `workspace/data/decs-classification/question-25599-v2.json`
- `workspace/data/decs-classification/question-25600-v1.json`
- `workspace/data/decs-classification/question-25600-v2.json`
- `workspace/data/decs-classification/question-25601-v2.json`
- `workspace/data/decs-classification/question-25602-v2.json`
- `workspace/data/decs-classification/question-25604-v2.json`
- `workspace/data/decs-classification/question-25605-v1.json`
- `workspace/data/decs-classification/question-25605-v2.json`
- `workspace/data/decs-classification/question-25606-v2.json`
- `workspace/data/decs-classification/question-25607-v1.json`
- `workspace/data/decs-classification/question-25607-v2.json`
- `workspace/data/decs-classification/question-25608-v1.json`
- `workspace/data/decs-classification/question-25608-v2.json`
- `workspace/data/decs-classification/question-25609-v2.json`
- `workspace/data/decs-classification/question-25610-v2.json`
- `workspace/data/decs-classification/question-25611-v2.json`
- `workspace/data/decs-classification/question-25613-v1.json`
- `workspace/data/decs-classification/question-25613-v2.json`
- `workspace/data/decs-classification/question-25614-v1.json`
- `workspace/data/decs-classification/question-25615-v2.json`
- `workspace/data/decs-classification/question-25616-v1.json`
- `workspace/data/decs-classification/question-25616-v2.json`
- `workspace/data/decs-classification/question-25617-v1.json`
- `workspace/data/decs-classification/question-25617-v2.json`
- `workspace/data/decs-classification/question-25619-v2.json`
- `workspace/data/decs-classification/question-25620-v1.json`
- `workspace/data/decs-classification/question-25620-v2.json`
- `workspace/data/decs-classification/question-25621-v2.json`
- `workspace/data/decs-classification/question-25622-v1.json`
- `workspace/data/decs-classification/question-25622-v2.json`
- `workspace/data/decs-classification/question-25623-v2.json`
- `workspace/data/decs-classification/question-25625-v1.json`
- `workspace/data/decs-classification/question-25625-v2.json`
- `workspace/data/decs-classification/question-25626-v2.json`
- `workspace/data/decs-classification/question-25627-v1.json`
- `workspace/data/decs-classification/question-25627-v2.json`
- `workspace/data/decs-classification/question-25628-v1.json`
- `workspace/data/decs-classification/question-25628-v2.json`
- `workspace/data/decs-classification/question-25629-v1.json`
- `workspace/data/decs-classification/question-25629-v2.json`
- `workspace/data/decs-classification/question-25630-v1.json`
- `workspace/data/decs-classification/question-25630-v2.json`
- `workspace/data/decs-classification/question-25631-v1.json`
- `workspace/data/decs-classification/question-25631-v2.json`
- `workspace/data/decs-classification/question-25632-v1.json`
- `workspace/data/decs-classification/question-25632-v2.json`
- `workspace/data/decs-classification/question-25633-v1.json`
- `workspace/data/decs-classification/question-25633-v2.json`
- `workspace/data/decs-classification/question-25634-v1.json`
- `workspace/data/decs-classification/question-25634-v2.json`
- `workspace/data/decs-classification/question-25635-v1.json`
- `workspace/data/decs-classification/question-25635-v2.json`
- `workspace/data/decs-classification/question-25636-v1.json`
- `workspace/data/decs-classification/question-25636-v2.json`
- `workspace/data/decs-classification/question-25637-v1.json`
- `workspace/data/decs-classification/question-25637-v2.json`
- `workspace/data/decs-classification/question-25638-v1.json`
- `workspace/data/decs-classification/question-25638-v2.json`
- `workspace/data/decs-classification/question-25640-v1.json`
- `workspace/data/decs-classification/question-25640-v2.json`
- `workspace/data/decs-classification/question-25642-v1.json`
- `workspace/data/decs-classification/question-25642-v2.json`
- `workspace/data/decs-classification/question-25643-v1.json`
- `workspace/data/decs-classification/question-25643-v2.json`
- `workspace/data/decs-classification/question-25644-v1.json`
- `workspace/data/decs-classification/question-25644-v2.json`
- `workspace/data/decs-classification/question-25645-v1.json`
- `workspace/data/decs-classification/question-25645-v2.json`
- `workspace/data/decs-classification/question-25646-v1.json`
- `workspace/data/decs-classification/question-25646-v2.json`
- `workspace/data/decs-classification/question-25647-v1.json`
- `workspace/data/decs-classification/question-25647-v2.json`
- `workspace/data/decs-classification/question-25648-v1.json`
- `workspace/data/decs-classification/question-25648-v2.json`
- `workspace/data/decs-classification/question-25649-v1.json`
- `workspace/data/decs-classification/question-25649-v2.json`
- `workspace/data/decs-classification/question-25650-v1.json`
- `workspace/data/decs-classification/question-25650-v2.json`
- `workspace/data/decs-classification/question-25651-v1.json`
- `workspace/data/decs-classification/question-25651-v2.json`
- `workspace/decs_200_recent_questions.json`
- `workspace/decs_200_recent_v2.json`
- `workspace/decs_200_recent_v2_part2.json`
- `workspace/decs_500_questions.json`
- `workspace/decs_classification_results.json`
- `workspace/decs_classification_results_100_recent.zip`
- `workspace/embedding_test_results.json`
- `workspace/lib/`
- `workspace/lib/ai-agents-defaults.ts`
- `workspace/lib/ai-agents.ts`
- `workspace/lib/api-client.ts`
- `workspace/lib/areas-assuntos.ts`
- `workspace/lib/auth.ts`
- `workspace/lib/db.ts`
- `workspace/lib/decs-classification-storage.ts`
- `workspace/lib/decs-pipeline-v2.ts`
- `workspace/lib/decs-pipeline.ts`
- `workspace/lib/document-extract.ts`
- `workspace/lib/email.ts`
- `workspace/lib/embeddings.ts`
- `workspace/lib/enrichment.ts`
- `workspace/lib/gemini.ts`
- `workspace/lib/groq-stt.ts`
- `workspace/lib/groq.ts`
- `workspace/lib/jwt.ts`
- `workspace/lib/pinecone.ts`
- `workspace/medmind-crawler-docker.zip`
- `workspace/medmind.db`
- `workspace/medmind.db-shm`
- `workspace/medmind.db-wal`
- `workspace/middleware.ts`
- `workspace/next-env.d.ts`
- `workspace/next.config.js`
- `workspace/nohup.out`
- `workspace/package-lock.json`
- `workspace/package.json`
- `workspace/postcss.config.js`
- `workspace/replit.md`
- `workspace/scripts/`
- `workspace/scripts/add-username-column.js`
- `workspace/scripts/batch-decs-classify-notes.mjs`
- `workspace/scripts/batch-decs-classify.mjs`
- `workspace/scripts/batch-embed-questions.mjs`
- `workspace/scripts/comentarios_output/`
- `workspace/scripts/comentarios_output/100questoes.csv`
- `workspace/scripts/comentarios_output/100questoes.json`
- `workspace/scripts/comentarios_output/comentarios_20260408_000154.csv`
- `workspace/scripts/comentarios_output/comentarios_20260408_000154.json`
- `workspace/scripts/comentarios_output/progresso.log`
- `workspace/scripts/compute-similarities.mjs`
- `workspace/scripts/criar-zip-docker-crawler.ps1`
- `workspace/scripts/debug-pipeline-steps.mjs`
- `workspace/scripts/embed-decs-descriptors.mjs`
- `workspace/scripts/embed-notes.mjs`
- `workspace/scripts/fix_crawler_json.py`
- `workspace/scripts/gerar_comentarios.py`
- `workspace/scripts/import-decs-xml.mjs`
- `workspace/scripts/init-db.js`
- `workspace/scripts/neon/`
- `workspace/scripts/neon/README.md`
- `workspace/scripts/neon/schema.sql`
- `workspace/scripts/neon/seed.js`
- `workspace/scripts/neon/sync_provas_to_production.sql`
- `workspace/scripts/pipeline/`
- `workspace/scripts/pipeline/__pycache__/`
- `workspace/scripts/pipeline/__pycache__/pipeline_analise_provas_gemini.cpython-312.pyc`
- `workspace/scripts/pipeline/__pycache__/pipeline_analise_provas_tavily.cpython-312.pyc`
- `workspace/scripts/pipeline/pipeline_analise_provas.py`
- `workspace/scripts/pipeline/pipeline_analise_provas_gemini.py`
- `workspace/scripts/pipeline/pipeline_analise_provas_tavily.py`
- `workspace/scripts/pipeline/requirements.txt`
- `workspace/scripts/test-classification-sample.mjs`
- `workspace/scripts/test-embedding-backends.mjs`
- `workspace/scripts/test-groq.js`
- `workspace/scripts/teste_comentarios/`
- `workspace/scripts/teste_comentarios/comentarios_20260403_004343.csv`
- `workspace/scripts/teste_comentarios/comentarios_20260403_004343.json`
- `workspace/scripts/teste_comentarios/comentarios_20260403_012005.csv`
- `workspace/scripts/teste_comentarios/comentarios_20260403_012005.json`
- `workspace/scripts/teste_comentarios/comentarios_20260403_013217.csv`
- `workspace/scripts/teste_comentarios/comentarios_20260403_013217.json`
- `workspace/scripts/teste_output/`
- `workspace/scripts/teste_output/comentarios_20260407_235844.csv`
- `workspace/scripts/teste_output/comentarios_20260407_235844.json`
- `workspace/tailwind.config.js`
- `workspace/test-db.js`
- `workspace/test_100_questions_full.json`
- `workspace/tsconfig.json`
- `workspace/tsconfig.tsbuildinfo`
- `workspace/verificar-smtp.js`

---

Versão em máquina: veja `estrutura-projeto.json` na raiz do repositório (árvore aninhada + lista plana).
