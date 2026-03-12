"""
Web Crawler específico para provaderesidencia.com.br — VERSÃO 16 (UNIFICADO)
=============================================================================
Arquivo único com as melhores funções e boas práticas dos crawlers 14 e 15.
Corrige o erro em que apenas 5 questões eram coletadas por prova: o limite
de questões por prova NUNCA é o tamanho inicial da fila (ex.: 5), e sim
max_paginas; a fila é alimentada com links descobertos em cada página de
questão, e o crawl segue até esgotar a fila ou atingir max_paginas.

Opção principal: descoberta de TODAS as questões de cada prova.

Fluxo em 3 etapas:
  1° DESCOBERTA DE TODAS AS PROVAS
     Acessa a URL de listagem (CRAWLER_URL_PROVAS), extrai todos os links de
     provas e monta um array. A quantidade de provas nesse array é a quantidade
     de vezes que o crawler irá rodar (uma execução completa por prova).

  2° DESCOBERTA E COLETA DE TODAS AS QUESTÕES DE UMA PROVA
     Para a primeira prova do array: descobre todas as questões (índice +
     paginação), insere as URLs em um array e coleta cada questão. Só passa
     para a URL da prova seguinte depois de todas as questões dessa prova
     terem sido coletadas.

  3° PRÓXIMA PROVA ATÉ ESGOTAR O ARRAY
     O crawler avança para o próximo link do array de provas e repete a etapa 2,
     até que todas as provas tenham sido coletadas.

Melhorias herdadas do web_crawler_13:
  ✔ cloudscraper opcional para contornar 403/Cloudflare
  ✔ Accept-Encoding sem 'br'/'zstd' para evitar resposta binária
  ✔ Limpeza de caracteres não-imprimíveis no HTML
  ✔ Força decodificação via apparent_encoding com fallback para UTF-8
  ✔ 4 perfis de navegador atualizados (Chrome 129/130/131 + Edge 131)
  ✔ Rotação de perfil a cada requisição
  ✔ Warm-up de sessão (visita home antes de iniciar)
  ✔ Delay gaussiano humanizado
  ✔ POST simulado com CSRF (resposta aleatória para revelar gabarito)
  ✔ GET pós-POST para capturar HTML com gabarito revelado
  ✔ Re-extração da questão no HTML pós-resposta
  ✔ Salvamento incremental (questão a questão)
  ✔ Saída no formato {provas: [{nome, questoes: [{numero, titulo, ...}]}]}

Melhorias adicionadas nesta versão:
  ✔ Fase de descoberta automática: lê a listagem de provas e monta o array
    de url_inicial antes de iniciar qualquer crawl de questões
  ✔ Crawl sequencial prova a prova: termina uma prova antes de ir à próxima
  ✔ Retorno à listagem entre provas (simula navegação humana real)
  ✔ Consolidação final de todas as provas num único arquivo JSON

Autenticação (necessária para ver o gabarito):
  Opção 1 — Login automático: defina CRAWLER_LOGIN_EMAIL e CRAWLER_LOGIN_PASSWORD.
  Opção 2 — Cookies de sessão: faça login no navegador, copie os cookies em
    "Application" → "Cookies" e passe em CRAWLER_COOKIE_HEADER="nome1=valor1; ..."

Variáveis de ambiente:
  CRAWLER_URL_PROVAS      - URL da listagem de provas para descoberta
                            (padrão: https://provaderesidencia.com.br/demo/provas)
  CRAWLER_MAX_PROVAS      - Máximo de provas (0 = todas). Opção de limitar a 5 está comentada.
  CRAWLER_MAX_PAGINAS     - Máximo de questões por prova (padrão: 200)
  CRAWLER_DELAY           - Delay base em segundos entre questões (padrão: 5.0)
  CRAWLER_APENAS_QUESTOES - "true"/"false" — filtra só URLs /demo/questao/ (padrão: true)
  CRAWLER_SAIDA           - Caminho do JSON de saída
                            (padrão: /resultado/resultado_crawl.json)
  CRAWLER_COOKIE_HEADER   - Cookies de sessão autenticada (opcional se usar login)
  CRAWLER_LOGIN_EMAIL     - Email para login automático (ex: moliveira@08242@gmail.com)
  CRAWLER_LOGIN_PASSWORD  - Senha para login automático
  CRAWLER_LOGIN_URL       - URL da página de login (opcional; padrão: https://provaderesidencia.com.br/premium/login)
  CRAWLER_REFERER         - Referer inicial personalizado (opcional)

Se o site retornar 403 Forbidden, instale cloudscraper para contornar proteções
tipo Cloudflare:  pip install cloudscraper
"""

import os
import re
import json
import time
import random
import logging
from datetime import datetime
from collections import OrderedDict
from urllib.parse import urljoin, urlparse
from typing import Optional

import requests
from bs4 import BeautifulSoup, NavigableString

try:
    import cloudscraper
    _CLOUDSCRAPER_AVAILABLE = True
except ImportError:
    _CLOUDSCRAPER_AVAILABLE = False


# ─────────────────────────────────────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# CONFIGURAÇÃO VIA VARIÁVEIS DE AMBIENTE
# ─────────────────────────────────────────────────────────────────────────────

# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
#           IDEAÇÃO
# url_provas_limitado = {URLs} #array com a quantidade de URLs (até 8), mas faz sentido ser queue;
# 
# urls = 0
# while (urls < 8):
# faz um GET das URLs das provas até chegar em 8 URLs;
# quant = 0
# for quant in len(url_prova_limitado):
#    quant = quant + 1
#    GET all questões from url
# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

_URL_PROVAS_PADRAO = "https://provaderesidencia.com.br/demo/provas"

def _cfg_str(chave: str, padrao: str) -> str:
    return os.environ.get(chave, padrao).strip()

def _cfg_int(chave: str, padrao: int) -> int:
    try:
        return int(os.environ.get(chave, str(padrao)))
    except ValueError:
        return padrao

