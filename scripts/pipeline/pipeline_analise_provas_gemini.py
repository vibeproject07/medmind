#!/usr/bin/env python3
"""
Pipeline de Análise de Provas — MedMind  [VARIANTE: GEMINI SEARCH]
====================================================================
Busca de comentários via Gemini + Google Search Grounding (Fase 3).

Fluxo completo em 7 etapas:

  1. Lê o arquivo JSON de provas produzido pelo crawler
  2. Constrói queries otimizadas por prova
  3. Busca e filtra comentários via Gemini + Google Search Grounding  ← Gemini
  4. Salva checkpoint intermediário dos comentários já filtrados
  5. Consolidação leve (Gemini já filtrou na Fase 3 — etapa simplificada)
  6. Sintetiza com Claude via Batches API (50 % de desconto)
  7. Salva resultado enriquecido em JSON + CSV

Comparação com a variante Tavily (pipeline_analise_provas_tavily.py):
  Tavily:  API dedicada de busca → volume alto de resultados brutos → Gemini filtra
  Gemini:  Gemini + Google Search Grounding → busca e filtra em 1 chamada → menor volume

Como funciona o Google Search Grounding:
  O Gemini busca na web em tempo real usando a infraestrutura do Google Search.
  O modelo lê os resultados encontrados, filtra o relevante e gera um resumo
  já enriquecido com citações — combinando as Fases 3 e 5 em uma única chamada.

Vantagens em relação ao Tavily:
  ✔ Uma API a menos (sem TAVILY_API_KEY)
  ✔ Filtro integrado: Gemini já entende o contexto médico
  ✔ Menor custo por busca para volumes médios
  ✔ Fontes citadas automaticamente no resultado

Limitações em relação ao Tavily:
  ✘ Rate limit mais restrito (60 RPM no Free Tier)
  ✘ Sem controle de domínio (não filtra por sanarmed.com, medway.com.br etc.)
  ✘ Volume de resultados brutos menor (Gemini pré-seleciona)

Uso básico:
  python pipeline_analise_provas_gemini.py caminho/para/provas.json

Opções úteis:
  --limite 10          Processa só 10 provas (ótimo para testar)
  --pular-busca        Usa cache já salvo em intermediario/
  --retomar-batch ID   Retoma um batch Claude já enviado
  --output PASTA       Pasta de saída (padrão: dados/pipeline_output_gemini)
  --workers N          Threads paralelas para buscas Gemini (padrão: 5)

Variáveis de ambiente obrigatórias:
  GEMINI_API_KEY      — obtenha em https://aistudio.google.com/apikey
  ANTHROPIC_API_KEY   — obtenha em https://platform.anthropic.com

O script carrega automaticamente .env.local e .env se existirem.

Dependências:
  pip install anthropic google-generativeai python-dotenv tqdm
"""

import os
import json
import time
import csv
import logging
import argparse
import concurrent.futures
from datetime import datetime
from pathlib import Path
from typing import Optional

# ── Imports opcionais com mensagens claras ──────────────────────────────────

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*args, **kwargs):
        pass

try:
    from tqdm import tqdm
    TQDM_OK = True
except ImportError:
    def tqdm(iterable, **kwargs):
        return iterable
    TQDM_OK = False

try:
    import google.generativeai as genai
    GEMINI_OK = True
except ImportError:
    genai = None
    GEMINI_OK = False

try:
    import anthropic
    CLAUDE_OK = True
except ImportError:
    anthropic = None
    CLAUDE_OK = False


# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURAÇÕES
# ══════════════════════════════════════════════════════════════════════════════

# System prompt compartilhado entre todas as requisições Claude
# (usa prompt caching — economiza até 90 % nos tokens repetidos)
CLAUDE_SYSTEM_PROMPT = (
    "Você é um especialista em educação médica e análise de provas de residência médica no Brasil. "
    "Sua tarefa é analisar comentários coletados sobre uma prova e produzir uma síntese estruturada, "
    "objetiva e tecnicamente precisa.\n\n"
    "Diretrizes de análise:\n"
    "- Priorize comentários de professores especialistas e bancas oficiais\n"
    "- Fóruns e redes sociais têm peso menor, mas indicam percepção dos candidatos\n"
    "- Identifique consensos e divergências entre as fontes\n"
    "- Avalie padrão de dificuldade, áreas cobradas e armadilhas frequentes\n"
    "- Retorne SEMPRE um JSON válido, sem texto fora da estrutura solicitada"
)

