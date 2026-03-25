#!/usr/bin/env python3
"""
Pipeline de Análise de Provas — MedMind
=========================================
Fluxo completo em 7 etapas:

  1. Lê o arquivo JSON de provas produzido pelo crawler
  2. Constrói queries otimizadas por prova
  3. Busca comentários via Tavily em paralelo (10 threads)
  4. Salva checkpoint intermediário dos comentários brutos
  5. Pré-processa / filtra os comentários com Gemini
  6. Sintetiza com Claude via Batches API (50 % de desconto)
  7. Salva resultado enriquecido em JSON + CSV

Uso básico:
  python pipeline_analise_provas.py caminho/para/provas.json

Opções úteis:
  --limite 10          Processa só 10 provas (ótimo para testar)
  --pular-busca        Usa cache Tavily já salvo em intermediario/
  --pular-gemini       Usa comentários brutos, sem filtro Gemini
  --retomar-batch ID   Retoma um batch Claude já enviado
  --output PASTA       Pasta de saída (padrão: dados/pipeline_output)
  --workers N          Threads paralelas para Tavily (padrão: 10)

Variáveis de ambiente obrigatórias:
  TAVILY_API_KEY      — obtenha em https://tavily.com
  GEMINI_API_KEY      — obtenha em https://aistudio.google.com/apikey
  ANTHROPIC_API_KEY   — obtenha em https://platform.anthropic.com

O script carrega automaticamente .env.local e .env se existirem.

Dependências:
  pip install anthropic tavily-python google-generativeai python-dotenv tqdm
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
    from tavily import TavilyClient
    TAVILY_OK = True
except ImportError:
    TavilyClient = None
    TAVILY_OK = False

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

# Domínios prioritários para busca de comentários médicos
DOMINIOS_MEDICOS = [
    "sanarmed.com",
    "medway.com.br",
    "estrategiaresidencias.com.br",
    "medcel.com.br",
    "residenciamedica.com.br",
    "medgrupo.com.br",
    "qconcursos.com",
    "provaderesidencia.com.br",
    "medresumos.com.br",
    "surgicalresident.com.br",
]

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
    Monta uma query de busca otimizada para a prova.
    Prioriza: nome oficial, banca, ano e tipo de prova.
    """
    nome  = prova.get("nome", "").strip()
    banca = prova.get("banca", "").strip()
    ano   = str(prova.get("ano", "")).strip()
    tipo  = prova.get("tipo", "").strip()

    partes = [p for p in [banca, ano, tipo] if p]
    contexto = " ".join(partes)

    # Exemplo de query gerada:
    # comentários análise gabarito prova ABC 2025 R1 "ABC - SP - 2025 - R1" residência médica
    query = f'comentários análise gabarito prova {contexto} "{nome}" residência médica'
    return query[:400]  # Tavily limita queries longas


# ══════════════════════════════════════════════════════════════════════════════
# FASE 3 — BUSCA COM TAVILY (paralela)
# ══════════════════════════════════════════════════════════════════════════════

def buscar_tavily(prova: dict, client, max_resultados: int = 5) -> dict:
    """
    Busca comentários via Tavily com retry exponencial (3 tentativas).
    Retorna a prova enriquecida com o campo 'comentarios_brutos'.
    """
    query = construir_query(prova)
    nome  = prova.get("nome", "?")

    for tentativa in range(3):
        try:
            resultado = client.search(
                query=query,
                search_depth="advanced",
                max_results=max_resultados,
                include_raw_content=True,
                include_domains=DOMINIOS_MEDICOS or None,
            )

            comentarios = []
            for item in resultado.get("results", []):
                conteudo = item.get("raw_content") or item.get("content", "")
                if conteudo and conteudo.strip():
                    comentarios.append({
                        "url":      item.get("url", ""),
                        "titulo":   item.get("title", ""),
                        "conteudo": conteudo.strip(),
                        "score":    item.get("score", 0.0),
                    })

            logging.info(f"  Tavily OK: '{nome}' — {len(comentarios)} fontes encontradas")
            return {**prova, "comentarios_brutos": comentarios, "query_usada": query}

        except Exception as exc:
            if tentativa < 2:
                espera = 2 ** tentativa
                logging.warning(f"  Tavily tentativa {tentativa + 1} falhou para '{nome}': {exc}. Retry em {espera}s")
                time.sleep(espera)
            else:
                logging.error(f"  Tavily falhou definitivamente para '{nome}': {exc}")
                return {**prova, "comentarios_brutos": [], "query_usada": query, "erro_busca": str(exc)}


