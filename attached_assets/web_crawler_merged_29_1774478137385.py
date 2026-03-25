"""
Web Crawler provaderesidencia.com.br — VERSÃO MESCLADA (craw_matheus + web_crawler_v19)
======================================================================================
Mescla o conteúdo de craw_matheus.py e web_crawler_v19.py:
  • Cookies e headers atualizados de craw_matheus (demo/provas — GET /demo/prova/2249/abc-sp-2022-r1-1)
  • Toda a lógica robusta de web_crawler_v19 (retry, ciclos, descoberta, extração completa)
  • Suporte a /demo/ e /premium/ para provas e questões

VERSÃO 19 (DIAGNÓSTICO) — Evolução da v18 com pontos de validação detalhados
sessão. Cada fase registra em log o que foi adquirido, o que está faltando e
a causa provável de eventuais falhas.

PONTOS DE VALIDAÇÃO ADICIONADOS:
  ✔ [SESSÃO]    diagnosticar_sessao()  — inventaria motor HTTP, TLS, cookies e
                perfil de navegador antes de qualquer requisição
  ✔ [WARM-UP]   aquecer_sessao()       — valida status + cookies recebidos;
                explica 403/redirect e ausência de cookies
  ✔ [LOGIN]     fazer_login()          — valida cada sub-etapa: GET da página,
                extração de CSRF, POST e confirmação por cookies/redirect
  ✔ [RETRY]     _requisicao_com_retry()— diagnóstico por código HTTP com causa
                provável (403 = bloqueio/cookie; 429 = rate-limit; 5xx = servidor)
  ✔ [AUTH]      _iniciar_sessao_autenticada() — relatório completo de recursos
                usados e estado final da sessão
  ✔ [CICLO]     crawl() — valida estado da sessão a cada novo ciclo e registra
                o que mudou/expirou em relação ao ciclo anterior

Fluxo de validação por etapa:
  1. Pre-flight    : verifica dependências (cloudscraper, requests), versões e
                     cookies disponíveis ANTES de criar a sessão
  2. Sessão criada : confirma motor (cloudscraper vs requests), User-Agent,
                     Accept-Encoding e cookies injetados
  3. Warm-up       : verifica resposta HTTP da home, novos cookies definidos
                     pelo servidor e presença de cf_clearance/sessionid
  4. Login         : valida formulário encontrado, CSRF extraído, POST enviado
                     e sessionid/cookie de auth presente após POST
  5. Por requisição: classifica cada resposta não-2xx com causa provável e
                     estratégia de recuperação adotada

Versão herdada da v18 (mantida integralmente):
  ✔ cloudscraper com browser emulado chrome/windows
  ✔ Retry com backoff exponencial + jitter (403, 429, 5xx, timeout)
  ✔ Fila FIFO de provas ordenadas por ano decrescente
  ✔ Ciclos de N provas com pausa e reautenticação entre ciclos
  ✔ Salvamento incremental questão a questão

Variáveis de ambiente:
  CRAWLER_MODO              - "simples" = fluxo craw_matheus (uma prova → questoes.json)
                             Exemplo: $env:CRAWLER_MODO="simples"; python arthur/web_crawler_merged.py
  CRAWLER_MAX_QUESTOES      - Limita N questões no modo simples (0 = todas)
  CRAWLER_SAIDA             - Caminho do JSON de saída (ex: arthur/resultado/questoes.json).
                             No modo completo, cada gravação FUNDE com o arquivo já existente
                             (mesmo caminho): não apaga provas de execuções anteriores.
                             Para recomeçar do zero: apague o JSON e o *.checkpoint.json do mesmo nome base.
  CRAWLER_URL_PROVAS        - URL da listagem (padrão: .../demo/provas)
  CRAWLER_MAX_PROVAS        - Máximo de provas totais (0 = todas)
  CRAWLER_PROVAS_POR_CICLO  - Provas por ciclo antes da pausa (padrão: 7)
  CRAWLER_PAUSA_CICLO       - Segundos de pausa entre ciclos (padrão: 300)
  CRAWLER_ESPERA_403        - Segundos de espera ao receber 403 (padrão: 60)
  CRAWLER_MAX_PAGINAS       - Máximo de questões por prova (padrão: 200)
  CRAWLER_DELAY             - Delay base entre questões em segundos (padrão: 5.0)
  CRAWLER_APENAS_QUESTOES   - Filtra só URLs /demo/questao/ (padrão: true)
  CRAWLER_COOKIE_HEADER     - Cookies de sessão autenticada
  CRAWLER_LOGIN_EMAIL       - Email para login automático
  CRAWLER_LOGIN_PASSWORD    - Senha para login automático
  CRAWLER_LOGIN_URL         - URL da página de login

Dependências:
  pip install requests beautifulsoup4 cloudscraper
  pip install curl_cffi   # recomendado: imita TLS do Firefox (impersonate="firefox")
  (curl_cffi tem prioridade sobre cloudscraper quando instalado)
"""

import os
import re
import json
import time
import random
import logging
import smtplib
from email.message import EmailMessage
from datetime import datetime, date
from collections import OrderedDict, deque
from urllib.parse import urljoin, urlparse
from typing import Optional, Any

import requests
from bs4 import BeautifulSoup, NavigableString

# curl_cffi: imita fingerprint TLS do Firefox (impersonate="firefox") — prioridade quando disponível
try:
    from curl_cffi import requests as _curl_requests
    _CURL_CFFI_AVAILABLE = True
except ImportError:
    _curl_requests = None
    _CURL_CFFI_AVAILABLE = False
    logging.getLogger(__name__).info(
        "[PRÉ-VOO] curl_cffi não encontrado. Execute: pip install curl_cffi "
        "para usar fingerprint TLS Firefox (reduz 403)."
    )

try:
    import cloudscraper
    # Cria um scraper de referência para verificar se a versão suporta browser dict
    _CS_TEST = cloudscraper.create_scraper(browser={"browser": "chrome", "platform": "windows", "mobile": False})
    _CLOUDSCRAPER_AVAILABLE = True
    del _CS_TEST
except ImportError:
    _CLOUDSCRAPER_AVAILABLE = False
    if not _CURL_CFFI_AVAILABLE:
        logging.getLogger(__name__).warning(
            "[PRÉ-VOO] cloudscraper NÃO encontrado. "
            "O crawler usará requests puro, o que aumenta muito o risco de 403 em sites "
            "protegidos por Cloudflare. Execute: pip install cloudscraper ou pip install curl_cffi"
        )
except Exception as e:
    _CLOUDSCRAPER_AVAILABLE = False
    logging.getLogger(__name__).warning(
        f"[PRÉ-VOO] cloudscraper instalado mas falhou ao inicializar ({e}). "
        "Possível incompatibilidade de versão. Tente: pip install --upgrade cloudscraper"
    )


# ─────────────────────────────────────────────────────────────────────────────
# LOGGING
# ─────────────────────────────────────────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# CHECKPOINT / DEDUPE — utilitários de persistência e identidade de questão
# ─────────────────────────────────────────────────────────────────────────────

def _normalizar_url_sem_fragmento(url: str) -> str:
    """Normaliza URL removendo apenas fragmento (âncora)."""
    if not url:
        return ""
    try:
        return urlparse(url)._replace(fragment="").geturl()
    except Exception:
        return url


def _extrair_id_questao_da_url(url: str) -> str:
    """
    Extrai ID numérico de URLs de questão:
      /demo/questao/<id>/...
      /premium/questao/<id>/...
    """
    if not url:
        return ""
    m = re.search(r"/(?:demo|premium)/questao/(\d+)/", url)
    return m.group(1) if m else ""


def _chave_questao_unica(pagina: dict) -> str:
    """
    Chave estável para deduplicação de questões.
    Prioridade:
      1) ID da questão na URL
      2) URL completa da questão
      3) fallback por prova + número + início do enunciado
    """
    questao = (pagina or {}).get("questao") or {}
    pagina_url = _normalizar_url_sem_fragmento((pagina or {}).get("url", ""))
    questao_url = _normalizar_url_sem_fragmento(questao.get("url") or pagina_url)
    questao_id = _extrair_id_questao_da_url(questao_url)
    if questao_id:
        return f"id:{questao_id}"
    if questao_url:
        return f"url:{questao_url}"
    prova = (questao.get("prova") or "prova_sem_nome").strip().lower()
    numero = str(questao.get("numero") or "").strip().lower()
    titulo = (questao.get("enunciado") or "").strip().lower()[:160]
    return f"fallback:{prova}|{numero}|{titulo}"


def _checkpoint_path(arquivo_saida: str) -> str:
    """
    Caminho do arquivo de estado incremental.
    Ex.: resultado_crawl.json -> resultado_crawl.checkpoint.json
    """
    base, _ = os.path.splitext(arquivo_saida)
    return f"{base}.checkpoint.json"


def _carregar_checkpoint(arquivo_saida: str) -> dict:
    """
    Carrega estado incremental do crawl.
    Estrutura:
      completed_provas: [url,...]
      in_progress_prova: str
      updated_at: ISO timestamp
    """
    caminho = _checkpoint_path(arquivo_saida)
    if not os.path.exists(caminho):
        return {"completed_provas": [], "in_progress_prova": "", "updated_at": ""}
    try:
        with open(caminho, "r", encoding="utf-8") as f:
            data = json.load(f) or {}
        return {
            "completed_provas": list(data.get("completed_provas") or []),
            "in_progress_prova": str(data.get("in_progress_prova") or ""),
            "updated_at": str(data.get("updated_at") or ""),
        }
    except Exception as e:
        logger.warning(f"[CHECKPOINT] Falha ao carregar checkpoint ({caminho}): {e}")
        return {"completed_provas": [], "in_progress_prova": "", "updated_at": ""}


def _salvar_checkpoint(arquivo_saida: str, estado: dict) -> None:
    """
    Salva checkpoint de forma atômica para suportar retomada após interrupções.
    """
    caminho = _checkpoint_path(arquivo_saida)
    pasta = os.path.dirname(caminho)
    if pasta:
        os.makedirs(pasta, exist_ok=True)
    payload = {
        "completed_provas": list(dict.fromkeys(estado.get("completed_provas") or [])),
        "in_progress_prova": estado.get("in_progress_prova") or "",
        "updated_at": datetime.now().isoformat(),
    }
    tmp = f"{caminho}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp, caminho)


# ─────────────────────────────────────────────────────────────────────────────
# MERGE JSON — unir arquivo de saída existente com provas da sessão atual
# ─────────────────────────────────────────────────────────────────────────────
# Motivação: em retomadas, o acumulador em memória só contém a execução corrente;
# sem merge, salvar parcial sobrescreveria o histórico anterior no disco.
# Chave de prova: nome normalizado (texto do h2). Chave de questão: id_questao, url ou fallback.


def _carregar_json_saida_existente(arquivo_saida: str) -> dict:
    """Lê o JSON de resultado se existir e for válido; senão retorna {'provas': []}."""
    if not arquivo_saida or not os.path.exists(arquivo_saida):
        return {"provas": []}
    try:
        with open(arquivo_saida, "r", encoding="utf-8") as f:
            data = json.load(f) or {}
        provas = data.get("provas")
        if not isinstance(provas, list):
            return {"provas": []}
        return {"provas": provas}
    except Exception as e:
        logger.warning(f"[MERGE] Não foi possível ler JSON existente ({arquivo_saida}): {e}")
        return {"provas": []}


def _normalizar_chave_prova(nome: str) -> str:
    return re.sub(r"\s+", " ", (nome or "").strip().lower()) or "__prova_sem_nome"


def _chave_questao_item_json(q: dict) -> str:
    """Chave estável para deduplicação / merge no JSON consolidado."""
    if not isinstance(q, dict):
        return "__invalid__"
    i = str(q.get("id_questao") or "").strip()
    if i:
        return f"id:{i}"
    u = _normalizar_url_sem_fragmento(q.get("url") or "")
    if u:
        return f"url:{u}"
    n = q.get("numero", 0)
    t = (q.get("titulo") or "")[:160].strip().lower()
    return f"f:{n}|{t}"


def _pontuacao_completude_questao_json(q: dict) -> int:
    """Heurística para desempate: prefere registro mais completo (gabarito, texto, etc.)."""
    if not isinstance(q, dict):
        return 0
    score = 0
    if (q.get("alternativa_correta") or "").strip():
        score += 200
    tit = (q.get("titulo") or "").strip()
    if tit:
        score += min(len(tit), 500)
    alts = q.get("alternativas") or []
    if isinstance(alts, list):
        score += min(len(alts) * 5, 50)
    com = q.get("comentarios") or []
    if isinstance(com, list):
        score += min(len(com) * 3, 30)
    imgs = q.get("imagens") or []
    if isinstance(imgs, list):
        score += min(len(imgs) * 2, 20)
    return score


def _melhor_questao_json(a: dict, b: dict) -> dict:
    pa = _pontuacao_completude_questao_json(a)
    pb = _pontuacao_completude_questao_json(b)
    if pb > pa:
        return dict(b)
    if pb < pa:
        return dict(a)
    # Empate: mantém o mais recente na prática usando o que veio da sessão (b) se igual.
    return dict(b)


def _fundir_listas_provas(provas_antigas: list, provas_novas_sessao: list) -> list:
    """
    Une duas listas no formato [{'nome': str, 'questoes': [...]}, ...].
    Preserva ordem das provas já existentes no disco; provas novas (chave inédita) entram ao final.
    Questões na mesma prova: mesma chave -> fica a versão com maior pontuação de completude.
    """
    por_chave: OrderedDict[str, dict] = OrderedDict()

    for p in provas_antigas or []:
        if not isinstance(p, dict):
            continue
        k = _normalizar_chave_prova(str(p.get("nome") or ""))
        qmap: OrderedDict[str, dict] = OrderedDict()
        for q in p.get("questoes") or []:
            if not isinstance(q, dict):
                continue
            qk = _chave_questao_item_json(q)
            qmap[qk] = dict(q)
        por_chave[k] = {
            "nome": p.get("nome") or "Prova sem nome",
            "questoes": qmap,
        }

    for p in provas_novas_sessao or []:
        if not isinstance(p, dict):
            continue
        k = _normalizar_chave_prova(str(p.get("nome") or ""))
        if k not in por_chave:
            qmap = OrderedDict()
            for q in p.get("questoes") or []:
                if not isinstance(q, dict):
                    continue
                qmap[_chave_questao_item_json(q)] = dict(q)
            por_chave[k] = {"nome": p.get("nome") or "Prova sem nome", "questoes": qmap}
            continue

        bloco = por_chave[k]
        bloco["nome"] = p.get("nome") or bloco["nome"]
        base_q: OrderedDict[str, dict] = bloco["questoes"]
        for q in p.get("questoes") or []:
            if not isinstance(q, dict):
                continue
            qk = _chave_questao_item_json(q)
            if qk not in base_q:
                base_q[qk] = dict(q)
            else:
                base_q[qk] = _melhor_questao_json(base_q[qk], q)

    resultado: list[dict] = []
    for _k, dados in por_chave.items():
        def _num_ord(qd: dict) -> int:
            n = qd.get("numero", 0)
            if isinstance(n, int):
                return n
            try:
                return int(n)
            except (TypeError, ValueError):
                m = re.search(r"\d+", str(n))
                return int(m.group()) if m else 0

        questoes = sorted(dados["questoes"].values(), key=_num_ord)
        resultado.append({"nome": dados["nome"], "questoes": questoes})
    return resultado