# Controle de taxa para Gemini (Free Tier: 60 RPM; pago: 1000+ RPM)
# Ajuste conforme seu plano para evitar erros 429
_GEMINI_DELAY_ENTRE_CHAMADAS = 1.2  # segundos entre chamadas (50 req/min)
_GEMINI_DELAY_ERRO = 15.0           # segundos após erro de rate limit


# ══════════════════════════════════════════════════════════════════════════════
# LOGGING
# ══════════════════════════════════════════════════════════════════════════════

def configurar_logging(output_dir: Path) -> None:
    log_dir = output_dir / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(log_dir / f"pipeline_{ts}.log", encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )


# ══════════════════════════════════════════════════════════════════════════════
# FASE 1 — CARGA DO JSON
# ══════════════════════════════════════════════════════════════════════════════

def carregar_provas(caminho_json: str) -> list:
    """
    Lê o arquivo JSON do crawler e retorna lista de provas.
    Aceita tanto {"provas": [...]} quanto [...] diretamente.
    """
    with open(caminho_json, "r", encoding="utf-8") as f:
        dados = json.load(f)

    if isinstance(dados, dict):
        provas = dados.get("provas", dados.get("data", []))
    else:
        provas = dados

    logging.info(f"[Fase 1] {len(provas)} provas carregadas de '{caminho_json}'")
    return provas


# ══════════════════════════════════════════════════════════════════════════════
# FASE 2 — CONSTRUÇÃO DE QUERIES
# ══════════════════════════════════════════════════════════════════════════════

def construir_query(prova: dict) -> str:
    """
    Monta uma query de busca otimizada para o Gemini Search Grounding.
    Frases em linguagem natural funcionam melhor com o modelo.
    """
    nome  = prova.get("nome", "").strip()
    banca = prova.get("banca", "").strip()
    ano   = str(prova.get("ano", "")).strip()
    tipo  = prova.get("tipo", "").strip()

    partes = [p for p in [banca, ano, tipo] if p]
    contexto = " ".join(partes)

    # Query mais descritiva: Gemini lida melhor com linguagem natural que com palavras-chave cruas
    query = (
        f'comentários análise gabarito prova de residência médica {contexto} '
        f'"{nome}" — análise de professores, dificuldade, áreas cobradas, polêmicas'
    )
    return query[:500]


# ══════════════════════════════════════════════════════════════════════════════
# FASE 3 — BUSCA COM GEMINI SEARCH GROUNDING
# ══════════════════════════════════════════════════════════════════════════════

def _criar_model_com_grounding() -> "genai.GenerativeModel":
    """
    Cria um modelo Gemini configurado com Google Search Grounding.
    O modelo busca na web em tempo real e cita as fontes encontradas.
    """
    try:
        # Google Search Grounding dinâmico — aciona busca quando necessário
        tool_busca = genai.protos.Tool(
            google_search_retrieval=genai.protos.GoogleSearchRetrieval(
                dynamic_retrieval_config=genai.protos.DynamicRetrievalConfig(
                    mode=genai.protos.DynamicRetrievalConfig.Mode.MODE_DYNAMIC,
                    dynamic_threshold=0.3,  # 0.0 = sempre busca; 1.0 = nunca
                )
            )
        )
        return genai.GenerativeModel("gemini-1.5-flash", tools=[tool_busca])
    except AttributeError:
        # Fallback: versões mais antigas do SDK usam string simples
        logging.warning(
            "  google.generativeai.protos não disponível — usando sintaxe alternativa de grounding"
        )
        return genai.GenerativeModel(
            "gemini-1.5-flash",
            tools=[{"google_search_retrieval": {"dynamic_retrieval_config": {"dynamic_threshold": 0.3}}}],
        )


