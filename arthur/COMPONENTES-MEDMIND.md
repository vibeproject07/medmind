# Componentes e Estruturas do MedMind (1.2MedMind.html)

## 📋 ÍNDICE DE COMPONENTES

---

## 1. 🎨 ESTRUTURA DE LAYOUT

### 1.1 Container Principal
- **`.container`**: Container flex principal que envolve toda a aplicação
- **`.content-wrapper`**: Wrapper do conteúdo principal (flex-grow)
- **`.main-content`**: Área de conteúdo principal com scroll

### 1.2 Sidebar (Barra Lateral)
- **`#sidebar`**: Barra lateral colapsável/expansível
  - Largura padrão: 80px
  - Largura expandida: 240px
  - Transição suave de expansão/colapso
  - Links de navegação com ícones

### 1.3 Header (Cabeçalho)
- **`.header-top`**: Cabeçalho fixo superior
  - Logo MedMind
  - Barra de busca
  - Conteúdo dinâmico baseado na tela ativa
- **`#default-header-content`**: Conteúdo padrão do header
- **`#new-case-header-content`**: Conteúdo do header para tela de novo caso

---

## 2. 🖥️ TELAS (SCREENS)

### 2.1 Tela Inicial
- **`#home-screen`**: Tela principal "Meu Mind"
  - Banner carousel rotativo
  - Card de sequência de dias
  - Card "Caso do Dia"
  - Card "Sugestões de Estudo"

### 2.2 Tela de Notas
- **`#all-notes-screen`**: Lista todas as notas
  - Grid responsivo de cards de notas
  - Filtros e organização

### 2.3 Tela de Favoritas
- **`#favorites-screen`**: Notas marcadas como favoritas
  - Grid de notas favoritas

### 2.4 Tela de Pastas
- **`#folders-screen`**: Organização por pastas
  - Grid de pastas com contadores
  - Navegação para conteúdo da pasta

### 2.5 Tela de Conteúdo da Pasta
- **`#folder-content-screen`**: Conteúdo específico de uma pasta
  - Botão de voltar
  - Grid de notas da pasta

### 2.6 Tela de Cronograma
- **`#calendar-screen`**: Calendário mensal
  - Navegação entre meses
  - Grid de dias
  - Lista de eventos do dia

### 2.7 Tela de Questões
- **`#questions-screen`**: Banco de questões
  - Lista de barra de questões
  - Tags e contadores

### 2.8 Tela de Flashcards
- **`#flashcards-screen`**: Decks de flashcards
  - Lista de decks
  - Contadores (novo, aprendendo, revisar)

### 2.9 Tela de Artigos
- **`#articles-screen`**: Artigos sugeridos
  - Lista de artigos
  - Fonte e tags

### 2.10 Tela de Perfil
- **`#profile-screen`**: Perfil do usuário
  - Avatar com iniciais
  - Informações do perfil
  - Botão de sugestão de perfil (IA)
  - Botões de configurações e sair

### 2.11 Tela de Sobre
- **`#about-screen`**: Informações sobre o MedMind
  - Descrição do projeto
  - Proposta de valor
  - Foco educacional

### 2.12 Tela de Novo Caso
- **`#new-case-screen`**: Criação/edição de caso clínico
  - Editor de texto
  - Upload de arquivos
  - Transcrição de voz
  - Sugestões semiológicas
  - Passagem de caso
  - Aprendizado inteligente

---

## 3. 🎯 COMPONENTES DE INTERFACE

### 3.1 Cards
- **`.card`**: Componente base de card
  - Hover effect com elevação
  - Bordas arredondadas
  - Sombras suaves

### 3.2 Banner Carousel
- **`.banner-carousel`**: Carrossel de banners
  - Transição automática
  - Indicadores de pontos (dots)
  - 4 banners diferentes com backgrounds únicos

### 3.3 Botão Flutuante (FAB)
- **`#fab-container`**: Container do botão flutuante
- **`#add-button`**: Botão principal (+)
- **`#fab-options`**: Opções que aparecem ao clicar
  - Arquivo
  - Imagem
  - Texto
  - Transcrição

### 3.4 Menu de Notas
- **`.note-menu-container`**: Container do menu
- **`.note-menu-button`**: Botão de três pontos
- **`.note-menu-dropdown`**: Dropdown com opções
  - Questões
  - Artigos
  - Flashcards
  - Passagem de Caso
  - Aprendizado Guiado

### 3.5 Menu Semiológico
- **`#semiologic-menu`**: Menu lateral de sugestões semiológicas
  - Card de Anamnese
  - Card de Exame Físico
  - Card de Scores & Calculadoras
  - Animações de entrada

---

## 4. 📝 COMPONENTES DE EDIÇÃO