def _cfg_float(chave: str, padrao: float) -> float:
    try:
        return float(os.environ.get(chave, str(padrao)))
    except ValueError:
        return padrao

def _cfg_bool(chave: str, padrao: bool) -> bool:
    val = os.environ.get(chave, "").strip().lower()
    if val in ("true", "1", "sim", "yes"):
        return True
    if val in ("false", "0", "nao", "não", "no"):
        return False
    return padrao


# ─────────────────────────────────────────────────────────────────────────────
# PERFIS DE NAVEGADOR
# ─────────────────────────────────────────────────────────────────────────────

_PERFIS_CHROME = [
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
            "Chrome/129.0.0.0 Safari/537.36"
        ),
        "sec-ch-ua": '"Google Chrome";v="129", "Chromium";v="129", "Not_A Brand";v="8"',
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

_ACCEPT_LANGUAGES = [
    "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "pt-BR,pt;q=0.9,en;q=0.8",
    "pt-BR,pt;q=0.8,en-US;q=0.5,en;q=0.3",
    "pt-BR,pt;q=0.9",
]


# ─────────────────────────────────────────────────────────────────────────────
# MONTAGEM DE HEADERS
# ─────────────────────────────────────────────────────────────────────────────

def _headers_get_navegacao(
    perfil: dict,
    referer: Optional[str],
    primeira_visita: bool,
) -> OrderedDict:
    sec_fetch_site = "none" if primeira_visita else "same-origin"
    cache_control  = random.choice(["max-age=0", "no-cache"])

    headers = OrderedDict([
        ("User-Agent",                perfil["User-Agent"]),
        ("Accept",                    (
            "text/html,application/xhtml+xml,application/xml;"
            "q=0.9,image/avif,image/webp,image/apng,*/*;"
            "q=0.8,application/signed-exchange;v=b3;q=0.7"
        )),
        ("Accept-Encoding",           "gzip, deflate"),
        ("Accept-Language",           random.choice(_ACCEPT_LANGUAGES)),
        ("Cache-Control",             cache_control),
        ("Connection",                "keep-alive"),
        *([("Referer", referer)] if referer else []),
        ("sec-ch-ua",                 perfil["sec-ch-ua"]),
        ("sec-ch-ua-mobile",          perfil["sec-ch-ua-mobile"]),
        ("sec-ch-ua-platform",        perfil["sec-ch-ua-platform"]),
        ("Sec-Fetch-Dest",            "document"),
        ("Sec-Fetch-Mode",            "navigate"),
        ("Sec-Fetch-Site",            sec_fetch_site),
        ("Sec-Fetch-User",            "?1"),
        ("Upgrade-Insecure-Requests", "1"),
        ("Priority",                  "u=0, i"),
    ])
    return headers


def _headers_post_formulario(
    perfil: dict,
    url_pagina: str,
    origin: str,
) -> OrderedDict:
    headers = OrderedDict([
        ("User-Agent",                perfil["User-Agent"]),
        ("Accept",                    (
            "text/html,application/xhtml+xml,application/xml;"
            "q=0.9,image/avif,image/webp,image/apng,*/*;"
            "q=0.8,application/signed-exchange;v=b3;q=0.7"
        )),
        ("Accept-Encoding",           "gzip, deflate"),
        ("Accept-Language",           random.choice(_ACCEPT_LANGUAGES)),
        ("Cache-Control",             "max-age=0"),
        ("Connection",                "keep-alive"),
        ("Content-Type",              "application/x-www-form-urlencoded"),
        ("Origin",                    origin),
        ("Referer",                   url_pagina),
        ("sec-ch-ua",                 perfil["sec-ch-ua"]),
        ("sec-ch-ua-mobile",          perfil["sec-ch-ua-mobile"]),
        ("sec-ch-ua-platform",        perfil["sec-ch-ua-platform"]),
        ("Sec-Fetch-Dest",            "document"),
        ("Sec-Fetch-Mode",            "navigate"),
        ("Sec-Fetch-Site",            "same-origin"),
        ("Sec-Fetch-User",            "?1"),
        ("Upgrade-Insecure-Requests", "1"),
    ])
    return headers


# ─────────────────────────────────────────────────────────────────────────────
# LIMPEZA DE HTML
# ─────────────────────────────────────────────────────────────────────────────

def _limpar_html(texto: str) -> str:
    """Remove caracteres não-imprimíveis preservando quebras de linha e tabs."""
    return "".join(ch for ch in texto if ch.isprintable() or ch in "\n\r\t")


# ─────────────────────────────────────────────────────────────────────────────
# SESSÃO HTTP
# ─────────────────────────────────────────────────────────────────────────────

def criar_sessao(perfil: dict, cookie_header: str = ""):
    """Cria sessão HTTP. Usa cloudscraper se instalado para contornar 403/Cloudflare."""
    if _CLOUDSCRAPER_AVAILABLE:
        sessao = cloudscraper.create_scraper()
        logger.info("Usando cloudscraper (anti-403/Cloudflare).")
    else:
        sessao = requests.Session()

    sessao.headers.update({
        "User-Agent": perfil["User-Agent"],
        "Connection":  "keep-alive",
    })

    if cookie_header:
        logger.info("Injetando cookies externos na sessão...")
        for par in cookie_header.split(";"):
            par = par.strip()
            if "=" in par:
                nome, _, valor = par.partition("=")
                sessao.cookies.set(nome.strip(), valor.strip())
        logger.info(f"  Cookies injetados: {list(sessao.cookies.keys())}")

    return sessao