def _extrair_fontes_grounding(resposta) -> list:
    """
    Extrai as URLs e títulos das fontes usadas pelo Gemini via grounding metadata.
    """
    fontes = []
    try:
        meta = resposta.candidates[0].grounding_metadata
        if not meta:
            return fontes
        chunks = getattr(meta, "grounding_chunks", None) or []
        for chunk in chunks:
            web = getattr(chunk, "web", None)
            if web:
                fontes.append({
                    "url":    getattr(web, "uri", ""),
                    "titulo": getattr(web, "title", ""),
                })
    except (AttributeError, IndexError):
        pass
    return fontes


def buscar_gemini(prova: dict, model) -> dict:
    """
    Usa Gemini + Google Search Grounding para buscar e pré-filtrar
    comentários sobre a prova em uma única chamada.

    Combina as Fases 3 e 5 do pipeline Tavily em uma só etapa:
    o modelo busca na web, lê os resultados e retorna apenas o relevante.
    """
    nome  = prova.get("nome", "?")
    query = construir_query(prova)

    prompt = f"""Você é um especialista em provas de residência médica no Brasil.

Pesquise e analise comentários, análises e discussões disponíveis na web sobre:
PROVA: {prova.get("nome", "")}
BANCA: {prova.get("banca", "")}
ANO: {prova.get("ano", "")}

Usando as informações encontradas, produza um relatório consolidado contendo:
1. Percepção geral dos candidatos (fácil/difícil, justa/tendenciosa)
2. Áreas e especialidades mais cobradas
3. Comentários de professores e cursinos especializados
4. Polêmicas, questões anuladas ou gabaritos alterados (se houver)
5. Dicas de estudo mencionadas por especialistas

Se não encontrar informações específicas sobre esta prova, informe claramente.
Seja objetivo e cite as fontes encontradas.

Busque por: {query}"""

    for tentativa in range(3):
        try:
            resposta = model.generate_content(prompt)
            texto = resposta.text.strip() if resposta.text else ""
            fontes = _extrair_fontes_grounding(resposta)

            logging.info(
                f"  Gemini Search OK: '{nome}' — {len(texto)} chars | {len(fontes)} fonte(s) citada(s)"
            )
            return {
                **prova,
                "comentarios_brutos": [
                    {
                        "url":      f.get("url", ""),
                        "titulo":   f.get("titulo", ""),
                        "conteudo": texto,  # Gemini já consolidou todo o conteúdo
                        "score":    1.0,
                    }
                ] if fontes else (
                    [{"url": "", "titulo": "Gemini Search", "conteudo": texto, "score": 0.8}]
                    if texto else []
                ),
                "comentarios_filtrados": texto,  # Já filtrado — Phase 5 é pass-through
                "fontes_grounding": fontes,
                "query_usada": query,
            }

        except Exception as exc:
            msg = str(exc)
            if "429" in msg or "quota" in msg.lower() or "rate" in msg.lower():
                espera = _GEMINI_DELAY_ERRO * (tentativa + 1)
                logging.warning(
                    f"  Gemini rate limit para '{nome}' — aguardando {espera:.0f}s (tentativa {tentativa + 1}/3)"
                )
                time.sleep(espera)
            elif tentativa < 2:
                espera = 3.0 * (tentativa + 1)
                logging.warning(f"  Gemini tentativa {tentativa + 1} falhou para '{nome}': {exc}. Retry em {espera}s")
                time.sleep(espera)
            else:
                logging.error(f"  Gemini falhou definitivamente para '{nome}': {exc}")
                return {
                    **prova,
                    "comentarios_brutos": [],
                    "comentarios_filtrados": "",
                    "fontes_grounding": [],
                    "query_usada": query,
                    "erro_busca": msg,
                }

    return {**prova, "comentarios_brutos": [], "comentarios_filtrados": "", "fontes_grounding": [], "query_usada": query}