### 4.1 Editor de Texto
- **`#case-text`**: Textarea principal para notas
- **`#text-note-container`**: Container do editor de texto
- **Barra de Ferramentas**:
  - Botão Negrito (B)
  - Botão Itálico (I)
  - Botão Sublinhado (U)
  - Color Picker (seletor de cor)
  - Botão Traduzir Termo
  - Botão Aprimorar Termo
  - Botão Copiar Nota

### 4.2 Upload de Arquivos
- **`#file-note-container`**: Container de upload
- **`#drop-zone`**: Zona de drag & drop
- **`#file-upload-input`**: Input de arquivo (hidden)
- **`#file-list`**: Lista de arquivos carregados
- **`#file-description`**: Textarea para descrição do arquivo
- Suporte para:
  - PDF (extração de texto)
  - Imagens (preview)
  - Arquivos de texto

### 4.3 Transcrição de Voz
- **`#transcription-mic-container`**: Container do microfone
- **`#transcription-mic-btn`**: Botão de gravação principal
- **`#file-transcription-mic-btn`**: Botão de gravação para arquivos
- **`#text-loader-overlay`**: Overlay de loading durante processamento
- **`#file-loader-overlay`**: Overlay de loading para arquivos

---

## 5. 🤖 COMPONENTES DE IA

### 5.1 Passagem de Caso
- **`#generate-passage-button`**: Botão para gerar passagem
- **`#listen-passage-button`**: Botão para ouvir (TTS)
- **`#passage-result`**: Container do resultado
- **`#passage-text-content`**: Texto da passagem gerada
- **`#audio-player-controls`**: Controles de áudio
  - Play/Pause
  - Barra de progresso
  - Controle de velocidade (0.25x a 2x)
  - Tempo atual/total
- **`#passage-chat-container`**: Chat sobre o caso

### 5.2 Aprendizado Inteligente
- **`#questions-btn`**: Buscar questões
- **`#articles-btn`**: Buscar artigos
- **`#flashcards-btn`**: Gerar flashcards
- **`#guided-study-btn`**: Estudo guiado
- **`#learning-result-card`**: Card de resultado

### 5.3 Questões Interativas
- **`.option-btn`**: Botões de opções
  - Estados: normal, selected, correct, incorrect
- **`#learning-submit-btn`**: Botão de responder
- **`#learning-explanation-container`**: Explicação da resposta

### 5.4 Flashcards Interativos
- **`.flashcard-scene`**: Container 3D (perspective)
- **`.flashcard`**: Card com flip animation
- **`.flashcard-face`**: Face do card (frente/verso)
- **`#flip-to-back-btn`**: Botão para virar
- **`#next-card-btn`**: Próximo card
- **`.difficulty-btn`**: Botões de dificuldade (Errei, Hesitei, Acertei)

### 5.5 Chat Guiado
- **`.chat-container`**: Container do chat
- **`.chat-messages`**: Área de mensagens
- **`.chat-message`**: Mensagem individual
  - `.ai-message`: Mensagem da IA
  - `.user-message`: Mensagem do usuário
- **`.chat-input-form`**: Formulário de input
- **`.chat-input`**: Campo de texto
- **`.chat-send-btn`**: Botão de enviar

### 5.6 Sugestões Semiológicas
- **`#semiologic-suggestion-btn`**: Botão para abrir menu
- **`#anamnese-result`**: Resultado de sugestões de anamnese
- **`#exam-result`**: Resultado de sugestões de exame físico
- **`#scores-result`**: Resultado de scores sugeridos

### 5.7 Modal de Definição
- **`#definition-modal`**: Modal para definição de termos
- **`#definition-title`**: Título do modal
- **`#definition-content`**: Conteúdo da definição
- **`#definition-loader`**: Loader durante busca

---

## 6. 🎨 COMPONENTES VISUAIS

### 6.1 Loaders
- **`.loader`**: Spinner circular padrão
- **`.loader-sm`**: Spinner pequeno
- **`.loader-container`**: Container do loader

### 6.2 Mensagens
- **`#message-box`**: Caixa de mensagem flutuante
  - Tipos: success, error, info
  - Posição: bottom center
  - Auto-dismiss após 3 segundos

### 6.3 Modais
- **`#image-options-modal`**: Modal de opções de imagem
  - Tirar foto
  - Escolher da galeria
- **`#definition-modal`**: Modal de definição (já listado acima)

### 6.4 Color Picker
- **`#color-picker-toggle`**: Botão para abrir paleta
- **`#color-palette`**: Paleta de cores
  - Preto
  - Azul
  - Vermelho
  - Verde

---

## 7. 📊 COMPONENTES DE DADOS

### 7.1 Cards de Notas
- Função: `createNoteCard(note)`
- Estrutura:
  - Título
  - Conteúdo (preview)
  - Tags
  - Ícone de favorito
  - Menu de opções