def _gravar_json_resultado_merged(arquivo_saida: str, provas_destas_sessao: list) -> dict:
    """
    Carrega o JSON já existente em disco (se houver), funde com `provas_destas_sessao`
    (saída de _paginas_para_provas apenas desta execução) e grava de forma atômica.
    Retorna o dict gravado: {"provas": [...]}.
    """
    existente = _carregar_json_saida_existente(arquivo_saida)
    provas_antigas = existente.get("provas") or []
    fundido = _fundir_listas_provas(provas_antigas, provas_destas_sessao)
    out = {"provas": fundido}
    pasta = os.path.dirname(arquivo_saida)
    if pasta:
        os.makedirs(pasta, exist_ok=True)
    tmp = f"{arquivo_saida}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    os.replace(tmp, arquivo_saida)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# NOTIFICAÇÃO DE ERROS POR E-MAIL
# ─────────────────────────────────────────────────────────────────────────────

def notificar_erro_por_email(mensagem: str) -> None:
    """
    Envia um e-mail para alertar sobre erros fatais que interrompem o crawler.

    Configuração via variáveis de ambiente:
      CRAWLER_SMTP_HOST     - host SMTP (ex.: smtp.gmail.com)
      CRAWLER_SMTP_PORT     - porta SMTP (ex.: 587)
      CRAWLER_SMTP_USER     - usuário/login SMTP
      CRAWLER_SMTP_PASSWORD - senha ou app password
      CRAWLER_EMAIL_FROM    - remetente (se vazio, usa CRAWLER_SMTP_USER)

    O destinatário é sempre "arthurlarruda@gmail.com".
    Se qualquer configuração crítica estiver ausente, apenas loga o erro.
    """
    smtp_host = os.environ.get("CRAWLER_SMTP_HOST", "").strip()
    smtp_port = os.environ.get("CRAWLER_SMTP_PORT", "").strip() or "587"
    smtp_user = os.environ.get("CRAWLER_SMTP_USER", "").strip()
    smtp_pass = os.environ.get("CRAWLER_SMTP_PASSWORD", "").strip()
    email_from = os.environ.get("CRAWLER_EMAIL_FROM", "").strip() or smtp_user
    email_to = "arthurlarruda@gmail.com"

    if not (smtp_host and smtp_user and smtp_pass and email_from):
        logger.warning(
            "[ALERTA] Erro fatal no crawler, mas configuração SMTP está incompleta. "
            "Defina CRAWLER_SMTP_HOST/PORT/USER/PASSWORD/EMAIL_FROM para habilitar envio de e-mail."
        )
        logger.error(f"[ALERTA] Detalhes do erro: {mensagem}")
        return

    try:
        msg = EmailMessage()
        msg["Subject"] = "[MedMind Crawler] Erro fatal no crawler"
        msg["From"] = email_from
        msg["To"] = email_to
        corpo = f"Data/hora: {datetime.now().isoformat()}\n\nErro:\n{mensagem}\n"
        msg.set_content(corpo)

        with smtplib.SMTP(smtp_host, int(smtp_port)) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)

        logger.info(f"[ALERTA] E-mail de erro enviado para {email_to}.")
    except Exception as e:
        logger.error(f"[ALERTA] Falha ao enviar e-mail de erro: {e}")
        logger.error(f"[ALERTA] Erro original: {mensagem}")


# ─────────────────────────────────────────────────────────────────────────────
# DIAGNÓSTICO DE SESSÃO — relatório de recursos e estado
# ─────────────────────────────────────────────────────────────────────────────

def diagnosticar_sessao(
    sessao,
    perfil: dict,
    cookie_header_env: str = "",
    etapa: str = "SESSÃO",
) -> None:
    """
    Imprime um relatório diagnóstico completo dos recursos disponíveis para
    a sessão atual: motor HTTP, TLS, User-Agent, cookies e variáveis de auth.

    Chamada em três momentos:
      1. Logo após criar_sessao()              — estado inicial
      2. Logo após aquecer_sessao()            — estado pós-warm-up
      3. No início de cada ciclo              — estado no início do ciclo

    O relatório usa prefixo [DIAG:{etapa}] para fácil filtragem nos logs.
    """
    sep = "─" * 65
    logger.info(f"\n{sep}")
    logger.info(f"[DIAG:{etapa}] ── RELATÓRIO DE RECURSOS DA SESSÃO ──")
    logger.info(sep)

    # ── Motor HTTP ────────────────────────────────────────────────────────────
    if getattr(sessao, "_curl_cffi", False):
        motor = "curl_cffi (impersonate=firefox)"
        tls   = "✔ Fingerprint TLS do Firefox (curl-impersonate)"
        challenge = "✔ TLS idêntico ao Firefox — reduz detecção Cloudflare"
    elif _CLOUDSCRAPER_AVAILABLE and hasattr(sessao, 'cloudscraper'):
        motor = "cloudscraper (emulação chrome/windows)"
        tls   = "✔ Fingerprint TLS do Chrome (cipher suites + extensões em ordem real)"
        challenge = "✔ Resolve challenges JavaScript do Cloudflare automaticamente"
    elif _CLOUDSCRAPER_AVAILABLE:
        motor = "cloudscraper (ativo)"
        tls   = "✔ Fingerprint TLS aprimorado"
        challenge = "✔ Anti-bot Cloudflare habilitado"
    else:
        motor = "requests.Session (puro) — ⚠ RISCO DE 403"
        tls   = "✗ TLS padrão Python — pode ser detectado como bot pelo Cloudflare"
        challenge = "✗ Sem resolução de challenge JS — instale curl_cffi ou cloudscraper"

    logger.info(f"[DIAG:{etapa}] Motor HTTP   : {motor}")
    logger.info(f"[DIAG:{etapa}] TLS          : {tls}")
    logger.info(f"[DIAG:{etapa}] Anti-bot CF  : {challenge}")

    # ── Perfil de navegador ───────────────────────────────────────────────────
    ua = sessao.headers.get("User-Agent") or perfil.get("User-Agent", "(não definido)")
    logger.info(f"[DIAG:{etapa}] User-Agent   : {ua}")
    logger.info(f"[DIAG:{etapa}] sec-ch-ua    : {perfil.get('sec-ch-ua', '(não definido)')}")
    logger.info(f"[DIAG:{etapa}] Plataforma   : {perfil.get('sec-ch-ua-platform', '(não definido)')}")

    enc = sessao.headers.get("Accept-Encoding", "(não definido)")
    logger.info(f"[DIAG:{etapa}] Accept-Enc.  : {enc}")
    if "br" not in enc:
        logger.info(
            f"[DIAG:{etapa}]               ℹ  brotli desabilitado — "
            "requests puro não descomprime br/zstd nativamente"
        )

    # ── Cookies na sessão ─────────────────────────────────────────────────────
    cookies_atuais = dict(sessao.cookies)
    logger.info(f"[DIAG:{etapa}] Cookies ({len(cookies_atuais):>2}) : {list(cookies_atuais.keys()) or '(nenhum)'}")

    # Cookies críticos individualmente
    _validar_cookie(cookies_atuais, "sessionid",   etapa,
                    "✔ Sessão autenticada presente",
                    "✗ sessionid ausente — login ainda não realizado ou falhou")
    _validar_cookie(cookies_atuais, "cf_clearance", etapa,
                    "✔ Token Cloudflare presente — bypass ativo",
                    "⚠ cf_clearance ausente — se o site usa Cloudflare, requisições "
                    "podem retornar 403. Obtenha via cloudscraper ou copie do navegador")
    _validar_cookie(cookies_atuais, "csrftoken",   etapa,
                    "✔ CSRF token presente — formulários podem ser submetidos",
                    "⚠ csrftoken ausente — pode impedir o POST de login")

    # ── Fonte dos cookies ─────────────────────────────────────────────────────
    if cookie_header_env:
        logger.info(
            f"[DIAG:{etapa}] Fonte cookies: CRAWLER_COOKIE_HEADER (variável de ambiente) "
            f"— {len(cookie_header_env.split(';'))} cookie(s) fornecidos externamente"
        )
    else:
        logger.info(
            f"[DIAG:{etapa}] Fonte cookies: HEADER_REQUISICAO_FIXO (embutido no código) "
            "— atualize periodicamente pois sessionid e cf_clearance expiram"
        )

    logger.info(sep + "\n")


def _validar_cookie(cookies: dict, nome: str, etapa: str, msg_ok: str, msg_falha: str) -> None:
    """Loga o estado de um cookie crítico com mensagem contextualizada."""
    if nome in cookies:
        logger.info(f"[DIAG:{etapa}]   {msg_ok}")
    else:
        logger.warning(f"[DIAG:{etapa}]   {msg_falha}")


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

# Valor inicial; é sobrescrito por _aplicar_profile() no entrypoint.
_URL_PROVAS_PADRAO      = "https://www.provaderesidencia.com.br/demo/provas"
_PROVAS_POR_CICLO_PADRAO = 7     # provas processadas por ciclo antes da pausa
_PAUSA_CICLO_PADRAO      = 300   # segundos de pausa entre ciclos (5 minutos)
_ESPERA_403_PADRAO       = 60    # segundos de espera ao receber 403/429 antes de retentar

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
# PERFIS DE CRAWLER (sem duplicar o core)
# ─────────────────────────────────────────────────────────────────────────────

_HEADERS_COMUNS = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "pt-BR,pt;q=0.9",
    "cache-control": "max-age=0",
    "priority": "u=0, i",
    "sec-ch-ua": '"Not:A-Brand";v="99", "Microsoft Edge";v="145", "Chromium";v="145"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "same-origin",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36 Edg/145.0.0.0",
}

PROFILE_PRESETS = {
    # Catálogo demo
    "demo": {
        "base_url": "https://www.provaderesidencia.com.br",
        "url_provas_padrao": "https://www.provaderesidencia.com.br/demo/provas",
        "referer_padrao": "https://www.provaderesidencia.com.br/demo/provas",
        "cookie_str": "",  # pode vir de CRAWLER_COOKIE_HEADER
    },
    # Premium gratuito (ajuste url se necessário no ambiente)
    "premium_free": {
        "base_url": "https://www.provaderesidencia.com.br",
        "url_provas_padrao": "https://www.provaderesidencia.com.br/premium/banco-de-provas",
        "referer_padrao": "https://www.provaderesidencia.com.br/premium/banco-de-provas",
        "cookie_str": "",
    },
    # Premium pago — cookies/header fornecidos pelo usuário
    "premium_paid": {
        "base_url": "https://www.provaderesidencia.com.br",
        "url_provas_padrao": "https://www.provaderesidencia.com.br/premium/banco-de-provas",
        "referer_padrao": "https://www.provaderesidencia.com.br/premium/questao/245821/",
        "cookie_str": (
            "_gid=GA1.3.1532728266.1773882000; "
            "csrftoken=nxBfOTCmng7uvMBfhgEAEq5YhM7XI4zF; "
            "tkpd=8205d85aa0f1f9d8895fd47fa14b21d1; "
            "cf_clearance=._JLud4dGV_W1s7w1aUqvi_BM6YtD_Mysr2XM2eNtac-1773962805-1.2.1.1-"
            "uclSCwchdYvNcKBOVJFv0QMKhEe5AySRozL6rUPU2illH01pIWBFF2FNIrdilNDw.nLsHyh9BoenvhYE3oSuw"
            "ynP2yDsMRyoxkhLNV3i7nzMXPywVpotiBgXOP7YcL5C3vR8nf23tH_PE0NDh8_UPU3F9qWVYbeqsdq4HB9w8T_6"
            "l.KK9.BUaL457pVOb8LIwr7nZBCbSIPq4fVM9G7V935HLXDgXVvP6cL8jnPTzZU; "
            "_gat_gtag_UA_64312596_1=1; "
            "sessionid=.eJxVj0sOgzAMRO_iNUL52SQsu-8ZkOOE0o9AArqqcvdCy4bd2DMe-X2AgoH2A-iVoV0ItIYa7aiC-ZBNKRV0"
            "_F6H7r3kubsnaMEh2QZO-8jyzONupgePt6mWaVzne6z3SH24S32dUn5djuypYOBl2K4jMWvvpFGYhUWbPouyLkfN"
            "LBk9pbhNyQVMRH3oyQVxgbwYvf2NuJVaVGGnMQ690QeXVl5bsj-wv8ZSyhfXsUwn:1w3Mli:sn5-kJayxynWrFYda8"
            "cwnTpqevDiid9TxlYoD5sjRz0; "
            "_ga_DDXNJ6N67S=GS2.1.s1773962772$o11$g1$t1773962834$j59$l0$h0; "
            "_ga=GA1.1.736910115.1773363804"
        ),
    },
}

# Globals mutáveis de configuração ativa (setados por _aplicar_profile)
ACTIVE_PROFILE = "demo"
BASE_URL_SIMPLE = "https://www.provaderesidencia.com.br"
_COOKIE_STR = ""
CURL_CFFI_COOKIES = {}
HEADER_REQUISICAO_FIXO = OrderedDict()


def _parse_cookie_string(cookie_string: str) -> dict:
    cookies = {}
    if not cookie_string:
        return cookies
    for part in cookie_string.split("; "):
        if "=" in part:
            k, _, v = part.partition("=")
            cookies[k.strip()] = v.strip()
    return cookies