def fase_busca_tavily(provas: list, client, max_workers: int = 10) -> list:
    """Executa a busca Tavily em paralelo para todas as provas."""
    logging.info(f"[Fase 3] Buscando comentários para {len(provas)} provas ({max_workers} threads)...")

    def _buscar(prova):
        return buscar_tavily(prova, client)

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        resultados = list(tqdm(
            executor.map(_buscar, provas),
            total=len(provas),
            desc="Tavily — buscando",
        ))

    total_fontes = sum(len(p.get("comentarios_brutos", [])) for p in resultados)
    logging.info(f"[Fase 3] Concluído: {total_fontes} fontes coletadas no total")
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
# FASE 5 — PRÉ-PROCESSAMENTO COM GEMINI
# ══════════════════════════════════════════════════════════════════════════════

def filtrar_com_gemini(prova: dict, model) -> dict:
    """
    Usa Gemini para filtrar spam e consolidar os comentários brutos.
    Em caso de erro, faz fallback concatenando os textos brutos diretamente.
    """
    brutos = prova.get("comentarios_brutos", [])
    if not brutos:
        return {**prova, "comentarios_filtrados": ""}

    # Montar texto bruto limitado por fonte (evita ultrapassar contexto)
    trechos = []
    for i, c in enumerate(brutos, 1):
        conteudo = (c.get("conteudo") or "")[:2000]
        if conteudo.strip():
            trechos.append(
                f"[Fonte {i}: {c.get('titulo', 'sem título')} — {c.get('url', '')}]\n{conteudo}"
            )

    if not trechos:
        return {**prova, "comentarios_filtrados": ""}

    prompt_gemini = (
        f"Você recebeu comentários brutos da web sobre a prova de residência médica: "
        f'"{prova.get("nome", "")}".\n\n'
        "Filtre e consolide APENAS o conteúdo tecnicamente relevante:\n"
        "- Análises de professores e especialistas\n"
        "- Dificuldade percebida e áreas mais cobradas\n"
        "- Erros ou polêmicas da banca\n"
        "- Gabarito oficial ou extraoficial\n\n"
        "Descarte: spam, propagandas, conteúdo duplicado, comentários genéricos.\n"
        "Resposta máxima: 1500 palavras.\n\n"
        "COMENTÁRIOS BRUTOS:\n"
        + "\n\n".join(trechos)
        + "\n\nCOMENTÁRIOS FILTRADOS:"
    )

    try:
        resposta = model.generate_content(prompt_gemini)
        texto_filtrado = resposta.text.strip()
        logging.info(f"  Gemini OK: '{prova.get('nome', '?')}' — {len(texto_filtrado)} chars")
        return {**prova, "comentarios_filtrados": texto_filtrado}
    except Exception as exc:
        logging.warning(f"  Gemini falhou para '{prova.get('nome', '?')}': {exc} — usando fallback")
        fallback = "\n\n".join(trechos)[:3000]
        return {**prova, "comentarios_filtrados": fallback}