def aquecer_sessao(
    sessao,
    perfil: dict,
    url_base: str,
    referer_inicial: Optional[str] = None,
) -> None:
    """Visita a home para obter cookies de sessão legítimos antes do crawl."""
    try:
        logger.info(f"Aquecendo sessão em: {url_base}")
        referer_warmup = referer_inicial if referer_inicial else (url_base.rstrip("/") + "/")
        resp = sessao.get(
            url_base,
            headers=_headers_get_navegacao(
                perfil,
                referer=referer_warmup,
                primeira_visita=(referer_inicial is None),
            ),
            timeout=15,
        )
        logger.info(
            f"  Sessão aquecida | status={resp.status_code} | "
            f"cookies={list(sessao.cookies.keys())}"
        )
        time.sleep(random.uniform(2.0, 4.0))
    except requests.RequestException as e:
        logger.warning(f"Falha no aquecimento de sessão: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# DELAY HUMANIZADO
# ─────────────────────────────────────────────────────────────────────────────

def delay_humanizado(base: float) -> None:
    # tempo = max(3.0, random.gauss(base, base * 0.15))
    tempo = 5.0
    logger.info(f"Aguardando {tempo:.1f}s...")
    time.sleep(tempo)


# ─────────────────────────────────────────────────────────────────────────────
# LOGIN AUTOMÁTICO
# ─────────────────────────────────────────────────────────────────────────────

def fazer_login(
    sessao,
    perfil: dict,
    url_base: str,
    email: str,
    senha: str,
    url_login: Optional[str] = None,
) -> bool:
    """
    Faz login no site via formulário (Django).
    GET na página de login para obter CSRF e cookies, depois POST com email e senha.
    Retorna True se o login parecer bem-sucedido (redirect ou presença de sessão).
    """
    if not email or not senha:
        logger.warning("Login ignorado: email ou senha não fornecidos.")
        return False

    # URL do login no site (após login o fluxo segue com a URL de listagem de provas)
    _URL_LOGIN_PADRAO = "https://provaderesidencia.com.br/premium/login"
    login_url = (url_login or _URL_LOGIN_PADRAO).strip() or _URL_LOGIN_PADRAO
    if not login_url.startswith("http"):
        login_url = urljoin(url_base, login_url)

    logger.info(f"Fazendo login em: {login_url}")

    try:
        r_get = sessao.get(
            login_url,
            headers=_headers_get_navegacao(perfil, referer=url_base, primeira_visita=True),
            timeout=15,
            allow_redirects=True,
        )
        r_get.encoding = r_get.apparent_encoding or "utf-8"
        html = _limpar_html(r_get.text)
    except requests.RequestException as e:
        logger.error(f"Erro ao acessar página de login: {e}")
        return False

    soup = BeautifulSoup(html, "html.parser")
    form = soup.find("form", method=re.compile(r"post", re.I))
    if not form:
        form = soup.find("form")
    if not form:
        logger.warning("Formulário de login não encontrado na página.")
        return False

    action = form.get("action") or ""
    if action and not action.startswith("http"):
        action = urljoin(login_url, action)
    post_url = action or login_url

    csrf = ""
    csrf_inp = form.find("input", attrs={"name": "csrfmiddlewaretoken"})
    if csrf_inp and csrf_inp.get("value"):
        csrf = csrf_inp["value"]
    else:
        for inp in form.find_all("input", type="hidden"):
            if "csrf" in (inp.get("name") or "").lower():
                csrf = inp.get("value", "")
                break

    # Nomes comuns: username, email, login
    email_name = None
    for name in ("email", "username", "login", "usuario"):
        if form.find("input", attrs={"name": name}):
            email_name = name
            break
    if not email_name:
        email_name = "username"

    payload = {
        "csrfmiddlewaretoken": csrf,
        email_name: email,
        "password": senha,
    }

    try:
        parsed_post = urlparse(post_url)
        origin_post = f"{parsed_post.scheme}://{parsed_post.netloc}"
        r_post = sessao.post(
            post_url,
            data=payload,
            headers=_headers_post_formulario(perfil, post_url, origin_post),
            timeout=15,
            allow_redirects=True,
        )
        logger.info(f"  POST login → status={r_post.status_code}")
    except requests.RequestException as e:
        logger.error(f"Erro ao enviar login: {e}")
        return False

    time.sleep(random.uniform(1.5, 3.0))

    # Sucesso: redirect para outra página ou cookies de sessão
    if r_post.status_code in (200, 302, 303):
        cookies = list(sessao.cookies.keys())
        if cookies:
            logger.info(f"  Login concluído | cookies: {cookies}")
        return True

    logger.warning("Login pode ter falhado (verifique credenciais).")
    return True


# ─────────────────────────────────────────────────────────────────────────────
# FASE 1 — DESCOBERTA DE PROVAS NA LISTAGEM
# ─────────────────────────────────────────────────────────────────────────────

def descobrir_provas(
    url_listagem: str,
    sessao,
    perfil: dict,
    url_base: str,
) -> list[dict]:
    """
    Acessa a página de listagem de provas e extrai todos os links de provas,
    retornando uma lista de dicts com 'nome' e 'url'.

    Estratégia 1: links com href padrão /demo/prova/<id>/<slug>
    Estratégia 2: cards HTML com classe card/prova/exam contendo âncora
    """
    logger.info(f"\n{'='*65}")
    logger.info(f"FASE 1 — Descoberta de provas em: {url_listagem}")

    try:
        resp = sessao.get(
            url_listagem,
            headers=_headers_get_navegacao(perfil, referer=url_base, primeira_visita=False),
            timeout=20,
            allow_redirects=True,
        )
        resp.encoding = resp.apparent_encoding or "utf-8"
        html = _limpar_html(resp.text)
    except requests.RequestException as e:
        logger.error(f"Erro ao acessar listagem de provas: {e}")
        return []

    if "text/html" not in resp.headers.get("Content-Type", ""):
        logger.error("Resposta da listagem não é HTML.")
        return []

    soup   = BeautifulSoup(html, "html.parser")
    provas = []
    vistas: set[str] = set()

    # Estratégia 1: qualquer âncora apontando para /demo/prova/<id>/<slug>
    for a in soup.find_all("a", href=True):
        url_completa = urljoin(url_base, a["href"])
        # Normaliza: remove fragmento
        url_completa = urlparse(url_completa)._replace(fragment="").geturl()

        if re.search(r"/demo/prova/\d+/", url_completa) and url_completa not in vistas:
            nome = a.get_text(strip=True) or url_completa
            provas.append({"nome": nome, "url": url_completa})
            vistas.add(url_completa)
            logger.debug(f"  [descoberta] {nome} → {url_completa}")

    # Estratégia 2: cards com classe card/prova/exam
    if not provas:
        for card in soup.find_all(["div", "article"], class_=re.compile(r"card|prova|exam", re.I)):
            link = card.find("a", href=True)
            if not link:
                continue
            url_completa = urlparse(urljoin(url_base, link["href"]))._replace(fragment="").geturl()
            if url_completa in vistas:
                continue
            titulo_tag = card.find(["h2", "h3", "h4", "strong"])
            nome = titulo_tag.get_text(strip=True) if titulo_tag else link.get_text(strip=True)
            provas.append({"nome": nome, "url": url_completa})
            vistas.add(url_completa)

    logger.info(f"  → {len(provas)} prova(s) encontrada(s) na listagem")
    if not provas:
        logger.warning(
            "Nenhuma prova encontrada. O site pode exigir login ou a estrutura "
            "de URL é diferente de /demo/prova/<id>/<slug>."
        )

    return provas


def ordenar_provas_mais_recentes_primeiro(provas: list[dict], ano_referencia: int = 2026) -> list[dict]:
    """
    Ordena a lista de provas para que a fila seja iniciada pelas mais recentes:
    aquelas cujo ano de acontecimento está mais próximo de ano_referencia (ex.: 2026)
    vêm primeiro. Extrai o ano do campo 'nome' (ex.: "ABC-SP-2021-R1" → 2021).
    Provas sem ano reconhecível vão para o final da fila.

    Args:
        provas: lista de dicts com 'nome' e 'url'
        ano_referencia: ano de referência para "mais recente" (default 2026)

    Returns:
        Nova lista (ordenada), mais recentes primeiro.
    """
    _RE_ANO = re.compile(r"\b(19[5-9]\d|20[0-3]\d)\b")

    def ano_extraido(prova: dict) -> tuple[int, str]:
        nome = prova.get("nome") or ""
        match = _RE_ANO.search(nome)
        if match:
            ano = int(match.group(1))
            # Ordenar por proximidade a ano_referencia (mais perto = primeiro)
            # Queremos 2025 antes de 2024 antes de 2021 → key menor = mais recente
            distancia = abs(ano_referencia - ano)
            return (distancia, nome)
        return (9999, nome)  # sem ano: vai para o final

    return sorted(provas, key=ano_extraido)


# ─────────────────────────────────────────────────────────────────────────────
# EXTRAÇÃO DA QUESTÃO
# ─────────────────────────────────────────────────────────────────────────────

def _letra_da_alternativa(texto: str) -> str:
    m = re.match(r"^\s*([A-Ea-e])\s*[\)\.]\s*", texto)
    return m.group(1).upper() if m else ""


def extrair_questao(soup: BeautifulSoup, url: str) -> Optional[dict]:
    col = soup.find("div", class_=lambda c: c and "col-md-6" in c and "space10-bottom" in c)
    if not col:
        logger.warning(f"Estrutura de questão não encontrada em: {url}")
        return None

    h2    = col.find("h2") or soup.find("h2")
    prova = h2.get_text(strip=True) if h2 else ""

    aviso_tag = col.find("p", class_=lambda c: c and "alert-warning" in c)
    aviso     = aviso_tag.get_text(strip=True) if aviso_tag else None

    h3     = col.find("h3")
    numero = h3.get_text(strip=True) if h3 else ""

    enunciado_parts = []
    if h3:
        node = h3.next_sibling
        while node:
            if hasattr(node, "name") and node.name in ("form", "img"):
                break
            if isinstance(node, NavigableString):
                s = str(node).strip()
                if s:
                    enunciado_parts.append(s)
            elif hasattr(node, "get_text") and node.name not in ("form",):
                s = node.get_text(strip=True)
                if s:
                    enunciado_parts.append(s)
            node = node.next_sibling
    enunciado = " ".join(enunciado_parts).strip()

    img_tag          = col.find("img", class_=lambda c: c and "img-responsive" in c)
    imagem_enunciado = urljoin(url, img_tag["src"]) if img_tag and img_tag.get("src") else None

    form = col.find("form", method="post")
    csrf = ""
    if form:
        csrf_inp = form.find("input", attrs={"name": "csrfmiddlewaretoken"})
        csrf     = csrf_inp.get("value", "") if csrf_inp else ""

    alternativas   = []
    gabarito_valor = gabarito_letra = None

    for div in (col.find_all("div", class_="radio") if form else []):
        classes_div = set(div.get("class", []))
        inp = div.find("input", type="radio")
        lbl = div.find("label")
        if not inp or not lbl:
            continue

        valor     = inp.get("value", "")
        texto     = lbl.get_text(strip=True)
        letra     = _letra_da_alternativa(texto)
        e_correta = "alert-success" in classes_div

        if e_correta:
            gabarito_valor = valor
            gabarito_letra = letra

        alternativas.append({
            "letra":   letra,
            "valor":   valor,
            "texto":   texto,
            "correta": e_correta,
        })

    inputs_radio   = col.find_all("input", type="radio")
    todos_disabled = bool(inputs_radio) and all(i.has_attr("disabled") for i in inputs_radio)

    if aviso and "ANULADA" in aviso.upper():
        estado = "anulada"
    elif todos_disabled and gabarito_valor:
        estado = "respondida"
    elif todos_disabled:
        estado = "respondida_sem_gabarito"
    else:
        estado = "nao_respondida"

    return {
        "url":                 url,
        "prova":               prova,
        "numero":              numero,
        "enunciado":           enunciado,
        "imagem_enunciado":    imagem_enunciado,
        "aviso":               aviso,
        "estado":              estado,
        "alternativas":        alternativas,
        "alternativa_correta": {
            "letra": gabarito_letra,
            "valor": gabarito_valor,
        } if gabarito_valor else None,
        "_csrf": csrf,
    }


# ─────────────────────────────────────────────────────────────────────────────
# SIMULAÇÃO DE RESPOSTA ALEATÓRIA (POST + GET pós-resposta)
# ─────────────────────────────────────────────────────────────────────────────

def responder_e_capturar_gabarito(
    questao: dict,
    sessao,
    perfil: dict,
) -> Optional[str]:
    """
    Envia o POST com uma resposta aleatória e faz um GET logo após para
    capturar o HTML com o gabarito revelado pelo site.
    Retorna o HTML pós-resposta, ou None em caso de falha.
    """
    if questao["estado"] != "nao_respondida" or not questao.get("alternativas"):
        return None

    escolhida = random.choice(questao["alternativas"])
    url       = questao["url"]
    parsed    = urlparse(url)
    origin    = f"{parsed.scheme}://{parsed.netloc}"

    payload = {
        "csrfmiddlewaretoken": questao.get("_csrf", ""),
        "choice":              escolhida["valor"],
    }

    try:
        r_post = sessao.post(
            url,
            data=payload,
            headers=_headers_post_formulario(perfil, url, origin),
            timeout=15,
            allow_redirects=True,
        )
        logger.info(
            f"  POST enviado → escolha={escolhida['letra']} | "
            f"status={r_post.status_code}"
        )
    except requests.RequestException as e:
        logger.warning(f"Erro ao enviar POST: {e}")
        return None

    time.sleep(random.uniform(1.5, 3.0))

    try:
        r_get = sessao.get(
            url,
            headers=_headers_get_navegacao(perfil, referer=url, primeira_visita=False),
            timeout=15,
        )
        r_get.encoding = r_get.apparent_encoding or "utf-8"
        html_pos_resposta = _limpar_html(r_get.text)
        logger.info(f"  GET pós-resposta → status={r_get.status_code}")
        return html_pos_resposta
    except requests.RequestException as e:
        logger.warning(f"Erro no GET pós-resposta: {e}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
# EXTRAÇÃO DE LINKS, HEADERS, IMAGENS E TEXTOS
# ─────────────────────────────────────────────────────────────────────────────

def extrair_links_questoes(soup: BeautifulSoup, url_base: str, dominio: str) -> dict:
    links_questao, links_outros = [], []
    vistos: set[str] = set()

    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith("#") or href.startswith("javascript:"):
            continue
        url_limpa = urlparse(urljoin(url_base, href))._replace(fragment="").geturl()
        if url_limpa in vistos:
            continue
        vistos.add(url_limpa)
        entrada = {"url": url_limpa, "texto": a.get_text(strip=True)}
        if re.search(r"/demo/questao/\d+/", url_limpa):
            links_questao.append(entrada)
        elif urlparse(url_limpa).netloc == dominio:
            links_outros.append(entrada)

    return {
        "questoes": links_questao,
        "outros":   links_outros,
        "total":    len(links_questao) + len(links_outros),
    }


def extrair_headers(soup: BeautifulSoup) -> list:
    return [
        {"nivel": t.name, "texto": t.get_text(strip=True)}
        for t in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"])
        if t.get_text(strip=True)
    ]


def extrair_imagens(soup: BeautifulSoup, url_base: str) -> list:
    return [
        {
            "src":    urljoin(url_base, img.get("src", "")),
            "alt":    img.get("alt", ""),
            "title":  img.get("title", ""),
            "largura": img.get("width", ""),
            "altura": img.get("height", ""),
        }
        for img in soup.find_all("img") if img.get("src")
    ]


def extrair_textos(soup: BeautifulSoup) -> list:
    return [
        {"tag": t.name, "texto": t.get_text(strip=True)[:2000]}
        for t in soup.find_all(["p", "article", "blockquote"])
        if len(t.get_text(strip=True)) > 20
    ]


# ─────────────────────────────────────────────────────────────────────────────
# PROCESSAMENTO DE UMA PÁGINA DE QUESTÃO
# ─────────────────────────────────────────────────────────────────────────────

def processar_pagina(
    url: str,
    sessao,
    perfil: dict,
    referer: Optional[str],
) -> Optional[dict]:
    logger.info(f"Acessando: {url}")

    try:
        resp = sessao.get(
            url,
            headers=_headers_get_navegacao(perfil, referer=referer, primeira_visita=(referer is None)),
            timeout=15,
        )
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding or "utf-8"
        html_completo = _limpar_html(resp.text)
    except requests.RequestException as e:
        logger.error(f"Erro ao acessar {url}: {e}")
        return None

    if "text/html" not in resp.headers.get("Content-Type", ""):
        logger.warning(f"Ignorado (não é HTML): {url}")
        return None

    soup    = BeautifulSoup(html_completo, "html.parser")
    dominio = urlparse(url).netloc
    titulo  = soup.title.get_text(strip=True) if soup.title else "Sem título"

    questao = extrair_questao(soup, url)

    if questao and questao["estado"] == "nao_respondida":
        time.sleep(random.uniform(1.5, 4.0))
        html_pos_resposta = responder_e_capturar_gabarito(questao, sessao, perfil)

        if html_pos_resposta:
            soup_pos    = BeautifulSoup(html_pos_resposta, "html.parser")
            questao_pos = extrair_questao(soup_pos, url)
            if questao_pos:
                questao_pos.pop("_csrf", None)
                questao       = questao_pos
                html_completo = html_pos_resposta
                logger.info(f"  Questão re-extraída após resposta → estado: {questao['estado']}")
            else:
                questao.pop("_csrf", None)
        else:
            questao.pop("_csrf", None)
    elif questao:
        questao.pop("_csrf", None)

    dados = {
        "url":            url,
        "titulo":         titulo,
        "dominio":        dominio,
        "timestamp":      datetime.now().isoformat(),
        "status_http":    resp.status_code,
        "questao":        questao,
        "headers_pagina": extrair_headers(soup),
        "imagens":        extrair_imagens(soup, url),
        "textos":         extrair_textos(soup),
        "links":          extrair_links_questoes(soup, url, dominio),
        "html_completo":  html_completo,
    }

    if questao:
        correta = questao["alternativa_correta"]
        logger.info(
            f"  [{questao['estado']}] {questao['numero']} | "
            f"{len(questao['alternativas'])} alternativas | "
            f"correta: {correta['letra'] if correta else 'não exibida'}"
        )
    return dados


# ─────────────────────────────────────────────────────────────────────────────
# FORMATAÇÃO DO RESULTADO (páginas → estrutura provas/questões)
# ─────────────────────────────────────────────────────────────────────────────

def _paginas_para_provas(paginas_coletadas: list) -> list:
    """
    Converte lista de páginas coletadas para:
    [{ nome, questoes: [{ numero, titulo, imagens, alternativas, alternativa_correta }] }]
    """
    questoes_por_prova: dict = {}

    for pagina in paginas_coletadas:
        questao = pagina.get("questao")
        if not questao:
            continue

        prova_nome = questao.get("prova") or "Prova sem nome"
        if prova_nome not in questoes_por_prova:
            questoes_por_prova[prova_nome] = []

        numero_str = questao.get("numero") or ""
        m          = re.search(r"\d+", str(numero_str))  #erro aqui?
        numero_int = int(m.group()) if m else 0

        imagens: list = []
        if questao.get("imagem_enunciado"):
            imagens.append(questao["imagem_enunciado"])
        for img in pagina.get("imagens") or []:
            if img.get("src") and img["src"] not in imagens:
                imagens.append(img["src"])

        alternativas = [
            {"letra": alt.get("letra", ""), "descricao": alt.get("texto", "")}
            for alt in questao.get("alternativas") or []
        ]

        alt_correta         = questao.get("alternativa_correta")
        alternativa_correta = (alt_correta.get("letra") if isinstance(alt_correta, dict) else "") or ""

        questoes_por_prova[prova_nome].append({
            "numero":              numero_int,
            "titulo":              questao.get("enunciado") or "",
            "imagens":             imagens,
            "alternativas":        alternativas,
            "alternativa_correta": alternativa_correta,
        })

    provas = []
    for nome in sorted(questoes_por_prova.keys()):
        questoes = sorted(questoes_por_prova[nome], key=lambda q: q["numero"])
        provas.append({"nome": nome, "questoes": questoes})

    return provas


# ─────────────────────────────────────────────────────────────────────────────
# DESCOBERTA DE TODAS AS URLs DE QUESTÕES DE UMA PROVA (ÍNDICE + PAGINAÇÃO)
# ─────────────────────────────────────────────────────────────────────────────

def descobrir_todas_urls_questoes_prova(
    url_prova: str,
    sessao,
    perfil: dict,
    referer: Optional[str],
    delay: float,
    apenas_questoes: bool,
) -> list[str]:
    """
    Percorre todas as páginas do índice da prova (url_prova e paginação),
    extrai todos os links para /demo/questao/<id>/ e retorna a lista única de URLs.
    Assim garantimos que teremos todas as questões antes de começar o crawl.
    """
    fila_index: list[str] = [url_prova]
    visitados_index: set[str] = set()
    urls_questoes: list[str] = []
    dominio = urlparse(url_prova).netloc

    logger.info(f"  Descoberta de todas as questões da prova (índice + paginação)...")

    while fila_index:
        url_atual = fila_index.pop(0)
        if url_atual in visitados_index:
            continue
        visitados_index.add(url_atual)

        try:
            resp = sessao.get(
                url_atual,
                headers=_headers_get_navegacao(perfil, referer=referer, primeira_visita=(referer is None)),
                timeout=15,
            )
            resp.raise_for_status()
            resp.encoding = resp.apparent_encoding or "utf-8"
            html = _limpar_html(resp.text)
        except requests.RequestException as e:
            logger.warning(f"  Erro ao buscar índice {url_atual}: {e}")
            continue

        if "text/html" not in resp.headers.get("Content-Type", ""):
            continue

        soup = BeautifulSoup(html, "html.parser")
        links = extrair_links_questoes(soup, url_atual, dominio)

        for link_info in links.get("questoes", []):
            u = link_info["url"]
            if u not in urls_questoes:
                urls_questoes.append(u)

        for link_info in links.get("outros", []):
            link = link_info["url"]
            if link in visitados_index or link in fila_index:
                continue
            if re.search(r"/demo/prova/\d+/", link) and "/demo/questao/" not in link:
                fila_index.append(link)

        referer = url_atual
        if fila_index:
            delay_humanizado(delay)

    if apenas_questoes:
        urls_questoes = [u for u in urls_questoes if re.search(r"/demo/questao/\d+/", u)]

    logger.info(f"  → {len(urls_questoes)} questão(ões) encontrada(s) na prova")
    return urls_questoes


# ─────────────────────────────────────────────────────────────────────────────
# FASE 2 — CRAWL DE QUESTÕES DE UMA ÚNICA PROVA
# ─────────────────────────────────────────────────────────────────────────────

def crawl_uma_prova(
    url_prova: str,
    sessao,
    max_paginas: int,
    delay: float,
    apenas_questoes: bool,
    arquivo_saida: str,
    todas_paginas_coletadas: list,
    url_listagem: str,
    referer_anterior: Optional[str],
    max_questoes: int
    ) -> tuple[list, str]:
    """
    Executa o crawl de questões a partir de url_prova.
    Retorna (paginas_novas, ultima_url_visitada).

    Parâmetros:
      todas_paginas_coletadas  — acumulador global para salvar resultado parcial
      url_listagem             — URL da listagem para usar como referer de retorno
      referer_anterior         — URL referer ao entrar na prova
    """
    # Fase de descoberta: percorrer índice e paginação da prova para obter TODAS as URLs de questões
    perfil_disc = random.choice(_PERFIS_CHROME)
    urls_questoes_prova = descobrir_todas_urls_questoes_prova(
        url_prova, sessao, perfil_disc, referer_anterior, delay, apenas_questoes
    )

    if not urls_questoes_prova:
        logger.warning("  Nenhuma URL de questão na descoberta; iniciando com a URL da prova.")
    fila: list[str] = list(urls_questoes_prova) if urls_questoes_prova else [url_prova]
    visitados: set[str] = set()
    paginas_nova: list[dict] = []
    url_anterior: Optional[str] = referer_anterior
    questoes_coletadas: int = 0
    # Nunca limitar pelo tamanho inicial da fila (evita parar em 5 questões).
    # Processar até a fila esvaziar ou atingir max_paginas; a fila cresce com links de cada questão.
    #limite_questoes: int = max_paginas
    limite_questoes: int = max_questoes

    def salvar_parcial() -> None:
        resultado = {"provas": _paginas_para_provas(todas_paginas_coletadas + paginas_nova)}
        with open(arquivo_saida, "w", encoding="utf-8") as f:
            json.dump(resultado, f, ensure_ascii=False, indent=2)

    while fila and questoes_coletadas < limite_questoes:
        url_atual = fila.pop(0)
        if url_atual in visitados:
            continue
        visitados.add(url_atual)

        perfil_atual = random.choice(_PERFIS_CHROME)
        dados = processar_pagina(url_atual, sessao, perfil=perfil_atual, referer=url_anterior)

        if dados:
            paginas_nova.append(dados)
            salvar_parcial()
            url_anterior = url_atual

            if dados.get("questao"):
                questoes_coletadas += 1

            # Incluir na fila qualquer link de questão ainda não visitado (complementar à descoberta)
            links_info = dados.get("links") or {}
            for link_info in links_info.get("questoes", []):
                link = link_info["url"]
                if link not in visitados and link not in fila:
                    if not apenas_questoes or re.search(r"/demo/questao/\d+/", link):
                        fila.append(link)

        if fila and questoes_coletadas < limite_questoes:
            delay_humanizado(delay)

    ultima_url = url_anterior or url_prova

    # Retorna à listagem simulando navegação humana entre provas
    logger.info(f"  ↩ Retornando à listagem: {url_listagem}")
    perfil_volta = random.choice(_PERFIS_CHROME)
    try:
        sessao.get(
            url_listagem,
            headers=_headers_get_navegacao(perfil_volta, referer=ultima_url, primeira_visita=False),
            timeout=15,
        )
    except requests.RequestException as e:
        logger.warning(f"Falha ao retornar à listagem: {e}")

    return paginas_nova, ultima_url


# ─────────────────────────────────────────────────────────────────────────────
# CRAWLER PRINCIPAL — orquestra as duas fases
# ─────────────────────────────────────────────────────────────────────────────

def crawl(
    url_listagem: str,
    max_provas: int = 0,
    max_paginas: int = 200,
    delay: float = 5.0,
    apenas_questoes: bool = True,
    arquivo_saida: str = "/resultado/resultado_crawl.json",
    cookie_header: str = "",
    referer_inicial: Optional[str] = None,
    login_email: str = "",
    login_password: str = "",
    url_login: Optional[str] = None,
) -> dict:
    """
    Orquestra o crawl em 3 etapas (opção principal = descoberta de todas as questões):

    1° Descoberta de todas as provas → array (quantidade = vezes que o crawler roda).
    2° Para cada prova: descoberta de todas as questões → array; coleta todas;
       só então passa para a prova seguinte.
    3° Repete até todas as provas do array terem sido coletadas.

    Parâmetros:
      url_listagem   — URL da página de listagem de provas
      max_provas     — limite de provas (0 = todas)
      max_paginas    — limite de questões por prova
      delay          — delay base entre requisições (segundos)
      apenas_questoes— filtrar só URLs /demo/questao/
      arquivo_saida  — caminho do JSON de saída
      cookie_header  — cookies de sessão
      referer_inicial— referer personalizado para o warm-up
      login_email    — email para login automático
      login_password — senha para login automático
    """
    perfil_sessao = random.choice(_PERFIS_CHROME)
    logger.info(f"Perfil inicial: {perfil_sessao['User-Agent'][:70]}...")

    sessao   = criar_sessao(perfil_sessao, cookie_header=cookie_header)
    url_base = f"{urlparse(url_listagem).scheme}://{urlparse(url_listagem).netloc}"

    # Garante diretório de saída
    saida_dir = os.path.dirname(arquivo_saida)
    if saida_dir:
        os.makedirs(saida_dir, exist_ok=True)

    # Aquecimento de sessão
    aquecer_sessao(sessao, perfil_sessao, url_base, referer_inicial)

    # Login automático (se credenciais fornecidas)
    if login_email and login_password:
        fazer_login(sessao, perfil_sessao, url_base, login_email, login_password, url_login=url_login)
        delay_humanizado(delay)

    # ── FASE 1: Descoberta ────────────────────────────────────────────────────
    perfil_listagem = random.choice(_PERFIS_CHROME)
    provas_descobertas = descobrir_provas(url_listagem, sessao, perfil_listagem, url_base)

    if not provas_descobertas:
        logger.error("Nenhuma prova descoberta. Encerrando.")
        return {"provas": []}

    # Ordenar fila: provas mais recentes (ano mais próximo de 2026) primeiro
    provas_ordenadas = ordenar_provas_mais_recentes_primeiro(provas_descobertas, ano_referencia=2026)
    # Opção principal: usar todas as provas (limitar: provas_ordenadas[:max_provas])
    provas_a_processar = provas_ordenadas if max_provas == 0 else provas_ordenadas[:max_provas]

    logger.info(f"\nArray de provas montado: {len(provas_a_processar)} prova(s) para processar (mais recentes primeiro)")
    for idx, p in enumerate(provas_a_processar, 1):
        logger.info(f"  [{idx:>3}] {p['nome'][:60]}")
        logger.info(f"         {p['url']}")

    # ── FASE 2: Uma prova por vez; só passa à próxima quando todas as questões desta forem coletadas
    todas_paginas:   list[dict] = []
    timestamp_inicio = datetime.now().isoformat()
    referer_atual    = url_listagem

    for idx, prova_info in enumerate(provas_a_processar, 1):
        logger.info(f"\n{'='*65}")
        logger.info(
            f"FASE 2 — Prova [{idx}/{len(provas_a_processar)}]: {prova_info['nome']}"
        )
        logger.info(f"  URL: {prova_info['url']}")

        paginas_prova, ultima_url = crawl_uma_prova(
            url_prova               = prova_info["url"],
            sessao                  = sessao,
            max_paginas             = max_paginas,
            delay                   = delay,
            apenas_questoes         = apenas_questoes,
            arquivo_saida           = arquivo_saida,
            todas_paginas_coletadas = todas_paginas,
            url_listagem            = url_listagem,
            referer_anterior        = referer_atual,
            max_questoes            = 150, #idealmente pegar do array de questoes
        )

        todas_paginas.extend(paginas_prova)
        referer_atual = url_listagem  # próxima prova parte sempre da listagem

        questoes_prova = sum(1 for p in paginas_prova if p.get("questao"))
        total_acumulado_questoes = sum(1 for p in todas_paginas if p.get("questao"))
        logger.info(
            f"  ✅ Prova concluída | questões coletadas nesta prova: {questoes_prova} | "
            f"total acumulado: {total_acumulado_questoes}"
        )

        # Delay entre provas (maior que delay entre questões)
        if idx < len(provas_a_processar):
            delay_humanizado(delay)

    # ── Resultado final ───────────────────────────────────────────────────────
    resultado_final = {"provas": _paginas_para_provas(todas_paginas)}

    with open(arquivo_saida, "w", encoding="utf-8") as f:
        json.dump(resultado_final, f, ensure_ascii=False, indent=2)

    total_questoes = sum(len(p["questoes"]) for p in resultado_final["provas"])
    logger.info(
        f"\nCrawl concluído! | Provas: {len(resultado_final['provas'])} | "
        f"Questões: {total_questoes} | Saída: {arquivo_saida}"
    )
    return resultado_final


# ─────────────────────────────────────────────────────────────────────────────
# PONTO DE ENTRADA
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    URL_LISTAGEM    = _cfg_str ("CRAWLER_URL_PROVAS",      _URL_PROVAS_PADRAO)
    # 0 = todas as provas. Para limitar a 5: _cfg_int("CRAWLER_MAX_PROVAS", 5)
    MAX_PROVAS      = _cfg_int ("CRAWLER_MAX_PROVAS",       0)       # 0 = todas (opção principal)
    MAX_PAGINAS     = _cfg_int ("CRAWLER_MAX_PAGINAS",      200)
    DELAY           = _cfg_float("CRAWLER_DELAY",            5.0)
    APENAS_QUESTOES = _cfg_bool("CRAWLER_APENAS_QUESTOES",  True)
    ARQUIVO_SAIDA   = _cfg_str ("CRAWLER_SAIDA",            "/resultado/resultado_crawl.json")
    COOKIE_HEADER   = _cfg_str ("CRAWLER_COOKIE_HEADER",   "")
    REFERER_INICIAL = _cfg_str ("CRAWLER_REFERER",          "") or None
    LOGIN_EMAIL     = _cfg_str ("CRAWLER_LOGIN_EMAIL",      "moliveira@08242@gmail.com")
    LOGIN_PASSWORD  = _cfg_str ("CRAWLER_LOGIN_PASSWORD",   "residenciaestudar")
    LOGIN_URL       = _cfg_str ("CRAWLER_LOGIN_URL",        "https://provaderesidencia.com.br/premium/login") or None

    logger.info("─" * 65)
    logger.info("MEDMIND CRAWLER — VERSÃO 16 (UNIFICADO)")
    logger.info(f"  URL listagem   : {URL_LISTAGEM}")
    logger.info(f"  Max provas     : {MAX_PROVAS or 'todas'}")
    logger.info(f"  Max questões   : {MAX_PAGINAS} por prova")
    logger.info(f"  Delay base     : {DELAY}s")
    logger.info(f"  Apenas questões: {APENAS_QUESTOES}")
    logger.info(f"  Saída          : {ARQUIVO_SAIDA}")
    logger.info(f"  Login          : {'sim' if (LOGIN_EMAIL and LOGIN_PASSWORD) else 'não'}")
    logger.info(f"  Cookies ext.   : {'sim' if COOKIE_HEADER else 'não'}")
    logger.info(f"  Referer inicial: {REFERER_INICIAL or '(nenhum)'}")
    logger.info("─" * 65)

    resultado = crawl(
        url_listagem    = URL_LISTAGEM,
        max_provas      = MAX_PROVAS,
        max_paginas     = MAX_PAGINAS,
        delay           = DELAY,
        apenas_questoes = APENAS_QUESTOES,
        arquivo_saida   = ARQUIVO_SAIDA,
        cookie_header   = COOKIE_HEADER,
        referer_inicial = REFERER_INICIAL,
        login_email     = LOGIN_EMAIL,
        login_password  = LOGIN_PASSWORD,
        url_login       = LOGIN_URL,
    )

    # ── Resumo final ──────────────────────────────────────────────────────────
    print("\n" + "=" * 65)
    print("RESUMO DO CRAWL")
    print("=" * 65)
    provas         = resultado["provas"]
    total_questoes = sum(len(p["questoes"]) for p in provas)
    print(f"Provas processadas: {len(provas)}")
    print(f"Total de questões : {total_questoes}")

    for prova in provas:
        print(f"\n  📋 {prova['nome']} ({len(prova['questoes'])} questões)")
        for q in prova["questoes"]:
            correta = f" → correta: {q['alternativa_correta']}" if q.get("alternativa_correta") else ""
            print(f"    Questão {q['numero']}: {(q['titulo'] or '')[:60]}...{correta}")

    print(f"\nDados salvos em: {ARQUIVO_SAIDA}")