### 7.2 Barras de Questões
- Função: `createQuestionBar(question)`
- Estrutura:
  - Ícone
  - Título
  - Descrição
  - Tags
  - Contador de questões
  - Botão "Iniciar"

### 7.3 Barras de Artigos
- Função: `createArtigoBar(artigo)`
- Estrutura:
  - Ícone
  - Título
  - Fonte (itálico)
  - Tags
  - Botão "Ler Artigo"

### 7.4 Barras de Flashcards
- Função: `createFlashcardDeckBar(deck)`
- Estrutura:
  - Ícone
  - Título
  - Contadores (Novo, Aprender, Revisar)
  - Botão "Estudar agora"

### 7.5 Pastas
- Função: `renderFolders()`
- Estrutura:
  - Nome da pasta
  - Contador de notas
  - Cores temáticas por pasta

---

## 8. 🎯 FUNCIONALIDADES JAVASCRIPT

### 8.1 Navegação
- **`showScreen(screenId)`**: Função para trocar telas
- **`showFolderContent(folderName)`**: Mostrar conteúdo da pasta
- **`toggleNoteMenu(noteId, event)`**: Toggle menu de nota

### 8.2 Gerenciamento de Notas
- **`selectNoteType(type)`**: Selecionar tipo de nota
  - text
  - file
  - image
  - transcription
- **`renderNotes(filter, containerId)`**: Renderizar notas
- **`createNoteCard(note)`**: Criar card de nota

### 8.3 API Gemini
- **`callGeminiAPI(prompt, button, imageData, useGrounding)`**: Chamada genérica
- **`callGeminiTTSAPI(text, button)`**: Text-to-Speech
- **`setupPassageChat(caseContext, container)`**: Configurar chat de passagem

### 8.4 Transcrição de Voz
- **Web Speech API** integrada
- **`toggleRecognition(targetTextarea)`**: Iniciar/parar gravação
- Processamento automático com IA após gravação

### 8.5 Upload e Processamento de Arquivos
- **`handleFiles(files)`**: Processar arquivos
- **`extractTextFromPdf(file)`**: Extrair texto de PDF (PDF.js)
- **`getFileIcon(fileType)`**: Ícone baseado no tipo
- Suporte para:
  - PDF (extração de texto)
  - Imagens (base64)
  - Texto (leitura direta)

### 8.6 Áudio (TTS)
- **`base64ToArrayBuffer(base64)`**: Converter base64 para ArrayBuffer
- **`pcmToWav(pcmData, sampleRate)`**: Converter PCM para WAV
- **`setupAudioEventListeners()`**: Configurar eventos de áudio
- **`setupWordHighlighting(audio)`**: Destaque de palavras durante reprodução
- **`resetAudioPlayer()`**: Resetar player

### 8.7 Calendário
- **`generateCalendar(year, month)`**: Gerar grid do calendário
- Navegação entre meses
- Destaque para dia atual

### 8.8 Banner Carousel
- **`setupBannerCarousel()`**: Configurar carrossel
- 4 banners rotativos
- Transição automática a cada 5 segundos

### 8.9 Aprendizado Inteligente
- **`setupLearningButton(buttonId, promptTemplate, ...)`**: Configurar botões de IA
- **`renderInteractiveQuestion(question, container, title)`**: Renderizar questão
- **`renderInteractiveFlashcards(flashcards, container, title)`**: Renderizar flashcards
- **`renderGuidedLearningChat(initialMessage, container, title)`**: Renderizar chat

---

## 9. 🎨 ESTILOS E ANIMAÇÕES

### 9.1 Variáveis CSS
- `--primary-bg`: #ffffff
- `--secondary-bg`: #f7f8fa
- `--sidebar-bg`: #f1f5f9
- `--text-primary`: #1e293b
- `--text-secondary`: #64748b
- `--accent-color`: #3b82f6
- `--accent-hover`: #2563eb
- `--card-border`: #e2e8f0
- `--shadow-sm`: Sombra pequena
- `--shadow-md`: Sombra média

### 9.2 Animações
- **`@keyframes spin`**: Rotação do loader
- **`@keyframes fade-in`**: Fade in para elementos
- **`.animate-fade-in`**: Classe para fade in
- **`.animate-pulse`**: Pulse animation (Tailwind)

### 9.3 Transições
- Sidebar: expansão/colapso (0.3s)
- Cards: hover effect (0.2s)
- Menu semiológico: slide in/out
- FAB options: fade in com delay escalonado

---

## 10. 📚 BIBLIOTECAS E DEPENDÊNCIAS

### 10.1 CSS Frameworks
- **Tailwind CSS** (CDN)
- **Google Fonts** (Inter)