def fase_gemini(provas: list, model) -> list:
    logging.info(f"[Fase 5] Pré-processando {len(provas)} provas com Gemini...")
    filtradas = []
    for prova in tqdm(provas, desc="Gemini — filtrando"):
        filtradas.append(filtrar_com_gemini(prova, model))
        time.sleep(0.15)  # Respeitar rate limit Gemini (Free Tier: ~60 req/min)
    logging.info("[Fase 5] Pré-processamento Gemini concluído")
    return filtradas


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
    nome       = prova.get("nome", "Prova sem nome")
    banca      = prova.get("banca", "")
    ano        = str(prova.get("ano", ""))
    tipo       = prova.get("tipo", "")
    comentarios = prova.get("comentarios_filtrados", "") or ""
    n_questoes = len(prova.get("questoes", []))
    n_fontes   = len(prova.get("comentarios_brutos", []))

    modelo = selecionar_modelo_claude(len(comentarios))
    if modelo is None:
        return None

    prompt_usuario = f"""Analise a prova abaixo com base nos comentários coletados.

PROVA: {nome}
BANCA: {banca}
ANO: {ano}
TIPO: {tipo}
QUESTÕES: {n_questoes}
FONTES CONSULTADAS: {n_fontes}

COMENTÁRIOS E ANÁLISES COLETADOS:
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

    # ID único baseado no nome da prova (sem caracteres especiais)
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
    Retorna (batch_id, resultados_dict).
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
        logging.warning("  Nenhuma requisição para enviar. Verifique se a busca Tavily retornou conteúdo.")
        return None, {}

    # Enviar batch
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

    # Coletar resultados
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

    # Enriquecer cada prova com a síntese do Claude
    for prova in provas:
        nome = prova.get("nome", "")
        custom_id = "prova-" + "".join(c if c.isalnum() else "-" for c in nome)[:60].strip("-")

        sintese_raw = resultados_batch.get(custom_id)
        if sintese_raw:
            try:
                # Remover markdown ```json ... ``` se Claude retornar com blocos de código
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

        # Limpar campos intermediários volumosos do output final
        prova.pop("comentarios_brutos", None)
        prova.pop("comentarios_filtrados", None)
        prova.pop("query_usada", None)

    # ── JSON completo ─────────────────────────────────────────────────────────
    json_path = output_dir / f"provas_analisadas_{ts}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(
            {"provas": provas, "gerado_em": ts, "total": len(provas)},
            f,
            ensure_ascii=False,
            indent=2,
        )
    logging.info(f"[Fase 7] JSON salvo: {json_path}")

    # ── CSV resumido ──────────────────────────────────────────────────────────
    csv_path = output_dir / f"resumo_analise_{ts}.csv"
    campos = [
        "nome", "banca", "ano", "tipo", "num_questoes",
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
            writer.writerow({
                "nome":                    prova.get("nome", ""),
                "banca":                   prova.get("banca", ""),
                "ano":                     prova.get("ano", ""),
                "tipo":                    prova.get("tipo", ""),
                "num_questoes":            len(prova.get("questoes", [])),
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
    max_workers: int = 10,
    pular_busca: bool = False,
    pular_gemini: bool = False,
    retomar_batch_id: Optional[str] = None,
) -> None:

    output_dir.mkdir(parents=True, exist_ok=True)
    configurar_logging(output_dir)
    intermediario = output_dir / "intermediario"

    logging.info("=" * 62)
    logging.info("  PIPELINE DE ANÁLISE DE PROVAS — MEDMIND")
    logging.info("=" * 62)

    # ── Verificar dependências e chaves ──────────────────────────────────────
    faltando = []
    if not TAVILY_OK and not pular_busca:
        faltando.append("tavily-python  (pip install tavily-python)")
    if not GEMINI_OK and not pular_gemini:
        faltando.append("google-generativeai  (pip install google-generativeai)")
    if not CLAUDE_OK:
        faltando.append("anthropic  (pip install anthropic)")
    if faltando:
        raise ImportError(
            "Dependências faltando. Instale com:\n  pip install "
            + " ".join(["anthropic", "tavily-python", "google-generativeai", "python-dotenv", "tqdm"])
            + "\n\nPacotes com problema:\n  " + "\n  ".join(faltando)
        )

    erros_env = []
    if not pular_busca and not os.environ.get("TAVILY_API_KEY"):
        erros_env.append("TAVILY_API_KEY não configurada")
    if not pular_gemini and not os.environ.get("GEMINI_API_KEY"):
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
    tavily_client = TavilyClient(api_key=os.environ["TAVILY_API_KEY"]) if not pular_busca else None

    gemini_model = None
    if not pular_gemini:
        genai.configure(api_key=os.environ["GEMINI_API_KEY"])
        gemini_model = genai.GenerativeModel("gemini-1.5-flash")

    claude_client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

    # ── FASE 1: Carregar provas ───────────────────────────────────────────────
    provas = carregar_provas(caminho_json)
    if limite:
        provas = provas[:limite]
        logging.info(f"  (modo teste: limitado a {limite} provas)")

    # ── FASE 2-3: Busca Tavily ────────────────────────────────────────────────
    cache_brutos = intermediario / "comentarios_brutos.json"

    if pular_busca:
        dados_cache = carregar_checkpoint(cache_brutos)
        if dados_cache:
            logging.info(f"[Fase 3] Pulando busca — usando cache: {cache_brutos}")
            provas_com_comentarios = dados_cache
        else:
            logging.warning("[Fase 3] --pular-busca ativo mas cache não encontrado. Executando busca...")
            provas_com_comentarios = fase_busca_tavily(provas, tavily_client, max_workers)
            salvar_checkpoint(provas_com_comentarios, cache_brutos)
    else:
        provas_com_comentarios = fase_busca_tavily(provas, tavily_client, max_workers)
        salvar_checkpoint(provas_com_comentarios, cache_brutos)  # Fase 4: checkpoint

    # ── FASE 5: Pré-processamento Gemini ─────────────────────────────────────
    cache_filtrados = intermediario / "comentarios_filtrados.json"

    if pular_gemini:
        dados_cache = carregar_checkpoint(cache_filtrados)
        if dados_cache:
            logging.info(f"[Fase 5] Pulando Gemini — usando cache: {cache_filtrados}")
            provas_filtradas = dados_cache
        else:
            logging.warning("[Fase 5] --pular-gemini ativo mas cache não encontrado. Concatenando brutos...")
            provas_filtradas = []
            for p in provas_com_comentarios:
                trechos = [(c.get("conteudo") or "")[:1500] for c in p.get("comentarios_brutos", []) if c.get("conteudo")]
                provas_filtradas.append({**p, "comentarios_filtrados": "\n\n".join(trechos)[:4000]})
    else:
        provas_filtradas = fase_gemini(provas_com_comentarios, gemini_model)
        salvar_checkpoint(provas_filtradas, cache_filtrados)

    # ── FASE 6: Batch Claude ──────────────────────────────────────────────────
    resultados_batch = {}

    if retomar_batch_id:
        logging.info(f"[Fase 6] Retomando batch Claude: {retomar_batch_id}")
        resultados_batch = aguardar_batch(retomar_batch_id, claude_client)
    else:
        batch_id, _ = fase_batch_claude(provas_filtradas, claude_client)
        if batch_id:
            # Salvar batch_id para eventual retomada com --retomar-batch
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
    # Carregar variáveis de ambiente (aceita .env.local ou .env)
    for env_file in [".env.local", ".env", "../.env.local", "../.env"]:
        if Path(env_file).exists():
            load_dotenv(env_file)
            break

    parser = argparse.ArgumentParser(
        description="Pipeline MedMind: Tavily → Gemini → Claude Batches",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemplos de uso:

  # Rodar em modo teste com 5 provas
  python pipeline_analise_provas.py provas.json --limite 5

  # Rodar pipeline completo
  python pipeline_analise_provas.py provas.json

  # Pular etapa Tavily (usar cache já gerado)
  python pipeline_analise_provas.py provas.json --pular-busca

  # Retomar batch Claude interrompido
  python pipeline_analise_provas.py provas.json --pular-busca --pular-gemini --retomar-batch msgbatch_xxx

  # Sem filtro Gemini (mais rápido, comentários brutos vão direto ao Claude)
  python pipeline_analise_provas.py provas.json --pular-gemini

Variáveis de ambiente necessárias:
  TAVILY_API_KEY      https://tavily.com
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
        default="dados/pipeline_output",
        help="Pasta de saída (padrão: dados/pipeline_output)",
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
        default=10,
        help="Threads paralelas para buscas Tavily (padrão: 10)",
    )
    parser.add_argument(
        "--pular-busca",
        action="store_true",
        help="Pular etapa Tavily e usar cache existente em intermediario/",
    )
    parser.add_argument(
        "--pular-gemini",
        action="store_true",
        help="Pular etapa Gemini (comentários brutos vão direto ao Claude)",
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
        pular_gemini=args.pular_gemini,
        retomar_batch_id=args.retomar_batch,
    )