def fase_busca_gemini(provas: list, model, max_workers: int = 5) -> list:
    """
    Executa a busca Gemini+Grounding em paralelo (com controle de taxa).

    Usa menos threads que o Tavily pois o Gemini tem rate limit mais restrito.
    O delay entre chamadas garante ~50 req/min no Free Tier.
    """
    logging.info(
        f"[Fase 3] Buscando comentários para {len(provas)} provas "
        f"via Gemini Search Grounding ({max_workers} threads, ~{int(60 / _GEMINI_DELAY_ENTRE_CHAMADAS)} req/min)..."
    )

    import threading
    _rate_lock = threading.Semaphore(max_workers)
    _last_call = [0.0]
    _call_lock = threading.Lock()

    def _buscar_com_rate_limit(prova):
        with _rate_lock:
            with _call_lock:
                agora = time.time()
                delta = agora - _last_call[0]
                if delta < _GEMINI_DELAY_ENTRE_CHAMADAS:
                    time.sleep(_GEMINI_DELAY_ENTRE_CHAMADAS - delta)
                _last_call[0] = time.time()
            return buscar_gemini(prova, model)

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        resultados = list(tqdm(
            executor.map(_buscar_com_rate_limit, provas),
            total=len(provas),
            desc="Gemini Search — buscando",
        ))

    total_fontes = sum(len(p.get("fontes_grounding", [])) for p in resultados)
    total_com_conteudo = sum(1 for p in resultados if p.get("comentarios_filtrados"))
    logging.info(
        f"[Fase 3] Concluído: {total_com_conteudo}/{len(resultados)} provas com conteúdo | "
        f"{total_fontes} fontes citadas no total"
    )
    return resultados


# ══════════════════════════════════════════════════════════════════════════════
# FASE 4 — CHECKPOINT INTERMEDIÁRIO
# ══════════════════════════════════════════════════════════════════════════════

def salvar_checkpoint(dados, caminho: Path) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=2)
    logging.info(f"[Checkpoint] Salvo: {caminho}")