def _aplicar_profile(profile_name: str) -> str:
    """
    Ativa um perfil de crawler sem duplicar lógica de extração/retry.
    Retorna o nome efetivo do perfil (fallback para demo se inválido).
    """
    global ACTIVE_PROFILE, BASE_URL_SIMPLE, _URL_PROVAS_PADRAO, _COOKIE_STR, CURL_CFFI_COOKIES, HEADER_REQUISICAO_FIXO

    if profile_name not in PROFILE_PRESETS:
        logger.warning(f"[PROFILE] Perfil '{profile_name}' inválido. Usando 'demo'.")
        profile_name = "demo"

    cfg = PROFILE_PRESETS[profile_name]
    ACTIVE_PROFILE = profile_name
    BASE_URL_SIMPLE = cfg["base_url"]
    _URL_PROVAS_PADRAO = cfg["url_provas_padrao"]
    _COOKIE_STR = cfg.get("cookie_str", "").strip()
    CURL_CFFI_COOKIES = _parse_cookie_string(_COOKIE_STR)

    headers = OrderedDict(_HEADERS_COMUNS)
    headers["cookie"] = _COOKIE_STR
    headers["referer"] = cfg["referer_padrao"]
    HEADER_REQUISICAO_FIXO = headers
    return profile_name


def _impersonate_kw(sessao) -> dict:
    """Retorna {'impersonate': 'firefox'} quando a sessão é curl_cffi (TLS fingerprint Firefox)."""
    return {"impersonate": "firefox"} if getattr(sessao, "_curl_cffi", False) else {}


def _headers_get_navegacao(
    perfil: dict,
    referer: Optional[str],
    primeira_visita: bool,
) -> OrderedDict:
    """Retorna o header exato para espelhar a requisição; referer pode ser sobrescrito."""
    headers = OrderedDict(HEADER_REQUISICAO_FIXO)
    if referer:
        headers["referer"] = referer
    return headers


