#!/usr/bin/env python3
"""
Crawler Contador de Questões — provaderesidencia.com.br
========================================================
Percorre a listagem de provas do site e conta quantas questões
cada prova possui. Ao final, exibe o total de provas e questões.

NÃO coleta nenhum conteúdo de questão (enunciado, alternativas,
gabarito, imagens, comentários). Apenas conta os links.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  IMPORTANTE — EXECUTE NA SUA MÁQUINA LOCAL (não no servidor)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  O cookie cf_clearance é vinculado ao IP do seu navegador.
  Se rodar de outro servidor (IP diferente), o Cloudflare bloqueia.

  Passo a passo:
    1. pip install requests beautifulsoup4 cloudscraper
    2. Copie os cookies do navegador (F12 → Application → Cookies)
    3. Cole no arquivo .env na mesma pasta:
         CRAWLER_COOKIE_HEADER=csrftoken=...; sessionid=...; cf_clearance=...
    4. python crawler_contador_questoes.py --perfil premium_paid --saida resultado.json
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Fluxo:
  1. Descobre todas as provas na página de listagem
  2. Para cada prova, acessa o índice e conta links de questões
     (segue paginação caso existam múltiplas páginas por prova)
  3. Imprime tabela com nome, quantidade por prova e totais finais
  4. Salva resultado em JSON (via --saida ou CRAWLER_SAIDA)

Uso:
  python crawler_contador_questoes.py --perfil premium_paid
  python crawler_contador_questoes.py --perfil demo
  python crawler_contador_questoes.py --max-provas 10 --delay 2.0
  python crawler_contador_questoes.py --saida resultado_contagem.json
  python crawler_contador_questoes.py --cookies "sessionid=abc; cf_clearance=xyz"

Variáveis de ambiente (em .env ou exportadas no terminal):
  CRAWLER_COOKIE_HEADER — String completa de cookies do navegador (obrigatório para premium)
  CRAWLER_URL_PROVAS    — URL da listagem (substitui o perfil)
  CRAWLER_MAX_PROVAS    — Limite de provas (0 = todas)
  CRAWLER_DELAY         — Delay em segundos entre requisições (padrão: 2.0)
  CRAWLER_SAIDA         — Caminho do arquivo JSON de saída

Dependências:
  pip install requests beautifulsoup4 cloudscraper python-dotenv
"""

import os
import re
import json
import time
import random
import logging
import argparse
from datetime import datetime
from typing import Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

# ── Carregar .env da pasta arthur/ (ou cwd) ───────────────────────────────────
try:
    from dotenv import load_dotenv
    _DIR = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(os.path.join(_DIR, ".env"))
    load_dotenv()  # fallback: .env no cwd
except ImportError:
    pass

# ── Imports opcionais anti-403 ────────────────────────────────────────────────

try:
    from curl_cffi import requests as _curl_requests
    _CURL_CFFI = True
except ImportError:
    _curl_requests = None
    _CURL_CFFI = False

try:
    import cloudscraper
    _CS_TEST = cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "mobile": False}
    )
    del _CS_TEST
    _CLOUDSCRAPER = True
except Exception:
    _CLOUDSCRAPER = False


# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURAÇÕES
# ══════════════════════════════════════════════════════════════════════════════

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

BASE_URL   = "https://www.provaderesidencia.com.br"
URL_PROVAS = "https://www.provaderesidencia.com.br/demo/provas"

# Perfis prontos para demo e premium
_PROFILES = {
    "demo": {
        "url_provas":    "https://www.provaderesidencia.com.br/demo/provas",
        "referer":       "https://www.provaderesidencia.com.br/demo/provas",
        "path_questao":  "/demo/questao/",
        "path_prova":    "/demo/prova/",
    },
    "premium_free": {
        "url_provas":    "https://www.provaderesidencia.com.br/premium/banco-de-provas",
        "referer":       "https://www.provaderesidencia.com.br/premium/banco-de-provas",
        "path_questao":  "/premium/questao/",
        "path_prova":    "/premium/prova/",
    },
    "premium_paid": {
        "url_provas":    "https://www.provaderesidencia.com.br/premium/banco-de-provas",
        "referer":       "https://www.provaderesidencia.com.br/premium/banco-de-provas",
        "path_questao":  "/premium/questao/",
        "path_prova":    "/premium/prova/",
    },
}