def carregar_checkpoint(caminho: Path):
    if caminho.exists():
        with open(caminho, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


# ══════════════════════════════════════════════════════════════════════════════
# FASE 5 — CONSOLIDAÇÃO (simplificada: Gemini já filtrou na Fase 3)
# ══════════════════════════════════════════════════════════════════════════════

def consolidar_gemini(prova: dict, model_consolidador) -> dict:
    """
    Fase 5 simplificada para a variante Gemini.

    Como o Gemini já filtrou e resumiu o conteúdo na Fase 3 via Search Grounding,
    esta etapa faz apenas uma passagem leve para:
    - Verificar se o conteúdo já está adequado (pass-through quando qualidade boa)
    - Refinar a estrutura quando necessário (truncar, remover duplicatas)
    - Garantir cobertura mínima antes de enviar ao Claude
    """
    filtrado = (prova.get("comentarios_filtrados") or "").strip()

    # Se o Gemini já gerou conteúdo suficiente, passa direto ao Claude
    if len(filtrado) >= 200:
        return prova

    # Conteúdo insuficiente: tenta consolidar o que há em comentarios_brutos
    brutos = prova.get("comentarios_brutos", [])
    if not brutos:
        return {**prova, "comentarios_filtrados": filtrado}

    textos = [
        (c.get("conteudo") or "")[:2000]
        for c in brutos
        if (c.get("conteudo") or "").strip()
    ]
    if not textos:
        return {**prova, "comentarios_filtrados": filtrado}

    prompt = (
        f"Resuma em até 800 palavras os comentários abaixo sobre a prova "
        f'"{prova.get("nome", "")}", focando em: dificuldade, áreas cobradas, '
        f"análises de especialistas e polêmicas.\n\n"
        + "\n\n".join(textos)
    )

    try:
        resposta = model_consolidador.generate_content(prompt)
        texto = resposta.text.strip()
        return {**prova, "comentarios_filtrados": texto}
    except Exception as exc:
        logging.warning(f"  Consolidação Fase 5 falhou para '{prova.get('nome', '?')}': {exc}")
        return {**prova, "comentarios_filtrados": "\n\n".join(textos)[:3000]}


def fase_consolidacao(provas: list, model) -> list:
    """Consolidação leve — pass-through quando Gemini Search já gerou conteúdo adequado."""
    logging.info(f"[Fase 5] Consolidando {len(provas)} provas (Gemini Search já pré-filtrou)...")
    consolidadas = []
    for prova in tqdm(provas, desc="Fase 5 — consolidando"):
        consolidadas.append(consolidar_gemini(prova, model))
        time.sleep(0.1)  # Delay mínimo — maioria será pass-through
    passou_direto = sum(1 for p in consolidadas if len((p.get("comentarios_filtrados") or "")) >= 200)
    logging.info(f"[Fase 5] Concluído: {passou_direto}/{len(consolidadas)} provas passaram direto (sem reprocessamento)")
    return consolidadas


# ══════════════════════════════════════════════════════════════════════════════
# FASE 6 — BATCH CLAUDE
# ══════════════════════════════════════════════════════════════════════════════

def selecionar_modelo_claude(qtd_chars: int) -> Optional[str]:
    """
    Escolhe o modelo Claude de forma dinâmica, balanceando custo e qualidade.
    Retorna None se não há comentários suficientes para análise.
    """
    if qtd_chars == 0:
        return None
    if qtd_chars < 300:
        return "claude-haiku-4-5"
    return "claude-sonnet-4-5"  # Padrão recomendado (batch = 50% off)


def montar_requisicao_claude(prova: dict) -> Optional[dict]:
    """
    Monta uma requisição individual para o Claude Batch.
    Usa prompt caching no system prompt para economizar tokens.
    """
    nome        = prova.get("nome", "Prova sem nome")
    banca       = prova.get("banca", "")
    ano         = str(prova.get("ano", ""))
    tipo        = prova.get("tipo", "")
    comentarios = prova.get("comentarios_filtrados", "") or ""
    n_questoes  = len(prova.get("questoes", []))
    n_fontes    = len(prova.get("fontes_grounding", prova.get("comentarios_brutos", [])))

    modelo = selecionar_modelo_claude(len(comentarios))
    if modelo is None:
        return None

    prompt_usuario = f"""Analise a prova abaixo com base nos comentários coletados via Google Search.

PROVA: {nome}
BANCA: {banca}
ANO: {ano}
TIPO: {tipo}
QUESTÕES: {n_questoes}
FONTES CONSULTADAS: {n_fontes}

COMENTÁRIOS E ANÁLISES COLETADOS (via Gemini + Google Search Grounding):
{comentarios if comentarios.strip() else "Nenhum comentário encontrado."}

Produza a análise no seguinte formato JSON (retorne APENAS o JSON, sem texto fora da estrutura):
{{
  "resumo_geral": "Parágrafo conciso descrevendo a prova e seu perfil",
  "nivel_dificuldade": "fácil | médio | difícil | muito difícil",
  "areas_mais_cobradas": ["área 1", "área 2", "área 3"],
  "conteudos_recorrentes": ["conteúdo 1", "conteúdo 2"],
  "pontos_consenso": ["ponto onde as fontes concordam"],
  "pontos_controversia": ["ponto de divergência entre fontes"],
  "qualidade_das_questoes": "Avaliação técnica das questões (clareza, pertinência, nível)",
  "perfil_candidato_ideal": "Descrição do candidato mais apto para esta prova",
  "recomendacoes_estudo": ["recomendação 1", "recomendação 2", "recomendação 3"],
  "erros_ou_polemicas_banca": "Registro de polêmicas, gabaritos alterados ou questões anuladas (se houver)",
  "confiabilidade_analise": "alta | média | baixa"
}}"""

    custom_id = "prova-" + "".join(c if c.isalnum() else "-" for c in nome)[:60].strip("-")

    return {
        "custom_id": custom_id,
        "params": {
            "model": modelo,
            "max_tokens": 1200,
            "system": [
                {
                    "type": "text",
                    "text": CLAUDE_SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},  # Cache por 1h — economia de tokens
                }
            ],
            "messages": [{"role": "user", "content": prompt_usuario}],
        },
    }