### 10.2 JavaScript Libraries
- **PDF.js** (2.11.338): Extração de texto de PDFs
- **Web Speech API**: Transcrição de voz
- **Google Gemini API**: 
  - Modelo: `gemini-2.5-flash-preview-05-20`
  - TTS Model: `gemini-2.5-flash-preview-tts`

---

## 11. 💾 DADOS SIMULADOS

### 11.1 Base de Dados
- **`notesData`**: Array de 20 notas simuladas
- **`questionsData`**: Array de 20 conjuntos de questões
- **`articlesData`**: Array de 20 artigos
- **`flashcardsData`**: Array de decks de flashcards
- **`userProfile`**: Objeto com dados do usuário

### 11.2 Estrutura de Dados

#### Nota
```javascript
{
  id: number,
  title: string,
  content: string,
  tags: string[],
  folder: string,
  favorite: boolean
}
```

#### Questão
```javascript
{
  id: number,
  title: string,
  description: string,
  relatedNoteId: number,
  tags: string[],
  questionCount: number
}
```

#### Artigo
```javascript
{
  id: number,
  title: string,
  source: string,
  relatedNoteId: number,
  tags: string[]
}
```

#### Flashcard Deck
```javascript
{
  id: number,
  title: string,
  new: number,
  learning: number,
  review: number
}
```

---

## 12. 🔧 FUNCIONALIDADES ESPECIAIS

### 12.1 Processamento de Texto
- Formatação (negrito, itálico, sublinhado)
- Seleção de cor
- Tradução de termos
- Aprimoramento de termos (IA)

### 12.2 Processamento de Arquivos
- Extração de texto de PDF
- Preview de imagens
- Resumo automático (IA)
- Transcrição complementar

### 12.3 Integração com IA
- Geração de passagem de caso
- Sugestões semiológicas
- Questões personalizadas
- Artigos relacionados (UpToDate)
- Flashcards gerados
- Chat interativo
- Text-to-Speech
- Formatação de transcrições

### 12.4 Sistema de Busca
- Barra de busca no header
- Placeholder: "Buscar notas, artigos, questões..."

---

## 13. 📱 RESPONSIVIDADE

### 13.1 Grids Responsivos
- **Notas**: 1 col (mobile) → 2 col (sm) → 3 col (lg) → 4 col (xl)
- **Pastas**: 2 col (mobile) → 3 col (sm) → 5 col (lg)
- **Sugestões de Estudo**: 1 col (mobile) → 3 col (md)

### 13.2 Breakpoints (Tailwind)
- `sm`: 640px
- `md`: 768px
- `lg`: 1024px
- `xl`: 1280px

---

## 14. 🎯 EVENTOS E LISTENERS

### 14.1 Eventos Globais
- Click fora para fechar menus
- Toggle sidebar
- Toggle FAB
- Navegação entre telas

### 14.2 Eventos de Formulário
- Submit de chat
- Upload de arquivos
- Drag & drop
- Seleção de arquivo

### 14.3 Eventos de Áudio
- Play/Pause
- Timeupdate
- Ended
- Progress bar interaction

### 14.4 Eventos de Transcrição
- Start/Stop recognition
- Result processing
- Error handling

---

## 15. 🔐 CONFIGURAÇÕES

### 15.1 API Keys
- **`GEMINI_API_KEY`**: Chave da API do Google Gemini
- Armazenada como constante no JavaScript

### 15.2 Configurações de Usuário
- Nome, prefixo, título
- Iniciais para avatar
- Preferências (simuladas)

---

## 📊 RESUMO ESTATÍSTICO

- **Total de Telas**: 12
- **Total de Componentes UI**: 50+
- **Total de Funções JavaScript**: 30+
- **Total de Event Listeners**: 40+
- **Linhas de Código**: ~3065
- **Bibliotecas Externas**: 3
- **APIs Integradas**: 2 (Gemini, Web Speech)

---

## 🎯 FUNCIONALIDADES PRINCIPAIS

1. ✅ Gerenciamento de notas clínicas
2. ✅ Organização por pastas e tags
3. ✅ Sistema de favoritos
4. ✅ Upload e processamento de arquivos (PDF, imagens, texto)
5. ✅ Transcrição de voz com processamento IA
6. ✅ Geração de passagem de caso
7. ✅ Text-to-Speech com controle de velocidade
8. ✅ Sugestões semiológicas (IA)
9. ✅ Questões interativas personalizadas
10. ✅ Busca de artigos no UpToDate
11. ✅ Geração de flashcards
12. ✅ Chat guiado para estudo
13. ✅ Calendário de eventos
14. ✅ Sistema de busca
15. ✅ Perfil do usuário com sugestões IA

---

**Documento gerado a partir da análise do arquivo `1.2MedMind.html`**