def _headers_post_formulario(
    perfil: dict,
    url_pagina: str,
    origin: str,
) -> OrderedDict:
    # Prioridade: headers de craw_matheus (HEADER_REQUISICAO_FIXO) para consistência
    ua    = HEADER_REQUISICAO_FIXO.get("user-agent") or perfil["User-Agent"]
    sec   = HEADER_REQUISICAO_FIXO.get("sec-ch-ua") or perfil["sec-ch-ua"]
    plat  = HEADER_REQUISICAO_FIXO.get("sec-ch-ua-platform") or perfil["sec-ch-ua-platform"]
    mobile = HEADER_REQUISICAO_FIXO.get("sec-ch-ua-mobile") or perfil.get("sec-ch-ua-mobile", "?0")
    accept_lang = HEADER_REQUISICAO_FIXO.get("accept-language") or random.choice(_ACCEPT_LANGUAGES)
    headers = OrderedDict([
        ("User-Agent",                ua),
        ("Accept",                    (
            "text/html,application/xhtml+xml,application/xml;"
            "q=0.9,image/avif,image/webp,image/apng,*/*;"
            "q=0.8,application/signed-exchange;v=b3;q=0.7"
        )),
        ("Accept-Encoding",           HEADER_REQUISICAO_FIXO.get("accept-encoding", "gzip, deflate")),
        ("Accept-Language",           accept_lang),
        ("Cache-Control",             "max-age=0"),
        ("Connection",                "keep-alive"),
        ("Content-Type",              "application/x-www-form-urlencoded"),
        ("Origin",                    origin),
        ("Referer",                   url_pagina),
        ("sec-ch-ua",                 sec),
        ("sec-ch-ua-mobile",          mobile),
        ("sec-ch-ua-platform",        plat),
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

def _injetar_cookies_na_sessao(sessao, cookie_string: str, dominio: str = "www.provaderesidencia.com.br") -> None:
    """Injeta cookies de uma string 'nome=valor; nome2=valor2' no cookie jar da sessão."""
    if not cookie_string or not cookie_string.strip():
        return
    for par in cookie_string.split(";"):
        par = par.strip()
        if "=" in par:
            nome, _, valor = par.partition("=")
            nome, valor = nome.strip(), valor.strip()
            if nome:
                sessao.cookies.set(nome, valor, domain=dominio)


def criar_sessao(perfil: dict, cookie_header: str = ""):
    """
    Cria sessão HTTP anti-403 em camadas:

    Camada 0 — curl_cffi (prioridade quando instalado):
      Imita fingerprint TLS do Firefox (impersonate="firefox"). Usa cookies e
      headers fornecidos (CURL_CFFI_COOKIES / HEADER_REQUISICAO_FIXO).

    Camada 1 — cloudscraper com browser emulado (chrome/windows):
      Resolve fingerprint TLS e challenge Cloudflare.

    Camada 2 — requests.Session padrão (fallback):
      Aplica User-Agent e headers do perfil selecionado.
    """
    logger.info("[SESSÃO] Criando sessão HTTP...")

    if _CURL_CFFI_AVAILABLE:
        sessao = _curl_requests.Session()
        sessao._curl_cffi = True
        # Headers Firefox (sem cookie; cookies vão no .cookies)
        for k, v in HEADER_REQUISICAO_FIXO.items():
            if k.lower() != "cookie":
                sessao.headers[k] = v
        sessao.cookies.update(CURL_CFFI_COOKIES)
        logger.info(
            "[SESSÃO] ✔ Motor: curl_cffi com impersonate='firefox'\n"
            "           Fingerprint TLS do Firefox; cookies e headers fornecidos aplicados."
        )
        injetados = list(sessao.cookies.keys())
        logger.info(
            f"[SESSÃO] ✔ Cookies CURL_CFFI_COOKIES ({len(injetados)}): {injetados}"
        )
        if cookie_header:
            _injetar_cookies_na_sessao(sessao, cookie_header)
            logger.info(f"[SESSÃO] ✔ Cookies CRAWLER_COOKIE_HEADER sobrepostos. Finais: {list(sessao.cookies.keys())}")
        return sessao

    if _CLOUDSCRAPER_AVAILABLE:
        sessao = cloudscraper.create_scraper(
            browser={
                "browser":  "chrome",
                "platform": "windows",
                "mobile":   False,
            },
            delay=5,
        )
        logger.info(
            "[SESSÃO] ✔ Motor: cloudscraper com emulação chrome/windows\n"
            "           Fingerprint TLS Chrome; challenges JavaScript do Cloudflare."
        )
    else:
        sessao = requests.Session()
        logger.warning(
            "[SESSÃO] ✗ Motor: requests.Session puro (curl_cffi/cloudscraper não disponível)\n"
            "           RISCO de 403. Instale: pip install curl_cffi ou pip install cloudscraper"
        )

    accept_enc = "gzip, deflate, br, zstd" if _CLOUDSCRAPER_AVAILABLE else "gzip, deflate"
    sessao.headers.update({
        "User-Agent":      perfil["User-Agent"],
        "Connection":      "keep-alive",
        "Accept-Encoding": accept_enc,
    })
    logger.info(
        f"[SESSÃO] ✔ User-Agent: {perfil['User-Agent'][:80]}\n"
        f"           Accept-Encoding: {accept_enc}"
    )
    if not _CLOUDSCRAPER_AVAILABLE and "br" not in accept_enc:
        logger.info(
            "[SESSÃO] ℹ brotli excluído — requests puro não descomprime br."
        )

    cookie_fixo = HEADER_REQUISICAO_FIXO.get("cookie", "")
    if cookie_fixo:
        _injetar_cookies_na_sessao(sessao, cookie_fixo)
        logger.info(
            f"[SESSÃO] ✔ Cookies HEADER_REQUISICAO_FIXO injetados: {list(sessao.cookies.keys())}"
        )
    else:
        logger.warning("[SESSÃO] ⚠ HEADER_REQUISICAO_FIXO sem cookies definidos.")

    if cookie_header:
        _injetar_cookies_na_sessao(sessao, cookie_header)
        logger.info(f"[SESSÃO] ✔ Cookies CRAWLER_COOKIE_HEADER sobrepostos. Finais: {list(sessao.cookies.keys())}")

    return sessao


def aquecer_sessao(
    sessao,
    perfil: dict,
    url_base: str,
    referer_inicial: Optional[str] = None,
) -> None:
    """
    Visita a home do site para:
      - Estabelecer conexão TCP/TLS e obter cookies de sessão iniciais
      - Fazer o Cloudflare reconhecer a sessão antes de qualquer crawl
      - Simular comportamento humano (primeiro acesso à raiz do site)

    Valida o resultado e explica eventuais problemas no log.
    """
    logger.info(f"[WARM-UP] Iniciando aquecimento de sessão em: {url_base}")
    logger.info(
        "[WARM-UP] Objetivo: estabelecer TLS, obter cookies iniciais e "
        "deixar o Cloudflare reconhecer esta sessão antes do crawl."
    )

    try:
        referer_warmup = referer_inicial if referer_inicial else (url_base.rstrip("/") + "/")
        resp = sessao.get(
            url_base,
            headers=_headers_get_navegacao(
                perfil,
                referer=referer_warmup,
                primeira_visita=(referer_inicial is None),
            ),
            timeout=15,
            **_impersonate_kw(sessao),
        )

        cookies_apos = list(sessao.cookies.keys())
        cf_ray       = resp.headers.get("CF-RAY", "")
        server       = resp.headers.get("Server", "desconhecido")

        logger.info(
            f"[WARM-UP] ✔ Resposta recebida | status={resp.status_code} | "
            f"servidor={server}"
        )

        if cf_ray:
            logger.info(
                f"[WARM-UP] ℹ Header CF-RAY detectado ({cf_ray}) — o site usa Cloudflare.\n"
                "           cloudscraper é indispensável neste caso para evitar 403."
            )

        if resp.status_code == 403:
            logger.error(
                "[WARM-UP] ✗ 403 Forbidden já no warm-up. Causas prováveis:\n"
                "  1. IP bloqueado pelo Cloudflare ou pelo servidor — aguarde ou troque de rede.\n"
                "  2. cf_clearance expirado — copie um novo do navegador e defina em "
                "CRAWLER_COOKIE_HEADER.\n"
                "  3. cloudscraper não instalado ou versão desatualizada — "
                "execute: pip install --upgrade cloudscraper\n"
                "  4. User-Agent muito antigo ou incomum — o perfil atual será substituído "
                "na próxima tentativa por rotação automática."
            )
        elif resp.status_code in (301, 302, 303, 307, 308):
            destino = resp.headers.get("Location", "(desconhecido)")
            logger.warning(
                f"[WARM-UP] ⚠ Redirecionamento {resp.status_code} → {destino}\n"
                "           Se o destino for uma página de login, a sessão não está "
                "autenticada e o login automático será necessário."
            )
        else:
            logger.info(f"[WARM-UP] ✔ Status {resp.status_code} — warm-up concluído sem bloqueio.")

        # Valida cookies recebidos após warm-up
        if cookies_apos:
            logger.info(f"[WARM-UP] ✔ Cookies após warm-up ({len(cookies_apos)}): {cookies_apos}")
            if "cf_clearance" in sessao.cookies:
                logger.info(
                    "[WARM-UP] ✔ cf_clearance obtido automaticamente — "
                    "cloudscraper resolveu o challenge do Cloudflare."
                )
        else:
            logger.warning(
                "[WARM-UP] ⚠ Nenhum novo cookie recebido após warm-up.\n"
                "           Isso pode indicar que o servidor não está definindo cookies "
                "para esta sessão, o que pode causar problemas no login e no crawl."
            )

        time.sleep(random.uniform(2.0, 4.0))

    except requests.Timeout:
        logger.error(
            f"[WARM-UP] ✗ Timeout ao aquecer sessão em {url_base}.\n"
            "           O servidor não respondeu a tempo. Verifique a conectividade "
            "de rede e tente novamente."
        )
    except requests.ConnectionError as e:
        logger.error(
            f"[WARM-UP] ✗ Erro de conexão: {e}\n"
            "           Impossível alcançar o servidor. Verifique DNS, firewall ou "
            "se o site está fora do ar."
        )
    except requests.RequestException as e:
        logger.warning(f"[WARM-UP] ✗ Falha no aquecimento de sessão: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# REQUISIÇÃO COM RETRY + BACKOFF EXPONENCIAL (anti-403/429)
# ─────────────────────────────────────────────────────────────────────────────

def _requisicao_com_retry(
    sessao,
    metodo: str,             # "GET" ou "POST"
    url: str,
    headers: dict,
    espera_403: int = _ESPERA_403_PADRAO,
    tentativas: int = 3,
    timeout: int = 20,
    **kwargs,
) -> Optional[requests.Response]:
    """
    Executa GET ou POST com até `tentativas` retentativas em caso de falha.

    Estratégia de backoff por tipo de erro:
      - 429 Too Many Requests : aguarda Retry-After (se presente) ou espera_403 s,
                                depois retenta
      - 403 Forbidden         : aguarda espera_403 s e retenta (pode ser bloqueio
                                temporário de IP ou cookie expirado)
      - 5xx Server Error      : backoff exponencial: 5 s, 10 s, 20 s…
      - Timeout / conexão     : backoff exponencial igualmente
      - 200–399               : retorna imediatamente (sucesso)

    Retorna o objeto Response ou None se todas as tentativas esgotarem.
    """
    logger.info(f"[RETRY] {metodo.upper()} → {url}")

    for tentativa in range(1, tentativas + 1):
        try:
            kwargs_imp = {**kwargs, **_impersonate_kw(sessao)}
            if metodo.upper() == "POST":
                resp = sessao.post(url, headers=headers, timeout=timeout, **kwargs_imp)
            else:
                resp = sessao.get(url, headers=headers, timeout=timeout, **kwargs_imp)

            status = resp.status_code
            cf_ray = resp.headers.get("CF-RAY", "")

            if status == 429:
                retry_after = int(resp.headers.get("Retry-After", espera_403))
                logger.warning(
                    f"[RETRY] ⚠ 429 Too Many Requests — tentativa {tentativa}/{tentativas}\n"
                    f"         Causa: o servidor limitou a taxa de requisições desta sessão/IP.\n"
                    f"         Ação : aguardando {retry_after}s (Retry-After do servidor) + jitter.\n"
                    f"         Dica : aumente CRAWLER_DELAY ou reduza CRAWLER_PROVAS_POR_CICLO."
                )
                time.sleep(retry_after + random.uniform(2, 6))
                continue

            if status == 403:
                cf_info = f" | CF-RAY: {cf_ray}" if cf_ray else " | (sem CF-RAY — bloqueio do servidor)"
                logger.warning(
                    f"[RETRY] ✗ 403 Forbidden — tentativa {tentativa}/{tentativas}{cf_info}\n"
                    "         Causas prováveis (em ordem de frequência):\n"
                    "           1. sessionid ou cf_clearance expirados — renove os cookies;\n"
                    "           2. IP temporariamente bloqueado pelo Cloudflare — aguarde;\n"
                    "           3. cloudscraper ausente ou desatualizado — pip install --upgrade cloudscraper;\n"
                    "           4. User-Agent inconsistente com os cookies — troca de perfil na próxima tentativa;\n"
                    "           5. Requisição muito rápida após login — aumente CRAWLER_DELAY.\n"
                    f"         Ação : aguardando {espera_403}s antes de retentar."
                )
                time.sleep(espera_403 + random.uniform(3, 10))
                continue

            if status == 401:
                logger.error(
                    f"[RETRY] ✗ 401 Unauthorized — tentativa {tentativa}/{tentativas}\n"
                    "         Causa: a requisição chegou sem credenciais válidas.\n"
                    "         O sessionid pode estar ausente ou inválido.\n"
                    "         Ação : não retenta — requer nova autenticação completa."
                )
                return resp  # retorna para o chamador decidir

            if status == 404:
                logger.warning(
                    f"[RETRY] ⚠ 404 Not Found — {url}\n"
                    "         Causa: a URL não existe mais ou o slug foi alterado.\n"
                    "         Ação : não retenta — pulando esta página."
                )
                return resp

            if status >= 500:
                espera = (2 ** (tentativa - 1)) * 5 + random.uniform(0, 3)
                logger.warning(
                    f"[RETRY] ✗ {status} Server Error — tentativa {tentativa}/{tentativas}\n"
                    "         Causa: erro interno do servidor (sobrecarga, deploy, banco de dados).\n"
                    f"         Ação : backoff exponencial — aguardando {espera:.1f}s."
                )
                time.sleep(espera)
                continue

            # Sucesso
            if tentativa > 1:
                logger.info(f"[RETRY] ✔ {status} obtido na tentativa {tentativa}/{tentativas} — {url}")
            return resp

        except requests.Timeout:
            espera = (2 ** (tentativa - 1)) * 5 + random.uniform(0, 3)
            logger.warning(
                f"[RETRY] ✗ Timeout — tentativa {tentativa}/{tentativas} | {url}\n"
                "         Causa: servidor não respondeu dentro do prazo configurado.\n"
                "         Possível sobrecarga momentânea ou conexão lenta.\n"
                f"         Ação : aguardando {espera:.1f}s antes de retentar."
            )
            time.sleep(espera)

        except requests.ConnectionError as e:
            espera = (2 ** (tentativa - 1)) * 5 + random.uniform(0, 3)
            logger.warning(
                f"[RETRY] ✗ Erro de conexão — tentativa {tentativa}/{tentativas}: {e}\n"
                "         Causa: falha de DNS, reset de TCP ou firewall bloqueando a saída.\n"
                f"         Ação : aguardando {espera:.1f}s antes de retentar."
            )
            time.sleep(espera)

        except requests.RequestException as e:
            espera = (2 ** (tentativa - 1)) * 5 + random.uniform(0, 3)
            logger.warning(
                f"[RETRY] ✗ Erro de requisição — tentativa {tentativa}/{tentativas}: {e}\n"
                f"         Ação : aguardando {espera:.1f}s antes de retentar."
            )
            time.sleep(espera)

    logger.error(
        f"[RETRY] ✗✗ Falha permanente após {tentativas} tentativas: {url}\n"
        "         Esta URL será ignorada. Se o problema persistir em múltiplas URLs,\n"
        "         verifique cookies, credenciais e conectividade de rede."
    )
    return None

def delay_humanizado(base: float) -> None:
    # tempo = max(3.0, random.gauss(base, base * 0.15))
    tempo = 5.0
    logger.info(f"Aguardando {tempo:.1f}s...")
    time.sleep(tempo)


def _definir_encoding_se_disponivel(resp, fallback: str = "utf-8") -> None:
    """
    Compatível com requests/cloudscraper e curl_cffi.
    - requests/cloudscraper: usa apparent_encoding quando disponível
    - curl_cffi: não tem apparent_encoding; mantém resp.encoding se existir
    """
    enc = getattr(resp, "apparent_encoding", None) or getattr(resp, "encoding", None) or fallback
    try:
        resp.encoding = enc
    except Exception:
        pass


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
    Faz login no site via formulário Django.
    Sub-etapas com validação individual:
      1. GET da página de login  — obtém HTML do formulário e cookies CSRF
      2. Extração do CSRF token  — necessário para o POST ser aceito
      3. Identificação do campo  — nome do campo de email varia por site
      4. POST das credenciais    — envia formulário e segue redirect
      5. Confirmação de sessão   — verifica sessionid nos cookies finais
    Retorna True se a sessão parecer autenticada ao final.
    """
    if not email or not senha:
        logger.warning(
            "[LOGIN] ✗ Login ignorado: email ou senha não fornecidos.\n"
            "         Defina CRAWLER_LOGIN_EMAIL e CRAWLER_LOGIN_PASSWORD ou\n"
            "         forneça cookies via CRAWLER_COOKIE_HEADER."
        )
        return False

    _URL_LOGIN_PADRAO = "https://provaderesidencia.com.br/premium/login"
    login_url = (url_login or _URL_LOGIN_PADRAO).strip() or _URL_LOGIN_PADRAO
    if not login_url.startswith("http"):
        login_url = urljoin(url_base, login_url)

    logger.info(f"[LOGIN] Iniciando login automático em: {login_url}")
    logger.info(f"[LOGIN] Credencial: {email} / {'*' * len(senha)}")

    # ── ETAPA 1: GET da página de login ───────────────────────────────────────
    logger.info("[LOGIN] Etapa 1/5: GET da página de login...")
    r_get = _requisicao_com_retry(
        sessao, "GET", login_url,
        headers=_headers_get_navegacao(perfil, referer=url_base, primeira_visita=True),
        allow_redirects=True,
    )
    if r_get is None:
        logger.error(
            "[LOGIN] ✗ Etapa 1 falhou: não foi possível acessar a página de login.\n"
            "         Verifique conectividade e se CRAWLER_LOGIN_URL está correto."
        )
        return False

    logger.info(f"[LOGIN] ✔ Etapa 1 OK — status {r_get.status_code}, URL final: {r_get.url}")
    if r_get.url != login_url:
        logger.info(
            f"[LOGIN]   ℹ Redirecionado de {login_url} para {r_get.url}\n"
            "           Isso é normal em sites Django (pode ir para /accounts/login/ etc.)."
        )

    _definir_encoding_se_disponivel(r_get)
    html = _limpar_html(r_get.text)

    # ── ETAPA 2: Localizar o formulário ──────────────────────────────────────
    logger.info("[LOGIN] Etapa 2/5: Localizando formulário de login no HTML...")
    soup = BeautifulSoup(html, "html.parser")
    form = soup.find("form", method=re.compile(r"post", re.I)) or soup.find("form")

    if not form:
        logger.error(
            "[LOGIN] ✗ Etapa 2 falhou: nenhum formulário encontrado na página.\n"
            "         Causas prováveis:\n"
            "           • A página retornada não é a de login (verifique CRAWLER_LOGIN_URL);\n"
            "           • O formulário é carregado via JavaScript (não visível no HTML estático);\n"
            "           • O Cloudflare retornou uma página de challenge em vez do login."
        )
        return False

    action = form.get("action") or ""
    if action and not action.startswith("http"):
        action = urljoin(login_url, action)
    post_url = action or login_url
    logger.info(f"[LOGIN] ✔ Etapa 2 OK — formulário encontrado, POST será enviado para: {post_url}")

    # ── ETAPA 3: Extrair CSRF token ───────────────────────────────────────────
    logger.info("[LOGIN] Etapa 3/5: Extraindo CSRF token...")
    csrf = ""
    csrf_inp = form.find("input", attrs={"name": "csrfmiddlewaretoken"})
    if csrf_inp and csrf_inp.get("value"):
        csrf = csrf_inp["value"]
    else:
        for inp in form.find_all("input", type="hidden"):
            if "csrf" in (inp.get("name") or "").lower():
                csrf = inp.get("value", "")
                break

    if csrf:
        logger.info(f"[LOGIN] ✔ Etapa 3 OK — csrfmiddlewaretoken extraído ({csrf[:12]}…)")
    else:
        logger.warning(
            "[LOGIN] ⚠ Etapa 3: CSRF token não encontrado no formulário.\n"
            "           Django normalmente exige csrfmiddlewaretoken para aceitar POSTs.\n"
            "           O POST será enviado sem ele — pode resultar em 403 CSRF Forbidden."
        )

    # ── ETAPA 4: Identificar campo de email e montar payload ─────────────────
    logger.info("[LOGIN] Etapa 4/5: Identificando campo de credencial e enviando POST...")
    email_name = None
    for name in ("email", "username", "login", "usuario"):
        if form.find("input", attrs={"name": name}):
            email_name = name
            break
    if not email_name:
        email_name = "username"
        logger.warning(
            f"[LOGIN]   ⚠ Campo de email não identificado automaticamente — "
            f"usando fallback '{email_name}'. Se o login falhar, verifique o "
            "atributo 'name' do campo de email no HTML da página."
        )
    else:
        logger.info(f"[LOGIN]   ℹ Campo de credencial detectado: '{email_name}'")

    payload = {"csrfmiddlewaretoken": csrf, email_name: email, "password": senha}

    try:
        parsed_post = urlparse(post_url)
        origin_post = f"{parsed_post.scheme}://{parsed_post.netloc}"
        r_post = _requisicao_com_retry(
            sessao, "POST", post_url,
            headers=_headers_post_formulario(perfil, post_url, origin_post),
            data=payload,
            allow_redirects=True,
        )
        if r_post is None:
            logger.error(
                "[LOGIN] ✗ Etapa 4 falhou: POST de login não obteve resposta após retentativas.\n"
                "         Verifique conectividade e se o servidor está aceitando POSTs."
            )
            return False
        logger.info(f"[LOGIN]   POST enviado → status={r_post.status_code} | URL final: {r_post.url}")
    except requests.RequestException as e:
        logger.error(f"[LOGIN] ✗ Etapa 4 — exceção no POST: {e}")
        return False

    time.sleep(random.uniform(1.5, 3.0))

    # ── ETAPA 5: Confirmar autenticação pelos cookies ─────────────────────────
    logger.info("[LOGIN] Etapa 5/5: Verificando resultado da autenticação...")
    cookies_pos_login = dict(sessao.cookies)
    tem_sessionid = "sessionid" in cookies_pos_login

    if r_post.status_code in (200, 302, 303) and tem_sessionid:
        logger.info(
            f"[LOGIN] ✔ Login bem-sucedido! sessionid presente.\n"
            f"         Cookies de sessão: {list(cookies_pos_login.keys())}"
        )
        return True

    if not tem_sessionid:
        # Tenta inferir falha de credencial pelo conteúdo da resposta
        html_pos = _limpar_html(r_post.text).lower()
        if any(p in html_pos for p in ("senha incorreta", "invalid", "incorrect", "inválido", "não encontrado")):
            logger.error(
                "[LOGIN] ✗ Login falhou: credenciais rejeitadas pelo servidor.\n"
                "         Verifique CRAWLER_LOGIN_EMAIL e CRAWLER_LOGIN_PASSWORD."
            )
        else:
            logger.warning(
                "[LOGIN] ⚠ sessionid não encontrado após POST. Possíveis causas:\n"
                "           • Credenciais incorretas;\n"
                "           • Site usa autenticação OAuth/SSO (não suportada por formulário);\n"
                "           • CSRF token inválido — tente renovar os cookies do header fixo;\n"
                "           • MFA/2FA ativo na conta — desabilite ou use cookies manuais."
            )
        return False

    logger.info(f"[LOGIN] ✔ Etapa 5 OK — autenticação concluída. Cookies: {list(cookies_pos_login.keys())}")
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
    urls_tentativa = [url_listagem]
    if ACTIVE_PROFILE in ("premium_free", "premium_paid"):
        urls_tentativa.extend([
            "https://www.provaderesidencia.com.br/premium/banco-de-provas",
            "https://www.provaderesidencia.com.br/demo/provas",
        ])

    # Remove duplicatas preservando ordem
    vistas_urls = set()
    urls_tentativa = [u for u in urls_tentativa if not (u in vistas_urls or vistas_urls.add(u))]

    for idx_tentativa, url_teste in enumerate(urls_tentativa, 1):
        logger.info(f"\n{'='*65}")
        logger.info(
            f"FASE 1 — Descoberta de provas em: {url_teste} "
            f"(tentativa {idx_tentativa}/{len(urls_tentativa)})"
        )

        resp = _requisicao_com_retry(
            sessao, "GET", url_teste,
            headers=_headers_get_navegacao(perfil, referer=url_base, primeira_visita=False),
            allow_redirects=True,
        )
        if resp is None:
            continue

        _definir_encoding_se_disponivel(resp)
        html = _limpar_html(resp.text)

        if "text/html" not in resp.headers.get("Content-Type", ""):
            logger.warning(f"Resposta da listagem não é HTML: {url_teste}")
            continue

        soup   = BeautifulSoup(html, "html.parser")
        provas = []
        vistas: set[str] = set()

        # Estratégia 1: qualquer âncora apontando para /demo/prova/<id>/<slug>
        for a in soup.find_all("a", href=True):
            url_completa = urljoin(url_base, a["href"])
            # Normaliza: remove fragmento
            url_completa = urlparse(url_completa)._replace(fragment="").geturl()

            if re.search(r"/(?:demo|premium)/prova/\d+/", url_completa) and url_completa not in vistas:
                nome = a.get_text(strip=True) or url_completa
                provas.append({"nome": nome, "url": url_completa})
                vistas.add(url_completa)
                logger.debug(f"  [descoberta] {nome} → {url_completa}")

        # Estratégia 2: se a própria URL é uma página de prova única (ex.: /premium/prova/2249/)
        if not provas and re.search(r"/(?:demo|premium)/prova/\d+/", url_teste):
            url_limpa = urlparse(url_teste)._replace(fragment="").geturl()
            provas.append({"nome": "Prova (URL única)", "url": url_limpa})
            logger.info(f"  [descoberta] URL de entrada tratada como prova única: {url_limpa}")

        # Estratégia 3: cards com classe card/prova/exam
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
        if provas:
            if url_teste != url_listagem:
                logger.warning(f"[LISTAGEM] URL fallback em uso: {url_teste}")
            return provas

    logger.warning(
        "Nenhuma prova encontrada. O site pode exigir login ou a estrutura "
        "de URL é diferente de /demo/prova/<id>/<slug>."
    )
    return []


# ─────────────────────────────────────────────────────────────────────────────
# ORDENAÇÃO POR ANO (DECRESCENTE) E CONVERSÃO PARA FILA
# ─────────────────────────────────────────────────────────────────────────────

def _extrair_ano(nome: str, url: str) -> int:
    """
    Extrai o ano de realização de uma prova a partir do nome ou da URL.

    Estratégias em ordem de prioridade:
      1. Primeiro grupo de 4 dígitos entre 1980 e ano_atual+2 encontrado no nome
      2. Mesmo padrão buscado na URL (o slug costuma conter o ano)
      3. Fallback: retorna 0 (provas sem ano identificável vão para o fim da fila)

    Exemplos reconhecidos:
      "FMUSP Residência Médica 2024"   → 2024
      "Prova UNIFESP 2023/2024"        → 2023
      "HCor 2022-2023"                 → 2022
      "Revalida INEP 2024.1"           → 2024
    """
    ano_max = date.today().year + 2
    padrao  = re.compile(r"\b((?:19[89]\d|20[0-2]\d))\b")   # 1980–2029

    for texto in (nome, url):
        m = padrao.search(texto)
        if m:
            ano = int(m.group(1))
            if 1980 <= ano <= ano_max:
                return ano
    return 0


def ordenar_provas_por_ano(provas: list[dict]) -> list[dict]:
    """
    Recebe a lista de provas no formato [{"nome": str, "url": str}, ...]
    e devolve uma nova lista ordenada de forma **decrescente** pelo ano de
    realização (provas mais recentes primeiro).

    Provas sem ano identificável são agrupadas no final, mantendo entre si
    a ordem relativa original (sort estável do Python).

    Cada dict de saída recebe o campo "ano" (int ou None).
    """
    if not provas:
        return []

    anotadas = [{**p, "ano": (_extrair_ano(p.get("nome", ""), p.get("url", "")) or None)}
                for p in provas]

    com_ano  = sorted([p for p in anotadas if p["ano"]], key=lambda p: p["ano"], reverse=True)
    sem_ano  = [p for p in anotadas if not p["ano"]]
    resultado = com_ano + sem_ano

    anos_encontrados = sorted({p["ano"] for p in com_ano}, reverse=True)
    logger.info(
        f"Provas ordenadas por ano (desc) | com ano: {len(com_ano)} | "
        f"sem ano: {len(sem_ano)} | anos: {anos_encontrados}"
    )
    return resultado


def montar_fila_provas(provas_ordenadas: list[dict]) -> deque:
    """
    Converte a lista de provas (já ordenada por ano decrescente) em uma
    deque, que funciona como fila FIFO: popleft() consome sempre a prova
    mais recente ainda não processada.
    """
    fila = deque(provas_ordenadas)
    logger.info(f"Fila de provas montada: {len(fila)} prova(s) na fila")
    return fila


# ─────────────────────────────────────────────────────────────────────────────
# EXTRAÇÃO DA QUESTÃO
# ─────────────────────────────────────────────────────────────────────────────

def _letra_da_alternativa(texto: str) -> str:
    m = re.match(r"^\s*([A-Ea-e])\s*[\)\.]\s*", texto)
    return m.group(1).upper() if m else ""


def _eh_alternativa_correta(div) -> bool:
    """
    Verifica se o div da alternativa é a correta, conforme o HTML após o POST.
    Regra do site: class="radio alert-success" = alternativa correta;
                   class="radio alert-danger"  = alternativa marcada incorreta (só aparece se errou).
    """
    classes = div.get("class") or []
    classes_str = " ".join(classes) if isinstance(classes, list) else str(classes)
    # Regra explícita: alert-success = correta
    if "alert-success" in classes_str:
        return True
    if any(x in classes_str for x in ("success", "bg-success", "text-success", "correct","radio alert-success")):
        return True
    parent = div.parent
    if parent and parent.get("class"):
        pclasses = parent.get("class") or []
        pstr = " ".join(pclasses) if isinstance(pclasses, list) else str(pclasses)
        if "alert-success" in pstr or any(x in pstr for x in ("success", "bg-success", "correct")):
            return True
    return False


def _eh_alternativa_incorreta_marcada(div) -> bool:
    """Regra do site: class=\"radio alert-danger\" = alternativa que o usuário marcou e está incorreta."""
    classes = div.get("class") or []
    classes_str = " ".join(classes) if isinstance(classes, list) else str(classes)
    return "alert-danger" in classes_str


def _variantes_texto_aviso_json(texto: Optional[str]) -> dict[str, str]:
    """
    ADIÇÃO (export JSON): variantes de capitalização do texto do aviso
    (ex.: mensagens como \"Questão Anulada\"), conforme pedido:
      - original, upper, lower, title (cada palavra), sentence (só 1ª letra da frase).
    """
    s = (texto or "").strip()
    if not s:
        return {
            "original": "",
            "upper": "",
            "lower": "",
            "title": "",
            "sentence": "",
        }
    sentence = (s[0].upper() + s[1:].lower()) if len(s) > 1 else s.upper()
    return {
        "original": s,
        "upper": s.upper(),
        "lower": s.lower(),
        "title": s.title(),
        "sentence": sentence,
    }


def extrair_questao(soup: BeautifulSoup, url: str) -> Optional[dict]:
    # Algumas páginas trazem múltiplos "col-md-6 space10-bottom"; escolhe o bloco
    # com mais alternativas/radios para evitar pegar coluna auxiliar.
    candidatos = soup.find_all("div", class_=lambda c: c and "col-md-6" in c and "space10-bottom" in c)
    col = max(candidatos, key=lambda d: len(d.find_all("div", class_=lambda x: x and "radio" in str(x))), default=None)
    if col is None:
        col = soup.find("div", class_=lambda c: c and "col-md-6" in c and "space10-bottom" in c)
    if not col:
        logger.warning(f"Estrutura de questão não encontrada em: {url}")
        return None

    h2    = col.find("h2") or soup.find("h2")
    prova = h2.get_text(strip=True) if h2 else ""

    aviso_tag = col.find("p", class_=lambda c: c and "alert-warning" in (c if isinstance(c, list) else [c]))
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

    img_tag          = col.find("img", class_=lambda c: c and "img-responsive" in (c if isinstance(c, list) else [c]))
    imagem_enunciado = urljoin(url, img_tag["src"]) if img_tag and img_tag.get("src") else None

    form = col.find("form", method=re.compile(r"post", re.I)) or col.find("form")
    csrf = ""
    hidden_inputs: dict[str, str] = {}
    form_action_abs = url
    if form:
        action = (form.get("action") or "").strip()
        form_action_abs = urljoin(url, action) if action else url
        csrf_inp = form.find("input", attrs={"name": "csrfmiddlewaretoken"})
        csrf     = csrf_inp.get("value", "") if csrf_inp else ""
        for inp in form.find_all("input", type="hidden"):
            nome = (inp.get("name") or "").strip()
            if not nome:
                continue
            hidden_inputs[nome] = inp.get("value", "")
        # Alguns formulários usam botão com name/value para confirmar o submit
        for btn in form.find_all(["button", "input"]):
            nome = (btn.get("name") or "").strip()
            if not nome:
                continue
            if nome in hidden_inputs:
                continue
            if btn.name == "input" and (btn.get("type") or "").lower() not in ("submit", "button"):
                continue
            hidden_inputs[nome] = btn.get("value", "") or "1"

    alternativas   = []
    gabarito_valor = gabarito_letra = None

    # Extração das alternativas e gabarito (após POST o HTML traz):
    #   class="radio alert-success" → alternativa CORRETA (gabarito)
    #   class="radio alert-danger"  → alternativa marcada pelo usuário quando INCORRETA
    # Sem classe extra → alternativa não marcada ou apenas "radio"
    divs_radio = col.find_all("div", class_=lambda c: c and "radio" in str(c))
    for div in divs_radio:
        inp = div.find("input", type="radio")
        lbl = div.find("label")
        if not inp or not lbl:
            continue

        valor   = inp.get("value", "")
        texto   = lbl.get_text(strip=True)
        letra   = _letra_da_alternativa(texto)
        # Regra do site: class="radio alert-success" → alternativa correta; "radio alert-danger" → marcada incorreta
        e_correta = _eh_alternativa_correta(div)
        e_marcada_incorreta = _eh_alternativa_incorreta_marcada(div)

        if e_correta:
            gabarito_valor = valor
            gabarito_letra = letra

        alternativas.append({
            "letra":                letra,
            "valor":                valor,
            "texto":                texto,
            "correta":              e_correta,
            "marcada_incorreta":    e_marcada_incorreta,
        })

    # Fallback: procurar texto "Resposta correta"/"Gabarito" na página
    if not gabarito_valor and col.get_text():
        texto_col = col.get_text()
        for m in re.finditer(r"(?:resposta\s+correta|gabarito)\s*[:\s]*([A-Ea-e])", texto_col, re.I):
            letra = m.group(1).upper()
            for alt in alternativas:
                if alt.get("letra") == letra:
                    gabarito_valor = alt.get("valor")
                    gabarito_letra = letra
                    break
            break

    inputs_radio   = col.find_all("input", type="radio")
    todos_disabled = bool(inputs_radio) and all(i.has_attr("disabled") for i in inputs_radio)
    choice_name    = inputs_radio[0].get("name", "choice") if inputs_radio else "choice"

    if aviso and "ANULADA" in aviso.upper():
        estado = "anulada"
    elif todos_disabled and gabarito_valor:
        estado = "respondida"
    elif todos_disabled:
        estado = "respondida_sem_gabarito"
    else:
        estado = "nao_respondida"

    # ADIÇÃO (export JSON): flag booleana explícita — True se a palavra \"anulada\"
    # aparecer no texto HTML da questão (bloco principal + documento). Estrutura
    # condicional solicitada (if), independente do estado textual interno acima.
    _texto_html_para_busca = (
        (col.get_text(" ", strip=True) if col else "")
        + " "
        + (soup.get_text(" ", strip=True) if soup else "")
    ).lower()
    if "anulada" in _texto_html_para_busca:
        estado_anulada = True
    else:
        estado_anulada = False

    # ADIÇÃO (export JSON): objeto aviso com variantes; foco típico \"Questão Anulada\" no alert-warning.
    aviso_json = _variantes_texto_aviso_json(aviso)

    return {
        "url":                 url,
        "prova":               prova,
        "numero":              numero,
        "enunciado":           enunciado,
        "imagem_enunciado":    imagem_enunciado,
        "aviso":               aviso,
        "estado":              estado,
        "estado_anulada":      estado_anulada,
        "aviso_json":          aviso_json,
        "alternativas":        alternativas,
        "alternativa_correta": {
            "letra": gabarito_letra,
            "valor": gabarito_valor,
        } if gabarito_valor else None,
        "_csrf":       csrf,
        "_choice_name": choice_name,
        "_post_hidden": hidden_inputs,
        "_form_action": form_action_abs,
    }


# ─────────────────────────────────────────────────────────────────────────────
# EXTRAÇÃO DE COMENTÁRIOS
# ─────────────────────────────────────────────────────────────────────────────

def _tem_classe(cls, nome: str) -> bool:
    """Verifica se a string nome está em alguma das classes do elemento."""
    if not cls:
        return False
    lista = cls if isinstance(cls, list) else [cls]
    return any(nome in str(x) for x in lista)


def extrair_comentarios(soup: BeautifulSoup) -> list[dict]:
    """
    Extrai comentários da seção "Comentários" da página de questão.
    Baseado na estrutura: h4 "Comentários", form com panel (para novo comentário),
    e panels ou media com comentários publicados (panel-heading = autor, panel-body = texto).
    """
    comentarios: list[dict] = []
    h4_comentarios = soup.find("h4", string=re.compile(r"Comentários", re.I))
    if not h4_comentarios:
        return comentarios

    # Busca a partir do pai da seção ou irmãos do h4
    secao = h4_comentarios.find_parent(["div", "section"]) or h4_comentarios.parent
    if not secao:
        return comentarios

    # Painéis que contêm comentários publicados (exclui o form de novo comentário)
    for panel in secao.find_all("div", class_=lambda c: _tem_classe(c, "panel")):
        if panel.find("form") and panel.find("textarea", attrs={"name": "comment_name"}):
            continue  # é o formulário de adicionar comentário
        heading = panel.find("div", class_=lambda c: _tem_classe(c, "panel-heading"))
        body = panel.find("div", class_=lambda c: _tem_classe(c, "panel-body"))
        if not body:
            continue
        texto = body.get_text(separator=" ", strip=True)
        if not texto or len(texto) < 3:
            continue
        autor = ""
        if heading:
            for tag in heading.find_all(["button", "input"]):
                tag.decompose()
            autor = heading.get_text(strip=True)
        comentarios.append({"autor": autor or "Anônimo", "texto": texto})

    # Alternativa: estrutura .media (Bootstrap media object)
    for media in secao.find_all("div", class_=lambda c: _tem_classe(c, "media")):
        if media.find("form") and media.find("textarea"):
            continue
        media_body = media.find("div", class_=lambda c: _tem_classe(c, "media-body"))
        media_heading = media.find(class_=lambda c: _tem_classe(c, "media-heading")) or media.find("h4") or media.find("h5")
        if not media_body:
            continue
        texto = media_body.get_text(separator=" ", strip=True)
        if not texto or len(texto) < 3:
            continue
        autor = media_heading.get_text(strip=True) if media_heading else "Anônimo"
        comentarios.append({"autor": autor or "Anônimo", "texto": texto})

    return comentarios


# ─────────────────────────────────────────────────────────────────────────────
# SIMULAÇÃO DE RESPOSTA ALEATÓRIA (POST + GET pós-resposta)
# ─────────────────────────────────────────────────────────────────────────────

def responder_e_capturar_gabarito(
    questao: dict,
    sessao,
    perfil: dict,
) -> Optional[str]:
    """
    Envia o POST com uma resposta aleatória e captura o HTML com o gabarito revelado.
    O site costuma devolver o HTML já atualizado (alert-success/alert-danger) na própria
    resposta do POST (após redirect). Usar primeiro o corpo do POST; se o gabarito não
    aparecer, faz um GET à mesma URL.
    """
    if questao["estado"] != "nao_respondida" or not questao.get("alternativas"):
        return None

    escolhida = random.choice(questao["alternativas"])
    url       = questao["url"]
    post_url  = questao.get("_form_action") or url

    # Perfil premium costuma submeter em /premium/questao/<id>/ mesmo quando a listagem veio de /demo/.
    if ACTIVE_PROFILE in ("premium_paid", "premium_free") and "/demo/questao/" in post_url:
        m = re.search(r"/demo/questao/(\d+)/", post_url)
        if m:
            post_url = f"{urlparse(post_url).scheme}://{urlparse(post_url).netloc}/premium/questao/{m.group(1)}/"

    parsed    = urlparse(post_url)
    origin    = f"{parsed.scheme}://{parsed.netloc}"

    choice_field = questao.get("_choice_name", "choice")
    payload = dict(questao.get("_post_hidden") or {})
    payload["csrfmiddlewaretoken"] = questao.get("_csrf", payload.get("csrfmiddlewaretoken", ""))
    payload[choice_field] = escolhida["valor"]

    r_post = _requisicao_com_retry(
        sessao, "POST", post_url,
        headers=_headers_post_formulario(perfil, post_url, origin),
        data=payload,
        allow_redirects=True,
    )
    if r_post is None:
        logger.warning("Erro ao enviar POST do gabarito após retentativas.")
        return None

    logger.info(f"  POST enviado → url={post_url} | escolha={escolhida['letra']} | status={r_post.status_code}")
    _definir_encoding_se_disponivel(r_post)
    html_pos_resposta = _limpar_html(r_post.text)

    # O HTML com o gabarito costuma vir na própria resposta do POST (após redirect)
    soup_pos = BeautifulSoup(html_pos_resposta, "html.parser")
    questao_pos = extrair_questao(soup_pos, post_url)
    if questao_pos and questao_pos.get("alternativa_correta"):
        logger.info(f"  Gabarito obtido da resposta do POST (página já atualizada após redirect)")
        return html_pos_resposta

    # Fallback: GET à mesma URL (caso o site só atualize na próxima leitura)
    time.sleep(random.uniform(1.5, 3.0))
    final_url = getattr(r_post, "url", "") or post_url
    r_get = _requisicao_com_retry(
        sessao, "GET", final_url,
        headers=_headers_get_navegacao(perfil, referer=post_url, primeira_visita=False),
    )
    if r_get is None:
        logger.warning("Erro no GET pós-resposta após retentativas.")
        return html_pos_resposta  # devolve pelo menos o HTML do POST

    _definir_encoding_se_disponivel(r_get)
    html_get = _limpar_html(r_get.text)
    logger.info(f"  GET pós-resposta → status={r_get.status_code}")
    return html_get


# ─────────────────────────────────────────────────────────────────────────────
# EXTRAÇÃO DE LINKS, HEADERS, IMAGENS E TEXTOS
# ─────────────────────────────────────────────────────────────────────────────

def extrair_links_questoes_tabela(soup: BeautifulSoup, url_base: str) -> list[dict]:
    """
    Extrai links de questões a partir de células de tabela (td > a).
    Prioridade: método do craw_matheus que funcionou corretamente.
    Retorna lista na ordem em que aparecem na prova.
    """
    questoes: list[tuple[int, str]] = []
    for td in soup.find_all("td"):
        a = td.find("a", href=lambda h: h and ("/premium/questao/" in h or "/demo/questao/" in h))
        if a:
            try:
                numero = int(a.get_text(strip=True))
            except ValueError:
                continue
            url = urlparse(urljoin(url_base, a["href"]))._replace(fragment="").geturl()
            questoes.append((numero, url))
    questoes.sort(key=lambda x: x[0])
    return [{"url": u, "texto": str(n), "numero": n} for n, u in questoes]


def extrair_links_questoes(soup: BeautifulSoup, url_base: str, dominio: str) -> dict:
    links_questao, links_outros = [], []
    vistos: set[str] = set()

    # Prioridade: extração por tabela (craw_matheus) — funciona melhor na prática
    links_tabela = extrair_links_questoes_tabela(soup, url_base)
    if links_tabela:
        for item in links_tabela:
            u = item["url"]
            if u not in vistos:
                vistos.add(u)
                links_questao.append({"url": u, "texto": item["texto"]})
        # links_questao já está ordenado por número; buscar outros links na página
        outros_soup = soup
    else:
        outros_soup = soup

    for a in outros_soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith("#") or href.startswith("javascript:"):
            continue
        url_limpa = urlparse(urljoin(url_base, href))._replace(fragment="").geturl()
        if url_limpa in vistos:
            continue
        vistos.add(url_limpa)
        entrada = {"url": url_limpa, "texto": a.get_text(strip=True)}
        if re.search(r"/(?:demo|premium)/questao/\d+/", url_limpa):
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
    espera_403: int = _ESPERA_403_PADRAO,
) -> Optional[dict]:
    """
    Baixa e processa uma página de questão.
    Usa _requisicao_com_retry: até 3 tentativas com backoff em 403/429/5xx.
    Retorna None se a página não puder ser obtida após todas as tentativas.
    """
    logger.info(f"Acessando: {url}")

    resp = _requisicao_com_retry(
        sessao, "GET", url,
        headers=_headers_get_navegacao(perfil, referer=referer, primeira_visita=(referer is None)),
        espera_403=espera_403,
    )
    if resp is None:
        logger.error(f"Falha permanente ao acessar: {url}")
        return None

    if resp.status_code not in range(200, 400):
        logger.warning(f"Status inesperado {resp.status_code} em: {url}")
        return None

    _definir_encoding_se_disponivel(resp)
    html_completo = _limpar_html(resp.text)

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
                questao_pos.pop("_choice_name", None)
                questao_pos.pop("_post_hidden", None)
                questao_pos.pop("_form_action", None)
                questao       = questao_pos
                html_completo = html_pos_resposta
                correta = questao.get("alternativa_correta")
                if correta:
                    logger.info(f"  Questão re-extraída após resposta → estado: {questao['estado']} | correta: {correta.get('letra', '')}")
                else:
                    logger.warning(f"  Questão re-extraída após resposta → estado: {questao['estado']} | gabarito NÃO detectado no HTML pós-POST")
            else:
                questao.pop("_csrf", None)
                questao.pop("_choice_name", None)
                questao.pop("_post_hidden", None)
                questao.pop("_form_action", None)
        else:
            questao.pop("_csrf", None)
            questao.pop("_choice_name", None)
            questao.pop("_post_hidden", None)
            questao.pop("_form_action", None)
    elif questao:
        questao.pop("_csrf", None)
        questao.pop("_choice_name", None)
        questao.pop("_post_hidden", None)
        questao.pop("_form_action", None)

    soup_final = BeautifulSoup(html_completo, "html.parser")
    comentarios = extrair_comentarios(soup_final)

    dados = {
        "url":            url,
        "titulo":         titulo,
        "dominio":        dominio,
        "timestamp":      datetime.now().isoformat(),
        "status_http":    resp.status_code,
        "questao":        questao,
        "comentarios":    comentarios,
        "headers_pagina": extrair_headers(soup_final),
        "imagens":        extrair_imagens(soup_final, url),
        "textos":         extrair_textos(soup_final),
        "links":          extrair_links_questoes(soup_final, url, dominio),
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
    # Dedupe final por prova para impedir registros repetidos no JSON consolidado.
    # Mantemos esta barreira mesmo com dedupe durante o crawl para proteger contra
    # reprocessamentos após retomadas/interrupções.
    chaves_por_prova: dict[str, set[str]] = {}

    for pagina in paginas_coletadas:
        questao = pagina.get("questao")
        if not questao:
            continue

        prova_nome = questao.get("prova") or "Prova sem nome"
        if prova_nome not in questoes_por_prova:
            questoes_por_prova[prova_nome] = []
            chaves_por_prova[prova_nome] = set()

        chave_unica = _chave_questao_unica(pagina)
        if chave_unica in chaves_por_prova[prova_nome]:
            continue
        chaves_por_prova[prova_nome].add(chave_unica)

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
            "id_questao":           _extrair_id_questao_da_url(questao.get("url") or pagina.get("url") or ""),
            "url":                  questao.get("url") or pagina.get("url") or "",
            "numero":              numero_int,
            "titulo":              questao.get("enunciado") or "",
            "imagens":             imagens,
            "alternativas":        alternativas,
            "alternativa_correta": alternativa_correta,
            # ADIÇÃO JSON: estado = bool (anulada conforme presença de \"anulada\" no HTML em extrair_questao).
            "estado":              bool(questao.get("estado_anulada", False)),
            # ADIÇÃO JSON: aviso = texto do alert-warning em várias capitalizações (original/upper/lower/title/sentence).
            "aviso":               questao.get("aviso_json")
            if isinstance(questao.get("aviso_json"), dict)
            else _variantes_texto_aviso_json(questao.get("aviso")),
            "comentarios":         pagina.get("comentarios") or [],
        })

    provas = []
    for nome in questoes_por_prova:  # mantém ordem de coleta (provas por ano decrescente)
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

        resp = _requisicao_com_retry(
            sessao, "GET", url_atual,
            headers=_headers_get_navegacao(perfil, referer=referer, primeira_visita=(referer is None)),
        )
        if resp is None:
            logger.warning(f"  Falha ao buscar índice {url_atual} — pulando.")
            continue

        _definir_encoding_se_disponivel(resp)
        html = _limpar_html(resp.text)

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
            if re.search(r"/(?:demo|premium)/prova/\d+/", link) and not re.search(r"/(?:demo|premium)/questao/", link):
                fila_index.append(link)

        referer = url_atual
        if fila_index:
            delay_humanizado(delay)

    if apenas_questoes:
        urls_questoes = [u for u in urls_questoes if re.search(r"/(?:demo|premium)/questao/\d+/", u)]

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
    # Dedupe em tempo de coleta para não inserir a mesma questão múltiplas vezes.
    chaves_questoes_coletadas: set[str] = set()
    url_anterior: Optional[str] = referer_anterior
    questoes_coletadas: int = 0
    # Nunca limitar pelo tamanho inicial da fila (evita parar em 5 questões).
    # Processar até a fila esvaziar ou atingir max_paginas; a fila cresce com links de cada questão.
    #limite_questoes: int = max_paginas
    limite_questoes: int = max_questoes

    def salvar_parcial() -> None:
        # MERGE: preserva provas/questões já gravadas em execuções anteriores no mesmo arquivo.
        provas_sessao = _paginas_para_provas(todas_paginas_coletadas + paginas_nova)
        _gravar_json_resultado_merged(arquivo_saida, provas_sessao)

    # Lista de retentativa de falhas temporárias dentro da mesma prova.
    # Objetivo: não perder progresso global por erro transitório de rede em uma questão.
    pendentes_falha: list[str] = []
    tentativas_falha: dict[str, int] = {}
    max_tentativas_falha = 3

    while fila and questoes_coletadas < limite_questoes:
        url_atual = fila.pop(0)
        if url_atual in visitados:
            continue
        visitados.add(url_atual)

        perfil_atual = random.choice(_PERFIS_CHROME)
        try:
            dados = processar_pagina(url_atual, sessao, perfil=perfil_atual, referer=url_anterior)
        except Exception as e:
            logger.warning(f"Falha temporária ao processar página {url_atual}: {e}")
            # Remove de visitados para permitir retentativa desta mesma URL.
            visitados.discard(url_atual)
            tentativas_falha[url_atual] = tentativas_falha.get(url_atual, 0) + 1
            if tentativas_falha[url_atual] < max_tentativas_falha:
                if url_atual not in pendentes_falha:
                    pendentes_falha.append(url_atual)
            else:
                # Não descartamos silenciosamente: encerramos com erro após persistir parcial.
                salvar_parcial()
                raise RuntimeError(
                    f"Questão falhou repetidamente após {max_tentativas_falha} tentativas: {url_atual}"
                ) from e
            if fila:
                delay_humanizado(delay)
            continue

        if dados:
            chave_dados = _chave_questao_unica(dados)
            if chave_dados not in chaves_questoes_coletadas:
                paginas_nova.append(dados)
                chaves_questoes_coletadas.add(chave_dados)
                salvar_parcial()
            url_anterior = url_atual

            if dados.get("questao"):
                questoes_coletadas += 1

            # Incluir na fila qualquer link de questão ainda não visitado (complementar à descoberta)
            links_info = dados.get("links") or {}
            for link_info in links_info.get("questoes", []):
                link = link_info["url"]
                if link not in visitados and link not in fila:
                    if not apenas_questoes or re.search(r"/(?:demo|premium)/questao/\d+/", link):
                        fila.append(link)

        if fila and questoes_coletadas < limite_questoes:
            delay_humanizado(delay)

    # Reprocessa pendências de falha antes de concluir a prova.
    while pendentes_falha:
        url_atual = pendentes_falha.pop(0)
        if url_atual in visitados:
            # A URL pode ter sido processada por outro caminho enquanto estava pendente.
            continue
        visitados.add(url_atual)
        perfil_atual = random.choice(_PERFIS_CHROME)
        try:
            dados = processar_pagina(url_atual, sessao, perfil=perfil_atual, referer=url_anterior)
        except Exception as e:
            tentativas_falha[url_atual] = tentativas_falha.get(url_atual, 0) + 1
            if tentativas_falha[url_atual] < max_tentativas_falha:
                pendentes_falha.append(url_atual)
                delay_humanizado(delay)
                continue
            salvar_parcial()
            raise RuntimeError(
                f"Questão permaneceu com falha após retentativas internas: {url_atual}"
            ) from e
        if dados:
            chave_dados = _chave_questao_unica(dados)
            if chave_dados not in chaves_questoes_coletadas:
                paginas_nova.append(dados)
                chaves_questoes_coletadas.add(chave_dados)
                salvar_parcial()
            if dados.get("questao"):
                questoes_coletadas += 1

    ultima_url = url_anterior or url_prova

    # Retorna à listagem simulando navegação humana entre provas
    logger.info(f"  ↩ Retornando à listagem: {url_listagem}")
    perfil_volta = random.choice(_PERFIS_CHROME)
    try:
        sessao.get(
            url_listagem,
            headers=_headers_get_navegacao(perfil_volta, referer=ultima_url, primeira_visita=False),
            timeout=15,
            **_impersonate_kw(sessao),
        )
    except requests.RequestException as e:
        logger.warning(f"Falha ao retornar à listagem: {e}")

    return paginas_nova, ultima_url


# ─────────────────────────────────────────────────────────────────────────────
# CRAWLER PRINCIPAL — orquestra as duas fases
# ─────────────────────────────────────────────────────────────────────────────

def _iniciar_sessao_autenticada(
    url_base: str,
    url_listagem: str,
    cookie_header: str,
    referer_inicial: Optional[str],
    login_email: str,
    login_password: str,
    url_login: Optional[str],
    delay: float,
) -> tuple:
    """
    Orquestra o fluxo completo de autenticação em 3 passos:
      Passo 1 — criar_sessao()  : motor HTTP + cookies iniciais
      Passo 2 — aquecer_sessao(): visita a home, obtém cf_clearance
      Passo 3 — fazer_login()   : POST das credenciais, obtém sessionid

    Registra um sumário de recursos ao final de cada passo.
    Retorna (sessao, perfil_sessao) prontos para uso no ciclo.
    """
    sep = "═" * 65
    logger.info(f"\n{sep}")
    logger.info("[AUTH] Iniciando sequência de autenticação completa")
    logger.info(sep)

    # ── Passo 1: Criar sessão ─────────────────────────────────────────────────
    logger.info("[AUTH] Passo 1/3 — Criando sessão HTTP...")
    perfil_sessao = random.choice(_PERFIS_CHROME)
    logger.info(f"[AUTH]   Perfil sorteado: {perfil_sessao['User-Agent'][:75]}")

    sessao = criar_sessao(perfil_sessao, cookie_header=cookie_header)

    # Relatório pós-criação
    diagnosticar_sessao(sessao, perfil_sessao, cookie_header_env=cookie_header, etapa="PÓS-CRIAÇÃO")

    # ── Passo 2: Aquecer sessão ───────────────────────────────────────────────
    logger.info("[AUTH] Passo 2/3 — Aquecendo sessão (warm-up)...")
    aquecer_sessao(sessao, perfil_sessao, url_base, referer_inicial)

    # Relatório pós-warm-up: foca em cookies novos adquiridos do servidor
    cookies_pos_warmup = list(sessao.cookies.keys())
    logger.info(f"[AUTH]   Cookies após warm-up: {cookies_pos_warmup or '(nenhum)'}")
    if "cf_clearance" in sessao.cookies:
        logger.info("[AUTH]   ✔ cf_clearance obtido — bypass Cloudflare ativo para esta sessão.")
    else:
        logger.warning(
            "[AUTH]   ⚠ cf_clearance não obtido no warm-up.\n"
            "            Se o site usa Cloudflare, requisições subsequentes podem receber 403.\n"
            "            Causa mais comum: cloudscraper não instalado ou challenge não resolvido."
        )

    # ── Passo 3: Login (DESATIVADO — uso apenas dos request headers) ───────────
    login_realizado = False
    # if login_email and login_password:
    #     logger.info("[AUTH] Passo 3/3 — Realizando login automático...")
    #     login_realizado = fazer_login(
    #         sessao, perfil_sessao, url_base, login_email, login_password, url_login=url_login
    #     )
    #     delay_humanizado(delay)
    # else:
    #     logger.info(...)
    logger.info(
        "[AUTH] Passo 3/3 — Login automático DESATIVADO (comentado).\n"
        "         Autenticação apenas via request headers (HEADER_REQUISICAO_FIXO / CURL_CFFI_COOKIES)."
    )

    # ── Sumário final ─────────────────────────────────────────────────────────
    cookies_finais   = dict(sessao.cookies)
    tem_sessionid    = "sessionid"    in cookies_finais
    tem_cf_clearance = "cf_clearance" in cookies_finais
    tem_csrftoken    = "csrftoken"    in cookies_finais

    logger.info(f"\n{sep}")
    logger.info("[AUTH] SUMÁRIO DA SESSÃO AUTENTICADA")
    motor_msg = "curl_cffi (firefox)" if getattr(sessao, "_curl_cffi", False) else ("cloudscraper (chrome/windows)" if _CLOUDSCRAPER_AVAILABLE else "requests puro ⚠")
    logger.info(f"[AUTH]   Motor HTTP    : {motor_msg}")
    logger.info(f"[AUTH]   Login realiz. : {'✔ sim' if login_realizado else '✗ não (cookies pré-injetados ou ausentes)'}")
    logger.info(f"[AUTH]   sessionid     : {'✔ presente' if tem_sessionid    else '✗ AUSENTE — acesso autenticado pode falhar'}")
    logger.info(f"[AUTH]   cf_clearance  : {'✔ presente' if tem_cf_clearance else '⚠ ausente — risco de 403 se site usa Cloudflare'}")
    logger.info(f"[AUTH]   csrftoken     : {'✔ presente' if tem_csrftoken    else '⚠ ausente — POSTs de formulário podem ser rejeitados'}")
    logger.info(f"[AUTH]   Total cookies : {len(cookies_finais)} — {list(cookies_finais.keys())}")

    if not tem_sessionid and not cookie_header:
        logger.error(
            "[AUTH] ✗ ATENÇÃO: sessionid ausente e nenhum cookie externo fornecido.\n"
            "         O crawl provavelmente falhará em páginas autenticadas.\n"
            "         Soluções:\n"
            "           1. Forneça credenciais válidas via CRAWLER_LOGIN_EMAIL/PASSWORD;\n"
            "           2. Copie os cookies do navegador e defina CRAWLER_COOKIE_HEADER;\n"
            "           3. Verifique se CRAWLER_LOGIN_URL aponta para a página correta."
        )
    logger.info(sep + "\n")

    return sessao, perfil_sessao


def crawl(
    url_listagem: str,
    max_provas: int = 0,
    provas_por_ciclo: int = _PROVAS_POR_CICLO_PADRAO,
    pausa_ciclo: int = _PAUSA_CICLO_PADRAO,
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
    Orquestra o crawl em ciclos sobre uma fila FIFO de provas ordenadas por ano
    decrescente (provas mais recentes primeiro).

    FASE 0 — Descoberta única:
      Acessa a listagem, extrai todos os links, ordena por ano decrescente
      e carrega numa deque (fila FIFO).

    CICLO N (repete até a fila esvaziar):
      1. Nova sessão + warm-up + login  (autenticação completa a cada ciclo)
      2. Retira até `provas_por_ciclo` provas da frente da fila (popleft)
      3. Para cada prova: descobre questões → coleta → salva resultado parcial
      4. Pausa de `pausa_ciclo` segundos (exceto após o último ciclo)
      5. Retorna ao passo 1 com o restante da fila

    Parâmetros:
      url_listagem     — URL da página de listagem de provas
      max_provas       — limite total de provas a processar (0 = todas)
      provas_por_ciclo — máximo de provas por ciclo antes da pausa (padrão: 7)
      pausa_ciclo      — segundos de pausa entre ciclos (padrão: 300)
      max_paginas      — limite de questões por prova
      delay            — delay base entre requisições (segundos)
      apenas_questoes  — filtrar só URLs /demo/questao/
      arquivo_saida    — caminho do JSON de saída
      cookie_header    — cookies de sessão
      referer_inicial  — referer personalizado para o warm-up
      login_email      — email para login automático
      login_password   — senha para login automático
      url_login        — URL da página de login
    """
    url_base = f"{urlparse(url_listagem).scheme}://{urlparse(url_listagem).netloc}"
    is_premium_profile = ACTIVE_PROFILE in ("premium_free", "premium_paid")

    # Garante diretório de saída
    saida_dir = os.path.dirname(arquivo_saida)
    if saida_dir:
        os.makedirs(saida_dir, exist_ok=True)

    # ── FASE 0: Descoberta única de todas as provas ───────────────────────────
    logger.info("=" * 65)
    logger.info("FASE 0 — Descoberta e montagem da fila de provas")

    # Sessão temporária apenas para descoberta
    sessao_disc, perfil_disc = _iniciar_sessao_autenticada(
        url_base, url_listagem, cookie_header, referer_inicial,
        login_email, login_password, url_login, delay,
    )

    provas_descobertas = descobrir_provas(url_listagem, sessao_disc, perfil_disc, url_base)

    if not provas_descobertas:
        logger.error("Nenhuma prova descoberta. Encerrando.")
        return {"provas": []}

    if is_premium_profile:
        urls_demo = [
            (p.get("url") or "")
            for p in provas_descobertas
            if "/demo/prova/" in ((p.get("url") or "").lower())
        ]
        if urls_demo:
            exemplo = urls_demo[0]
            logger.warning(
                "[VALIDAÇÃO] Perfil premium detectou URLs de prova em /demo/prova/ na descoberta inicial.\n"
                "Isto pode ocorrer por fallback de listagem ou por contexto de sessão.\n"
                f"Exemplo detectado: {exemplo}"
            )

    # Ordena por ano decrescente e aplica limite total (se definido)
    provas_ordenadas = ordenar_provas_por_ano(provas_descobertas)
    if max_provas and max_provas > 0:
        provas_ordenadas = provas_ordenadas[:max_provas]
        logger.info(f"  Limite total aplicado: {max_provas} prova(s)")

    # Carrega checkpoint para retomada sem reprocessar provas já concluídas.
    estado_checkpoint = _carregar_checkpoint(arquivo_saida)
    concluidas = {
        _normalizar_url_sem_fragmento(u)
        for u in (estado_checkpoint.get("completed_provas") or [])
        if u
    }
    if concluidas:
        logger.info(
            f"[CHECKPOINT] Provas já concluídas carregadas: {len(concluidas)}. "
            "Elas serão removidas da fila desta execução."
        )
        provas_ordenadas = [
            p for p in provas_ordenadas
            if _normalizar_url_sem_fragmento(p.get("url", "")) not in concluidas
        ]

    # Converte para fila FIFO já filtrada por checkpoint.
    fila_provas: deque = montar_fila_provas(provas_ordenadas)

    logger.info(f"\nConteúdo da fila (ordem de processamento):")
    for idx, p in enumerate(fila_provas, 1):
        ano_str = str(p.get("ano")) if p.get("ano") else "s/ano"
        logger.info(f"  [{idx:>3}] [{ano_str}] {p['nome'][:55]}")
        logger.info(f"         {p['url']}")

    # ── CICLOS ────────────────────────────────────────────────────────────────
    todas_paginas:    list[dict] = []
    numero_ciclo:     int        = 0
    total_processadas: int       = 0

    while fila_provas:
        numero_ciclo += 1

        # Retira o próximo lote da fila (FIFO — popleft)
        lote: list[dict] = []
        while fila_provas and len(lote) < provas_por_ciclo:
            lote.append(fila_provas.popleft())

        logger.info("\n" + "=" * 65)
        logger.info(
            f"CICLO {numero_ciclo} — {len(lote)} prova(s) neste ciclo | "
            f"restantes na fila: {len(fila_provas)}"
        )
        logger.info(
            f"[CICLO {numero_ciclo}] Motivo da nova autenticação: cada ciclo recria a sessão do zero\n"
            f"           para evitar expiração de sessionid/cf_clearance durante crawls longos.\n"
            f"           Cookies antigos são descartados; login e warm-up são refeitos."
        )

        # Autenticação completa a cada ciclo (nova sessão do zero)
        sessao, perfil_sessao = _iniciar_sessao_autenticada(
            url_base, url_listagem, cookie_header, referer_inicial,
            login_email, login_password, url_login, delay,
        )

        # Validação pós-auth: avisa se a sessão não parece autenticada
        if "sessionid" not in sessao.cookies and not cookie_header:
            if is_premium_profile:
                raise RuntimeError(
                    f"[CICLO {numero_ciclo}] Sessão premium sem sessionid.\n"
                    "Abortando para evitar crawl vazio/incompleto.\n"
                    "Forneça CRAWLER_COOKIE_HEADER válido ou habilite login funcional."
                )
            logger.warning(
                f"[CICLO {numero_ciclo}] ⚠ Sessão iniciada SEM sessionid.\n"
                "           As provas deste ciclo podem retornar 403 ou conteúdo\n"
                "           incompleto (sem gabarito). Verifique credenciais ou cookies."
            )
        else:
            logger.info(
                f"[CICLO {numero_ciclo}] ✔ Sessão autenticada — "
                f"cookies: {list(sessao.cookies.keys())}"
            )

        referer_atual = url_listagem

        for idx_lote, prova_info in enumerate(lote, 1):
            ano_str = str(prova_info.get("ano")) if prova_info.get("ano") else "s/ano"
            logger.info(f"\n{'─'*65}")
            logger.info(
                f"  Ciclo {numero_ciclo} | Prova {idx_lote}/{len(lote)} "
                f"(total processadas: {total_processadas + idx_lote})"
            )
            logger.info(f"  [{ano_str}] {prova_info['nome']}")
            logger.info(f"  URL: {prova_info['url']}")
            estado_checkpoint["in_progress_prova"] = prova_info["url"]
            _salvar_checkpoint(arquivo_saida, estado_checkpoint)

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
                max_questoes            = max_paginas,
            )

            todas_paginas.extend(paginas_prova)
            referer_atual = url_listagem

            questoes_prova           = sum(1 for p in paginas_prova if p.get("questao"))
            total_acumulado_questoes = sum(1 for p in todas_paginas if p.get("questao"))
            logger.info(
                f"  ✅ Prova concluída | questões nesta prova: {questoes_prova} | "
                f"total acumulado: {total_acumulado_questoes}"
            )
            # Persistência incremental de conclusão por prova:
            # permite retomar da próxima prova em caso de interrupção/falha.
            url_prova_norm = _normalizar_url_sem_fragmento(prova_info["url"])
            if url_prova_norm:
                estado_checkpoint.setdefault("completed_provas", [])
                estado_checkpoint["completed_provas"].append(url_prova_norm)
            estado_checkpoint["in_progress_prova"] = ""
            _salvar_checkpoint(arquivo_saida, estado_checkpoint)

            if idx_lote < len(lote):
                delay_humanizado(delay)

        total_processadas += len(lote)

        # Salva resultado consolidado do ciclo (funde com JSON já existente no disco).
        provas_sessao_ciclo = _paginas_para_provas(todas_paginas)
        resultado_parcial = _gravar_json_resultado_merged(arquivo_saida, provas_sessao_ciclo)

        logger.info(
            f"\n✅ Ciclo {numero_ciclo} concluído | "
            f"provas neste ciclo: {len(lote)} | "
            f"total processadas: {total_processadas} | "
            f"restantes na fila: {len(fila_provas)}"
        )

        # Pausa entre ciclos (não executa após o último ciclo)
        if fila_provas:
            logger.info(
                f"\n⏸  Pausa de {pausa_ciclo}s ({pausa_ciclo // 60} min {pausa_ciclo % 60}s) "
                f"antes do próximo ciclo..."
            )
            time.sleep(pausa_ciclo)
            logger.info("▶  Retomando crawl...")

    # ── Resultado final ───────────────────────────────────────────────────────
    provas_sessao_final = _paginas_para_provas(todas_paginas)
    resultado_final = _gravar_json_resultado_merged(arquivo_saida, provas_sessao_final)

    # Finalização limpa de checkpoint (sem prova em andamento).
    estado_checkpoint["in_progress_prova"] = ""
    _salvar_checkpoint(arquivo_saida, estado_checkpoint)

    total_questoes = sum(len(p["questoes"]) for p in resultado_final["provas"])
    logger.info(
        f"\n🏁 Crawl completo! | Ciclos: {numero_ciclo} | "
        f"Provas: {len(resultado_final['provas'])} | "
        f"Questões: {total_questoes} | Saída: {arquivo_saida}"
    )
    return resultado_final


# ─────────────────────────────────────────────────────────────────────────────
# MODO SIMPLES (craw_matheus) — fetch direto com curl_cffi, sem ciclos
# Use CRAWLER_MODO=simples para executar este fluxo
# ─────────────────────────────────────────────────────────────────────────────

DELAY_SIMPLE = 8.0  # segundos entre questões para reduzir 429 (rate limit)


def fetch_simple(url: str, referer: Optional[str] = None) -> str:
    """Faz GET com impersonação Firefox (curl_cffi). De craw_matheus."""
    if not _CURL_CFFI_AVAILABLE:
        raise RuntimeError("Modo simples exige curl_cffi. Execute: pip install curl_cffi")
    h = dict(HEADER_REQUISICAO_FIXO)
    h.pop("cookie", None)  # cookies vão no parâmetro cookies=
    if referer:
        h["referer"] = referer
    resp = _curl_requests.get(url, headers=h, cookies=CURL_CFFI_COOKIES, impersonate="firefox")
    resp.raise_for_status()
    return resp.text


def get_questao_urls_simple(html: str, base_url: str = BASE_URL_SIMPLE) -> list[tuple[int, str]]:
    """Extrai lista de (numero, url) da página da prova. Ordem natural da prova."""
    soup = BeautifulSoup(html, "html.parser")
    questoes = []
    for td in soup.find_all("td"):
        a = td.find("a", href=lambda h: h and ("/premium/questao/" in h or "/demo/questao/" in h))
        if a:
            try:
                numero = int(a.get_text(strip=True))
            except ValueError:
                continue
            url = urljoin(base_url, a["href"])
            questoes.append((numero, url))
    questoes.sort(key=lambda x: x[0])
    return questoes


def parse_questao_simple(html: str, numero: int, url: str) -> dict:
    """
    Extrai enunciado, alternativas e gabarito.
    Prioridade: extrair_questao (estrutura real do site); fallback: seletores genéricos.
    """
    soup = BeautifulSoup(_limpar_html(html), "html.parser")
    q = extrair_questao(soup, url)
    if q:
        alt_correta = q.get("alternativa_correta") or {}
        m_num = re.search(r"\d+", str(q.get("numero", numero)))
        n = int(m_num.group()) if m_num else numero
        return {
            "numero": n,
            "url": url,
            "prova": q.get("prova", ""),
            "enunciado": q.get("enunciado", ""),
            "alternativas": [{"letra": a.get("letra", ""), "descricao": a.get("texto", "")} for a in (q.get("alternativas") or [])],
            "alternativa_correta": alt_correta.get("letra") or "",
            "estado": q.get("estado", ""),
            # ADIÇÃO JSON (modo simples): espelha o export principal — bool + aviso variantes.
            "estado_anulada": bool(q.get("estado_anulada", False)),
            "aviso": q.get("aviso_json")
            if isinstance(q.get("aviso_json"), dict)
            else _variantes_texto_aviso_json(q.get("aviso")),
            "comentarios": extrair_comentarios(soup),
        }
    # Fallback genérico (craw_matheus)
    result = {"numero": numero, "url": url, "enunciado": "", "alternativas": [], "alternativa_correta": "", "comentarios": extrair_comentarios(soup)}
    enunciado_el = soup.select_one(".question-text, .enunciado, .question p")
    if enunciado_el:
        result["enunciado"] = enunciado_el.get_text(separator=" ", strip=True)
    for alt in soup.select(".alternative, .opcao, .choice"):
        result["alternativas"].append({"letra": "", "descricao": alt.get_text(separator=" ", strip=True)})
    gabarito_el = soup.select_one(".correct, .gabarito, .resposta-correta")
    if gabarito_el:
        result["alternativa_correta"] = gabarito_el.get_text(strip=True)
    return result


def main_simple(
    prova_url: Optional[str] = None,
    saida: str = "questoes.json",
    max_questoes: Optional[int] = None,
) -> None:
    """
    Fluxo simples (craw_matheus): uma prova → coleta links da tabela → questões → JSON.
    Prioridade à extração por td > a (links ordenados por número).
    """
    url = prova_url or f"{BASE_URL_SIMPLE}/demo/provas"
    print(f"[*] Buscando lista de questões: {url}")
    html_prova = fetch_simple(url)
    if "Just a moment" in html_prova:
        print("[!] Cloudflare bloqueou. Renove os cookies.")
        return
    questoes_list = get_questao_urls_simple(html_prova)
    print(f"[+] {len(questoes_list)} questões encontradas.\n")
    if max_questoes and max_questoes > 0:
        questoes_list = questoes_list[:max_questoes]
        print(f"[*] Limitando a {max_questoes} questões (mais recentes/primeiras).\n")
    resultados = []
    for numero, q_url in questoes_list:
        print(f"  -> Questão {numero:>3}: {q_url}")
        try:
            html_q = fetch_simple(q_url, referer=url)
            if "Just a moment" in html_q:
                print(f"     [!] CF bloqueou questão {numero}, pulando.")
                continue
            dados = parse_questao_simple(html_q, numero, q_url)
            resultados.append(dados)
        except Exception as e:
            print(f"     [!] Erro na questão {numero}: {e}")
        time.sleep(DELAY_SIMPLE)
    with open(saida, "w", encoding="utf-8") as f:
        json.dump(resultados, f, ensure_ascii=False, indent=2)
    print(f"\n[+] Concluído! {len(resultados)} questões salvas em {saida}")


# ─────────────────────────────────────────────────────────────────────────────
# PONTO DE ENTRADA
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    try:
        # Execução direta (sem launch.json): usa premium_paid por padrão para evitar
        # cair no fluxo demo sem cookies e gerar crawl vazio.
        PROFILE = os.environ.get("CRAWLER_PROFILE", "premium_paid").strip().lower() or "premium_paid"
        PROFILE_EFETIVO = _aplicar_profile(PROFILE)

        MODO = os.environ.get("CRAWLER_MODO", "").strip().lower()
        if MODO == "simples" or MODO == "simple":
            max_q = _cfg_int("CRAWLER_MAX_QUESTOES", 0)
            main_simple(
                prova_url=_cfg_str("CRAWLER_URL_PROVAS", f"{BASE_URL_SIMPLE}/demo/provas"),
                saida=_cfg_str("CRAWLER_SAIDA", "questoes.json"),
                max_questoes=max_q if max_q > 0 else None,
            )
            exit(0)

        URL_LISTAGEM      = _cfg_str  ("CRAWLER_URL_PROVAS",       _URL_PROVAS_PADRAO)
        MAX_PROVAS        = _cfg_int  ("CRAWLER_MAX_PROVAS",        0)
        PROVAS_POR_CICLO  = _cfg_int  ("CRAWLER_PROVAS_POR_CICLO",  _PROVAS_POR_CICLO_PADRAO)
        PAUSA_CICLO       = _cfg_int  ("CRAWLER_PAUSA_CICLO",       _PAUSA_CICLO_PADRAO)
        ESPERA_403        = _cfg_int  ("CRAWLER_ESPERA_403",        _ESPERA_403_PADRAO)
        MAX_PAGINAS       = _cfg_int  ("CRAWLER_MAX_PAGINAS",       200)
        DELAY             = _cfg_float("CRAWLER_DELAY",             5.0)
        APENAS_QUESTOES   = _cfg_bool ("CRAWLER_APENAS_QUESTOES",   True)
        ARQUIVO_SAIDA     = _cfg_str  ("CRAWLER_SAIDA",             "arthur/resultado/resultado_crawl.json")
        COOKIE_HEADER     = _cfg_str  ("CRAWLER_COOKIE_HEADER",    "")
        REFERER_INICIAL   = _cfg_str  ("CRAWLER_REFERER",           "") or None
        LOGIN_EMAIL       = _cfg_str  ("CRAWLER_LOGIN_EMAIL",       "moliveira@08242@gmail.com")
        LOGIN_PASSWORD    = _cfg_str  ("CRAWLER_LOGIN_PASSWORD",    "residenciaestudar")
        LOGIN_URL         = _cfg_str  ("CRAWLER_LOGIN_URL",         "https://www.provaderesidencia.com.br/premium/login") or None

        logger.info("─" * 65)
        logger.info("MEDMIND CRAWLER — VERSÃO 19 (DIAGNÓSTICO)")
        logger.info(f"  Perfil ativo      : {PROFILE_EFETIVO}")
        logger.info(f"  URL listagem      : {URL_LISTAGEM}")
        logger.info(f"  Max provas total  : {MAX_PROVAS or 'todas'}")
        logger.info(f"  Provas por ciclo  : {PROVAS_POR_CICLO}")
        logger.info(f"  Pausa entre ciclos: {PAUSA_CICLO}s ({PAUSA_CICLO // 60} min {PAUSA_CICLO % 60}s)")
        logger.info(f"  Espera em 403/429 : {ESPERA_403}s")
        logger.info(f"  Max questões/prova: {MAX_PAGINAS}")
        logger.info(f"  Delay base        : {DELAY}s")
        logger.info(f"  Apenas questões   : {APENAS_QUESTOES}")
        logger.info(f"  Saída             : {ARQUIVO_SAIDA}")
        logger.info(f"  cloudscraper ativo: {'sim ✓' if _CLOUDSCRAPER_AVAILABLE else 'NÃO — instale: pip install cloudscraper'}")
        logger.info(f"  Login             : {'sim' if (LOGIN_EMAIL and LOGIN_PASSWORD) else 'não'}")
        logger.info(f"  Cookies ext.      : {'sim' if COOKIE_HEADER else 'não'}")
        logger.info(f"  Referer inicial   : {REFERER_INICIAL or '(nenhum)'}")
        logger.info("─" * 65)

        # Evita execução inválida de perfil premium em listagem demo.
        if PROFILE_EFETIVO in ("premium_free", "premium_paid") and "/demo/" in URL_LISTAGEM.lower():
            logger.warning(
                "Perfil premium iniciado com URL de listagem em /demo/. "
                "Fallback automático de listagem está habilitado."
            )

        # Mostra explicitamente os cookies que serão usados antes de qualquer captura
        # 1) Cookies do header fixo (HEADER_REQUISICAO_FIXO)
        cookie_header_fixo = HEADER_REQUISICAO_FIXO.get("cookie", "")
        print("\n" + "=" * 65)
        print("COOKIES DO HEADER FIXO (HEADER_REQUISICAO_FIXO)")
        print("=" * 65)
        print(cookie_header_fixo or "(nenhum cookie definido em HEADER_REQUISICAO_FIXO)")
        print("=" * 65 + "\n")

        # 2) Cookies da variável de ambiente CRAWLER_COOKIE_HEADER (se houver)
        print("=" * 65)
        print("COOKIES DE CRAWLER_COOKIE_HEADER (variável de ambiente)")
        print("=" * 65)
        print(COOKIE_HEADER or "(nenhum cookie em CRAWLER_COOKIE_HEADER)")
        print("=" * 65 + "\n")

        resultado = crawl(
            url_listagem     = URL_LISTAGEM,
            max_provas       = MAX_PROVAS,
            provas_por_ciclo = PROVAS_POR_CICLO,
            pausa_ciclo      = PAUSA_CICLO,
            max_paginas      = MAX_PAGINAS,
            delay            = DELAY,
            apenas_questoes  = APENAS_QUESTOES,
            arquivo_saida    = ARQUIVO_SAIDA,
            cookie_header    = COOKIE_HEADER,
            referer_inicial  = REFERER_INICIAL,
            login_email      = LOGIN_EMAIL,
            login_password   = LOGIN_PASSWORD,
            url_login        = LOGIN_URL,
        )

        # ── Resumo final ──────────────────────────────────────────────────────
        print("\n" + "=" * 65)
        print("RESUMO DO CRAWL")
        print("=" * 65)
        provas         = resultado["provas"]
        total_questoes = sum(len(p["questoes"]) for p in provas)
        print(f"Provas processadas: {len(provas)}")
        print(f"Total de questões : {total_questoes}")

        for prova in provas:
            print(f"\n  - {prova['nome']} ({len(prova['questoes'])} questões)")
            for q in prova["questoes"]:
                correta = f" -> correta: {q['alternativa_correta']}" if q.get("alternativa_correta") else ""
                print(f"    Questão {q['numero']}: {(q['titulo'] or '')[:60]}...{correta}")

        print(f"\nDados salvos em: {ARQUIVO_SAIDA}")
    except Exception as e:
        logger.exception("Erro fatal no crawler:")
        notificar_erro_por_email(str(e))
        raise