def fase_batch_claude(provas: list, client) -> tuple:
    """
    Envia o batch ao Claude, aguarda processamento e coleta os resultados.
    Retorna (batch_id, requisicoes).
    """
    logging.info(f"[Fase 6] Montando batch Claude para {len(provas)} provas...")

    requisicoes = []
    puladas = 0
    for prova in provas:
        req = montar_requisicao_claude(prova)
        if req:
            requisicoes.append(req)
        else:
            puladas += 1

    logging.info(f"  {len(requisicoes)} requisições | {puladas} provas sem comentários (puladas)")

    if not requisicoes:
        logging.warning("  Nenhuma requisição para enviar. Verifique se o Gemini Search retornou conteúdo.")
        return None, {}

    batch = client.messages.batches.create(requests=requisicoes)
    batch_id = batch.id
    logging.info(f"  Batch enviado: {batch_id}")

    return batch_id, requisicoes


def aguardar_batch(batch_id: str, client) -> dict:
    """Faz polling do status do batch até processar e retorna resultados."""
    logging.info(f"[Fase 6] Aguardando batch {batch_id}...")

    while True:
        batch = client.messages.batches.retrieve(batch_id)
        status = batch.processing_status
        contagem = batch.request_counts

        logging.info(
            f"  Status: {status} | "
            f"processando: {contagem.processing} | "
            f"sucesso: {contagem.succeeded} | "
            f"erro: {contagem.errored}"
        )

        if status == "ended":
            break

        time.sleep(60)  # Claude Batches tipicamente processa em 1–15 min

    resultados = {}
    erros = 0
    for item in client.messages.batches.results(batch_id):
        if item.result.type == "succeeded":
            resultados[item.custom_id] = item.result.message.content[0].text
        else:
            erros += 1
            logging.warning(f"  Requisição falhou: {item.custom_id} ({item.result.type})")

    logging.info(f"[Fase 6] Concluído: {len(resultados)} sucessos, {erros} erros")
    return resultados


# ══════════════════════════════════════════════════════════════════════════════
# FASE 7 — SAÍDA FINAL
# ══════════════════════════════════════════════════════════════════════════════