_PERFIS_NAVEGADOR = [
    {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/131.0.0.0 Safari/537.36"
        ),
        "sec-ch-ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "sec-ch-ua-platform": '"Windows"',
        "sec-ch-ua-mobile": "?0",
    },
    {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/130.0.0.0 Safari/537.36"
        ),
        "sec-ch-ua": '"Google Chrome";v="130", "Chromium";v="130", "Not_A Brand";v="24"',
        "sec-ch-ua-platform": '"Windows"',
        "sec-ch-ua-mobile": "?0",
    },
    {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"
        ),
        "sec-ch-ua": '"Microsoft Edge";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "sec-ch-ua-platform": '"Windows"',
        "sec-ch-ua-mobile": "?0",
    },
]


# ══════════════════════════════════════════════════════════════════════════════
# SESSÃO HTTP
# ══════════════════════════════════════════════════════════════════════════════

def criar_sessao(perfil_nav: dict, cookies: str = "") -> tuple:
    """
    Cria sessão HTTP priorizando curl_cffi → cloudscraper → requests puro.
    Os cookies são armazenados como string bruta e enviados como header Cookie
    em cada requisição — igual ao que o browser faz.
    Retorna (sessao, is_curl_cffi).
    """
    cookie_str = cookies.strip()

    if _CURL_CFFI:
        sessao = _curl_requests.Session()
        sessao._curl_cffi = True
        sessao._cookie_header = cookie_str
        sessao.headers.update({
            "accept":             "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-encoding":    "gzip, deflate, br",
            "accept-language":    "pt-BR,pt;q=0.9,en;q=0.8",
            "user-agent":         perfil_nav["User-Agent"],
            "sec-ch-ua":          perfil_nav["sec-ch-ua"],
            "sec-ch-ua-mobile":   perfil_nav["sec-ch-ua-mobile"],
            "sec-ch-ua-platform": perfil_nav["sec-ch-ua-platform"],
        })
        logger.info("[SESSÃO] Motor: curl_cffi (TLS fingerprint Firefox)")
        return sessao, True

    if _CLOUDSCRAPER:
        sessao = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "mobile": False},
            delay=5,
        )
        sessao._cookie_header = cookie_str
        sessao.headers.update({
            "User-Agent":      perfil_nav["User-Agent"],
            "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
        })
        logger.info("[SESSÃO] Motor: cloudscraper (anti-Cloudflare)")
        return sessao, False

    sessao = requests.Session()
    sessao._cookie_header = cookie_str
    sessao.headers.update({
        "User-Agent":      perfil_nav["User-Agent"],
        "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    })
    logger.warning("[SESSÃO] Motor: requests puro (risco de 403 — instale cloudscraper ou curl_cffi)")
    return sessao, False


# ══════════════════════════════════════════════════════════════════════════════
# REQUISIÇÕES COM RETRY
# ══════════════════════════════════════════════════════════════════════════════

def _get(sessao, url: str, referer: str = "", max_tentativas: int = 4, delay_base: float = 2.0) -> Optional[str]:
    """
    GET com retry exponencial e jitter.
    Retorna HTML como string ou None em caso de falha definitiva.
    """
    is_curl = getattr(sessao, "_curl_cffi", False)
    headers = {}
    # Envia o Cookie como header bruto (igual ao browser) — necessário para cf_clearance
    cookie_header = getattr(sessao, "_cookie_header", "")
    if cookie_header:
        headers["Cookie"] = cookie_header
    if referer:
        headers["Referer"] = referer
    headers["Sec-Fetch-Dest"] = "document"
    headers["Sec-Fetch-Mode"] = "navigate"
    headers["Sec-Fetch-Site"]  = "same-origin" if referer else "none"

    for tentativa in range(max_tentativas):
        try:
            kwargs = {"headers": headers, "timeout": 20}
            if is_curl:
                kwargs["impersonate"] = "firefox"

            resp = sessao.get(url, **kwargs)

            if resp.status_code == 200:
                return resp.text

            if resp.status_code in (403, 429):
                espera = delay_base * (2 ** tentativa) + random.uniform(1, 4)
                logger.warning(f"[HTTP {resp.status_code}] {url} — aguardando {espera:.1f}s (tentativa {tentativa+1}/{max_tentativas})")
                time.sleep(espera)
                continue

            if resp.status_code in (404, 410):
                logger.warning(f"[HTTP {resp.status_code}] URL não encontrada: {url}")
                return None

            logger.warning(f"[HTTP {resp.status_code}] {url} — tentativa {tentativa+1}/{max_tentativas}")
            time.sleep(delay_base * (tentativa + 1))

        except requests.exceptions.Timeout:
            logger.warning(f"[TIMEOUT] {url} — tentativa {tentativa+1}/{max_tentativas}")
            time.sleep(delay_base * (tentativa + 1))
        except Exception as exc:
            logger.warning(f"[ERRO] {url} — {exc} — tentativa {tentativa+1}/{max_tentativas}")
            time.sleep(delay_base * (tentativa + 1))

    logger.error(f"[FALHA] Não foi possível acessar após {max_tentativas} tentativas: {url}")
    return None


# ══════════════════════════════════════════════════════════════════════════════
# DESCOBERTA DE PROVAS
# ══════════════════════════════════════════════════════════════════════════════

def _extrair_links_provas(html: str, base_url: str, path_prova: str) -> list:
    """
    Extrai todos os links de provas encontrados na página de listagem.
    Retorna lista de dicts: [{"nome": str, "url": str}, ...]
    """
    soup = BeautifulSoup(html, "html.parser")
    vistos = set()
    provas = []

    for tag in soup.find_all("a", href=True):
        href = tag["href"].strip()
        url_completa = urljoin(base_url, href)

        # Filtra links que apontam para páginas de prova
        if path_prova not in url_completa:
            continue

        url_norm = url_completa.split("?")[0].rstrip("/")
        if url_norm in vistos:
            continue
        vistos.add(url_norm)

        # Tenta extrair o nome da prova a partir do texto do link ou atributo title
        nome = (tag.get("title") or tag.get_text(separator=" ")).strip()
        nome = re.sub(r"\s+", " ", nome)
        # Remove sufixos adicionados pelo site (ex: "Gratuito", "Iniciada")
        nome = re.sub(r"\s*(gratuito|iniciada|premium)\s*$", "", nome, flags=re.IGNORECASE).strip()
        nome = nome[:120] or url_norm.split("/")[-1]

        provas.append({"nome": nome, "url": url_completa})

    return provas


def _extrair_proxima_pagina_listagem(html: str, base_url: str, url_atual: str) -> Optional[str]:
    """
    Detecta link de paginação na página de listagem de provas.
    Retorna URL da próxima página ou None.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Padrão comum: link com rel="next" ou texto "Próximo"
    for tag in soup.find_all("a", href=True):
        rel = (tag.get("rel") or [])
        texto = tag.get_text().strip().lower()
        href = tag["href"].strip()

        if "next" in rel or any(p in texto for p in ["próximo", "próxima", "next", "»", "›"]):
            url_prox = urljoin(base_url, href)
            if url_prox != url_atual:
                return url_prox

    # Padrão alternativo: ?page=N ou /page/N
    pagina_atual_match = re.search(r"[?&]page=(\d+)", url_atual)
    if pagina_atual_match:
        pagina_num = int(pagina_atual_match.group(1)) + 1
        url_prox = re.sub(r"([?&]page=)\d+", f"\\g<1>{pagina_num}", url_atual)
        # Verificar se a página seguinte foi encontrada no HTML (link existe)
        for tag in soup.find_all("a", href=True):
            if f"page={pagina_num}" in tag["href"]:
                return urljoin(base_url, tag["href"])

    return None


def descobrir_provas(sessao, url_listagem: str, base_url: str, path_prova: str, max_provas: int = 0, delay: float = 2.0) -> list:
    """
    Percorre a listagem de provas (com suporte a paginação) e retorna lista
    de todas as provas encontradas: [{"nome": str, "url": str}, ...]
    """
    logger.info(f"[DESCOBERTA] Iniciando em: {url_listagem}")

    todas = []
    url_atual = url_listagem
    pagina = 1

    while url_atual:
        logger.info(f"[DESCOBERTA] Página de listagem {pagina}: {url_atual}")
        html = _get(sessao, url_atual, referer=base_url + "/", delay_base=delay)

        if not html:
            logger.error("[DESCOBERTA] Não foi possível carregar a listagem de provas.")
            break

        provas_pg = _extrair_links_provas(html, base_url, path_prova)
        logger.info(f"[DESCOBERTA] {len(provas_pg)} provas encontradas nesta página")
        todas.extend(provas_pg)

        if max_provas and len(todas) >= max_provas:
            todas = todas[:max_provas]
            logger.info(f"[DESCOBERTA] Limite de {max_provas} provas atingido. Parando descoberta.")
            break

        url_prox = _extrair_proxima_pagina_listagem(html, base_url, url_atual)
        if url_prox:
            pagina += 1
            url_atual = url_prox
            time.sleep(delay + random.uniform(0.5, 1.5))
        else:
            break

    logger.info(f"[DESCOBERTA] Total: {len(todas)} provas encontradas")
    return todas


# ══════════════════════════════════════════════════════════════════════════════
# CONTAGEM DE QUESTÕES POR PROVA
# ══════════════════════════════════════════════════════════════════════════════

def _contar_questoes_na_pagina(html: str, base_url: str, path_questao: str) -> set:
    """
    Conta questões únicas presentes em uma página de índice de prova.
    Retorna set de IDs/URLs normalizados das questões encontradas.
    """
    soup = BeautifulSoup(html, "html.parser")
    questoes = set()

    for tag in soup.find_all("a", href=True):
        href = tag["href"].strip()
        url_completa = urljoin(base_url, href)

        if path_questao not in url_completa:
            continue

        # Normaliza: remove fragmento e query
        url_norm = url_completa.split("?")[0].split("#")[0].rstrip("/")

        # Extrai ID numérico se possível (mais estável que URL completa)
        m = re.search(r"/questao/(\d+)/", url_norm)
        chave = m.group(1) if m else url_norm
        questoes.add(chave)

    return questoes


def _extrair_proxima_pagina_prova(html: str, base_url: str, url_atual: str) -> Optional[str]:
    """
    Detecta link da próxima página dentro de uma prova (paginação de questões).
    Retorna URL ou None.
    """
    soup = BeautifulSoup(html, "html.parser")

    for tag in soup.find_all("a", href=True):
        rel = tag.get("rel") or []
        texto = tag.get_text().strip().lower()
        href = tag["href"].strip()

        if "next" in rel or any(p in texto for p in ["próximo", "próxima", "next", "»", "›", "seguinte"]):
            url_prox = urljoin(base_url, href)
            if url_prox != url_atual and url_prox != url_atual.rstrip("/"):
                return url_prox

    return None


def contar_questoes_prova(sessao, prova: dict, base_url: str, path_questao: str, delay: float = 2.0) -> int:
    """
    Acessa o índice de uma prova (com paginação) e conta o total de questões únicas.
    Retorna apenas o número — nenhum conteúdo de questão é coletado.
    """
    url_atual = prova["url"]
    referer   = base_url + "/demo/provas"
    todas_questoes = set()
    pagina = 1

    while url_atual:
        html = _get(sessao, url_atual, referer=referer, delay_base=delay)

        if not html:
            logger.warning(f"  [ERRO] Não foi possível carregar: {url_atual}")
            break

        questoes_pg = _contar_questoes_na_pagina(html, base_url, path_questao)
        novas = questoes_pg - todas_questoes
        todas_questoes |= questoes_pg

        logger.debug(f"  Página {pagina}: {len(questoes_pg)} questões ({len(novas)} novas)")

        # Se não encontrou nenhuma questão na primeira página, para
        if pagina == 1 and not questoes_pg:
            logger.warning(f"  Nenhuma questão encontrada em: {url_atual}")
            break

        url_prox = _extrair_proxima_pagina_prova(html, base_url, url_atual)
        if url_prox:
            pagina += 1
            referer = url_atual
            url_atual = url_prox
            time.sleep(delay * 0.5 + random.uniform(0.3, 0.8))  # delay menor entre páginas da mesma prova
        else:
            break

    return len(todas_questoes)


# ══════════════════════════════════════════════════════════════════════════════
# RELATÓRIO
# ══════════════════════════════════════════════════════════════════════════════

def imprimir_relatorio(resultados: list, tempo_total: float) -> None:
    """Imprime tabela formatada com o resultado da contagem."""
    sep = "─" * 80
    total_questoes = sum(r["questoes"] for r in resultados)
    total_provas   = len(resultados)
    erros          = sum(1 for r in resultados if r["questoes"] == 0)

    print(f"\n{'═' * 80}")
    print(f"  RESULTADO — CONTAGEM DE QUESTÕES POR PROVA")
    print(f"{'═' * 80}")
    print(f"  {'#':<5} {'PROVA':<52} {'QUESTÕES':>8}")
    print(sep)

    for i, r in enumerate(resultados, 1):
        nome = r["nome"][:51]
        qtd  = r["questoes"]
        flag = " ⚠" if qtd == 0 else ""
        print(f"  {i:<5} {nome:<52} {qtd:>8}{flag}")

    print(sep)
    print(f"  {'TOTAL':<57} {total_questoes:>8}")
    print(f"{'═' * 80}")
    print(f"\n  Total de provas   : {total_provas}")
    print(f"  Total de questões : {total_questoes}")
    if erros:
        print(f"  Provas sem questões (possível erro de acesso): {erros}")
    print(f"  Tempo total       : {tempo_total:.1f}s")
    print(f"{'═' * 80}\n")


def salvar_json(resultados: list, caminho: str, tempo_total: float) -> None:
    """Salva o resultado em JSON estruturado."""
    os.makedirs(os.path.dirname(caminho) if os.path.dirname(caminho) else ".", exist_ok=True)
    total_questoes = sum(r["questoes"] for r in resultados)

    payload = {
        "gerado_em":      datetime.now().isoformat(),
        "fonte":          "https://www.provaderesidencia.com.br",
        "total_provas":   len(resultados),
        "total_questoes": total_questoes,
        "tempo_segundos": round(tempo_total, 1),
        "provas": [
            {
                "nome":     r["nome"],
                "url":      r["url"],
                "questoes": r["questoes"],
            }
            for r in resultados
        ],
    }

    tmp = caminho + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp, caminho)
    logger.info(f"[SAÍDA] JSON salvo em: {caminho}")

    # CSV paralelo (só nome + quantidade) para conferência rápida
    caminho_csv = os.path.splitext(caminho)[0] + ".csv"
    with open(caminho_csv, "w", encoding="utf-8") as f:
        f.write("nome,questoes,url\n")
        for r in resultados:
            nome = '"' + r["nome"].replace('"', '""') + '"'
            f.write(f"{nome},{r['questoes']},{r['url']}\n")
    logger.info(f"[SAÍDA] CSV salvo em: {caminho_csv}")


# ══════════════════════════════════════════════════════════════════════════════
# ORQUESTRADOR PRINCIPAL
# ══════════════════════════════════════════════════════════════════════════════

def main(
    url_provas:  str,
    perfil_nome: str  = "demo",
    cookies:     str  = "",
    max_provas:  int  = 0,
    delay:       float = 2.0,
    caminho_saida: Optional[str] = None,
    verbose:     bool = False,
) -> None:
    if verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    inicio = time.time()

    # Selecionar perfil
    perfil_cfg = _PROFILES.get(perfil_nome, _PROFILES["demo"])
    if not url_provas:
        url_provas = perfil_cfg["url_provas"]

    path_questao = perfil_cfg["path_questao"]
    path_prova   = perfil_cfg["path_prova"]

    perfil_nav = random.choice(_PERFIS_NAVEGADOR)

    logger.info("═" * 60)
    logger.info("  CRAWLER CONTADOR DE QUESTÕES — provaderesidencia.com.br")
    logger.info("═" * 60)
    logger.info(f"  Perfil      : {perfil_nome}")
    logger.info(f"  URL listagem: {url_provas}")
    logger.info(f"  Max provas  : {max_provas or 'todas'}")
    logger.info(f"  Delay       : {delay}s")
    logger.info("─" * 60)

    # Criar sessão
    sessao, _ = criar_sessao(perfil_nav, cookies)

    # Warm-up: visitar home SÓ quando não há cookies de sessão.
    # Com cf_clearance fornecido pelo usuário, o warm-up aciona um novo desafio
    # Cloudflare que invalida o token — por isso pulamos quando cookies existem.
    if not cookies.strip():
        logger.info("[WARM-UP] Visitando home do site (sem cookies, aquecendo sessão)...")
        _get(sessao, BASE_URL, referer=BASE_URL + "/", delay_base=delay)
        time.sleep(delay + random.uniform(0.5, 1.0))
    else:
        logger.info("[WARM-UP] Pulando warm-up — cookies de sessão fornecidos (cf_clearance preservado).")

    # Fase 1: Descobrir todas as provas
    provas = descobrir_provas(
        sessao,
        url_provas,
        BASE_URL,
        path_prova,
        max_provas=max_provas,
        delay=delay,
    )

    if not provas:
        logger.error("Nenhuma prova encontrada. Verifique a URL e os cookies de sessão.")
        return

    # Fase 2: Contar questões de cada prova
    logger.info(f"\n[CONTAGEM] Contando questões de {len(provas)} provas...")
    logger.info("─" * 60)

    resultados = []
    for i, prova in enumerate(provas, 1):
        logger.info(f"[{i:>4}/{len(provas)}] {prova['nome'][:60]}")
        qtd = contar_questoes_prova(sessao, prova, BASE_URL, path_questao, delay=delay)
        logger.info(f"          → {qtd} questão(ões)")
        resultados.append({**prova, "questoes": qtd})

        # Delay humano entre provas (variação gaussiana)
        if i < len(provas):
            pausa = max(0.5, random.gauss(delay, delay * 0.3))
            time.sleep(pausa)

    tempo_total = time.time() - inicio

    # Relatório final
    imprimir_relatorio(resultados, tempo_total)

    # Salvar JSON (padrão: arthur/exports/contagem_questoes_<timestamp>.json)
    if not caminho_saida:
        exports = os.path.join(os.path.dirname(os.path.abspath(__file__)), "exports")
        os.makedirs(exports, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        caminho_saida = os.path.join(exports, f"contagem_questoes_{ts}.json")
    salvar_json(resultados, caminho_saida, tempo_total)


# ══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Conta quantas questões cada prova do site possui, sem coletar conteúdo.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemplos:
  python crawler_contador_questoes.py
  python crawler_contador_questoes.py --max-provas 10
  python crawler_contador_questoes.py --delay 3.0 --saida resultado_contagem.json
  python crawler_contador_questoes.py --perfil premium_paid --cookies "sessionid=abc; cf_clearance=xyz"
        """,
    )
    parser.add_argument(
        "--url",
        default=os.environ.get("CRAWLER_URL_PROVAS", ""),
        help="URL da página de listagem de provas",
    )
    parser.add_argument(
        "--perfil",
        default="demo",
        choices=list(_PROFILES.keys()),
        help="Perfil de acesso: demo, premium_free ou premium_paid (padrão: demo)",
    )
    parser.add_argument(
        "--cookies",
        default=os.environ.get("CRAWLER_COOKIE_HEADER", ""),
        help="String de cookies para sessão autenticada (ex: 'sessionid=abc; csrftoken=xyz')",
    )
    parser.add_argument(
        "--max-provas",
        type=int,
        default=int(os.environ.get("CRAWLER_MAX_PROVAS", "0")),
        help="Limitar número de provas processadas (0 = todas)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=float(os.environ.get("CRAWLER_DELAY", "2.0")),
        help="Delay base em segundos entre requisições (padrão: 2.0)",
    )
    parser.add_argument(
        "--saida",
        default=os.environ.get("CRAWLER_SAIDA", ""),
        help="Caminho do arquivo JSON de saída (opcional)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Ativar logs detalhados (DEBUG)",
    )

    args = parser.parse_args()

    main(
        url_provas    = args.url,
        perfil_nome   = args.perfil,
        cookies       = args.cookies,
        max_provas    = args.max_provas,
        delay         = args.delay,
        caminho_saida = args.saida or None,
        verbose       = args.verbose,
    )