def salvar_resultados(provas: list, resultados_batch: dict, output_dir: Path) -> tuple:
    """
    Mescla as sínteses do Claude em cada prova e exporta:
      - provas_analisadas_YYYYMMDD_HHMMSS.json  (JSON completo enriquecido)
      - resumo_analise_YYYYMMDD_HHMMSS.csv       (planilha resumida)
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    for prova in provas:
        nome = prova.get("nome", "")
        custom_id = "prova-" + "".join(c if c.isalnum() else "-" for c in nome)[:60].strip("-")

        sintese_raw = resultados_batch.get(custom_id)
        if sintese_raw:
            try:
                texto = sintese_raw.strip()
                if texto.startswith("```"):
                    texto = texto.split("```", 2)[-1].lstrip("json").strip()
                    if texto.endswith("```"):
                        texto = texto[:-3].strip()
                prova["analise_ia"] = json.loads(texto)
            except json.JSONDecodeError:
                prova["analise_ia"] = {"resumo_geral": sintese_raw, "parse_error": True}
        else:
            prova["analise_ia"] = None

        # Campos de fontes do Gemini Grounding são mantidos; campos volumosos removidos
        prova.pop("comentarios_filtrados", None)
        prova.pop("query_usada", None)

    # ── JSON completo ─────────────────────────────────────────────────────────
    json_path = output_dir / f"provas_analisadas_{ts}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "provas": provas,
                "gerado_em": ts,
                "total": len(provas),
                "pipeline": "gemini_search_grounding",
            },
            f,
            ensure_ascii=False,
            indent=2,
        )
    logging.info(f"[Fase 7] JSON salvo: {json_path}")

    # ── CSV resumido ──────────────────────────────────────────────────────────
    csv_path = output_dir / f"resumo_analise_{ts}.csv"
    campos = [
        "nome", "banca", "ano", "tipo", "num_questoes", "num_fontes_grounding",
        "nivel_dificuldade", "resumo_geral",
        "areas_mais_cobradas", "conteudos_recorrentes",
        "recomendacoes_estudo", "erros_ou_polemicas_banca",
        "confiabilidade_analise",
    ]
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=campos)
        writer.writeheader()
        for prova in provas:
            analise = prova.get("analise_ia") or {}
            fontes  = prova.get("fontes_grounding", prova.get("comentarios_brutos", []))
            writer.writerow({
                "nome":                    prova.get("nome", ""),
                "banca":                   prova.get("banca", ""),
                "ano":                     prova.get("ano", ""),
                "tipo":                    prova.get("tipo", ""),
                "num_questoes":            len(prova.get("questoes", [])),
                "num_fontes_grounding":    len(fontes),
                "nivel_dificuldade":       analise.get("nivel_dificuldade", ""),
                "resumo_geral":            analise.get("resumo_geral", ""),
                "areas_mais_cobradas":     "; ".join(analise.get("areas_mais_cobradas", [])),
                "conteudos_recorrentes":   "; ".join(analise.get("conteudos_recorrentes", [])),
                "recomendacoes_estudo":    "; ".join(analise.get("recomendacoes_estudo", [])),
                "erros_ou_polemicas_banca": analise.get("erros_ou_polemicas_banca", ""),
                "confiabilidade_analise":  analise.get("confiabilidade_analise", ""),
            })
    logging.info(f"[Fase 7] CSV salvo: {csv_path}")

    return json_path, csv_path


# ══════════════════════════════════════════════════════════════════════════════
# ORQUESTRADOR PRINCIPAL
# ══════════════════════════════════════════════════════════════════════════════

def pipeline_completo(
    caminho_json: str,
    output_dir: Path,
    limite: Optional[int] = None,
    max_workers: int = 5,
    pular_busca: bool = False,
    retomar_batch_id: Optional[str] = None,
) -> None:

    output_dir.mkdir(parents=True, exist_ok=True)
    configurar_logging(output_dir)
    intermediario = output_dir / "intermediario"

    logging.info("=" * 62)
    logging.info("  PIPELINE DE ANÁLISE DE PROVAS — MEDMIND [GEMINI SEARCH]")
    logging.info("=" * 62)

    # ── Verificar dependências e chaves ──────────────────────────────────────
    faltando = []
    if not GEMINI_OK:
        faltando.append("google-generativeai  (pip install google-generativeai)")
    if not CLAUDE_OK:
        faltando.append("anthropic  (pip install anthropic)")
    if faltando:
        raise ImportError(
            "Dependências faltando. Instale com:\n  pip install "
            + " ".join(["anthropic", "google-generativeai", "python-dotenv", "tqdm"])
            + "\n\nPacotes com problema:\n  " + "\n  ".join(faltando)
        )

    erros_env = []
    if not os.environ.get("GEMINI_API_KEY"):
        erros_env.append("GEMINI_API_KEY não configurada")
    if not os.environ.get("ANTHROPIC_API_KEY"):
        erros_env.append("ANTHROPIC_API_KEY não configurada")
    if erros_env:
        msg = "\n  ".join(erros_env)
        raise EnvironmentError(
            f"Variáveis de ambiente ausentes:\n  {msg}\n\n"
            "Configure no arquivo .env.local ou exporte no terminal antes de executar."
        )

    # ── Inicializar clientes ──────────────────────────────────────────────────
    genai.configure(api_key=os.environ["GEMINI_API_KEY"])
    gemini_search_model     = _criar_model_com_grounding()          # Fase 3: busca + filtro
    gemini_consolidador     = genai.GenerativeModel("gemini-1.5-flash")  # Fase 5: consolidação leve
    claude_client           = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    # ── FASE 1: Carregar provas ───────────────────────────────────────────────
    provas = carregar_provas(caminho_json)
    if limite:
        provas = provas[:limite]
        logging.info(f"  (modo teste: limitado a {limite} provas)")

    # ── FASE 2-3: Busca Gemini Search Grounding ───────────────────────────────
    cache_brutos = intermediario / "comentarios_brutos_gemini.json"

    if pular_busca:
        dados_cache = carregar_checkpoint(cache_brutos)
        if dados_cache:
            logging.info(f"[Fase 3] Pulando busca — usando cache: {cache_brutos}")
            provas_com_comentarios = dados_cache
        else:
            logging.warning("[Fase 3] --pular-busca ativo mas cache não encontrado. Executando busca...")
            provas_com_comentarios = fase_busca_gemini(provas, gemini_search_model, max_workers)
            salvar_checkpoint(provas_com_comentarios, cache_brutos)
    else:
        provas_com_comentarios = fase_busca_gemini(provas, gemini_search_model, max_workers)
        salvar_checkpoint(provas_com_comentarios, cache_brutos)  # Fase 4: checkpoint

    # ── FASE 5: Consolidação leve ─────────────────────────────────────────────
    # A maioria das provas já terá conteúdo suficiente da Fase 3 (pass-through).
    # Esta fase só reprocessa provas com conteúdo insuficiente.
    cache_filtrados = intermediario / "comentarios_filtrados_gemini.json"
    provas_filtradas = fase_consolidacao(provas_com_comentarios, gemini_consolidador)
    salvar_checkpoint(provas_filtradas, cache_filtrados)

    # ── FASE 6: Batch Claude ──────────────────────────────────────────────────
    resultados_batch = {}

    if retomar_batch_id:
        logging.info(f"[Fase 6] Retomando batch Claude: {retomar_batch_id}")
        resultados_batch = aguardar_batch(retomar_batch_id, claude_client)
    else:
        batch_id, _ = fase_batch_claude(provas_filtradas, claude_client)
        if batch_id:
            salvar_checkpoint(
                {"batch_id": batch_id, "timestamp": datetime.now().isoformat()},
                intermediario / "batch_info.json",
            )
            resultados_batch = aguardar_batch(batch_id, claude_client)

    # ── FASE 7: Salvar output final ───────────────────────────────────────────
    if resultados_batch:
        json_path, csv_path = salvar_resultados(provas_filtradas, resultados_batch, output_dir / "saida")
    else:
        logging.warning("[Fase 7] Nenhum resultado para salvar.")
        return

    # ── Resumo final ─────────────────────────────────────────────────────────
    logging.info("=" * 62)
    logging.info("  PIPELINE CONCLUÍDO COM SUCESSO!")
    logging.info(f"  JSON  → {json_path}")
    logging.info(f"  CSV   → {csv_path}")
    logging.info("=" * 62)


# ══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    for env_file in [".env.local", ".env", "../.env.local", "../.env"]:
        if Path(env_file).exists():
            load_dotenv(env_file)
            break

    parser = argparse.ArgumentParser(
        description="Pipeline MedMind [Gemini]: Gemini Search Grounding → Claude Batches",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemplos de uso:

  # Rodar em modo teste com 5 provas
  python pipeline_analise_provas_gemini.py provas.json --limite 5

  # Rodar pipeline completo
  python pipeline_analise_provas_gemini.py provas.json

  # Pular etapa de busca (usar cache já gerado)
  python pipeline_analise_provas_gemini.py provas.json --pular-busca

  # Retomar batch Claude interrompido (pular busca + usar batch já enviado)
  python pipeline_analise_provas_gemini.py provas.json --pular-busca --retomar-batch msgbatch_xxx

Variáveis de ambiente necessárias (sem Tavily!):
  GEMINI_API_KEY      https://aistudio.google.com/apikey
  ANTHROPIC_API_KEY   https://platform.anthropic.com
        """,
    )
    parser.add_argument(
        "json",
        help="Caminho para o arquivo JSON de provas (saída do crawler)",
    )
    parser.add_argument(
        "--output",
        default="dados/pipeline_output_gemini",
        help="Pasta de saída (padrão: dados/pipeline_output_gemini)",
    )
    parser.add_argument(
        "--limite",
        type=int,
        default=None,
        help="Limitar número de provas processadas (útil para testes)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=5,
        help="Threads paralelas para buscas Gemini (padrão: 5 — respeita rate limit)",
    )
    parser.add_argument(
        "--pular-busca",
        action="store_true",
        help="Pular etapa de busca Gemini e usar cache existente em intermediario/",
    )
    parser.add_argument(
        "--retomar-batch",
        default=None,
        metavar="BATCH_ID",
        help="ID de um batch Claude já enviado para retomar (ex: msgbatch_xxx)",
    )

    args = parser.parse_args()

    pipeline_completo(
        caminho_json=args.json,
        output_dir=Path(args.output),
        limite=args.limite,
        max_workers=args.workers,
        pular_busca=args.pular_busca,
        retomar_batch_id=args.retomar_batch,
    )
