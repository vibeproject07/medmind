#!/usr/bin/env python3
"""
Gerador de comentários explicativos para questões de provas.

Uso:
    python3 scripts/gerar_comentarios.py <arquivo_entrada.json> [opções]

Exemplos:
    python3 scripts/gerar_comentarios.py provas.json
    python3 scripts/gerar_comentarios.py provas.json --output-dir ./saida
    python3 scripts/gerar_comentarios.py provas.json --delay 1.0 --modelo claude-3-5-haiku-20241022

O arquivo de entrada deve ter o formato retornado pela API /api/provas:
    {
        "provas": [
            {
                "id": 1,
                "nome": "SES-MG-2023-Clinica",
                "banca": "SES",
                "regiao": "MG",
                "ano": "2023",
                "questions": [
                    {
                        "id": 101,
                        "statement": "Enunciado da questão...",
                        "option_a": "Texto da alternativa A",
                        "option_b": "Texto da alternativa B",
                        "option_c": "Texto da alternativa C",
                        "option_d": "Texto da alternativa D",
                        "option_e": "Texto da alternativa E",
                        "correct_answer": "C"
                    }
                ]
            }
        ]
    }

Gera dois arquivos de saída:
    - comentarios_<timestamp>.json  →  { "comentarios": [ { "prova_id", "nome", "questoes": [...] } ] }
    - comentarios_<timestamp>.csv   →  colunas: prova_id, questao_id, comentario

A chave ANTHROPIC_API_KEY é lida de:
    1. Variável de ambiente ANTHROPIC_API_KEY
    2. Arquivo .env.local na raiz do projeto
"""

import json
import csv
import os
import sys
import time
import argparse
import re
from datetime import datetime

try:
    import requests
except ImportError:
    print("Instalando dependência 'requests'...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests"])
    import requests


# ---------------------------------------------------------------------------
# Groq (comentado — substituído por Claude)
# ---------------------------------------------------------------------------
# GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
# MODELO_PADRAO = "llama-3.3-70b-versatile"
# ---------------------------------------------------------------------------

CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
MODELO_PADRAO = "claude-opus-4-5"
MAX_TENTATIVAS = 3


def carregar_api_key() -> str:
    # ---------------------------------------------------------------------------
    # Groq (comentado — substituído por Claude)
    # key = os.environ.get("GROQ_API_KEY", "").strip()
    # if key:
    #     return key
    # raiz = os.path.join(os.path.dirname(__file__), "..")
    # for nome_env in [".env.local", ".env"]:
    #     caminho = os.path.normpath(os.path.join(raiz, nome_env))
    #     if os.path.exists(caminho):
    #         with open(caminho, encoding="utf-8") as f:
    #             for linha in f:
    #                 linha = linha.strip()
    #                 if linha.startswith("GROQ_API_KEY="):
    #                     key = linha.split("=", 1)[1].strip().strip('"').strip("'")
    #                     if key:
    #                         return key
    # ---------------------------------------------------------------------------

    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if key:
        return key

    raiz = os.path.join(os.path.dirname(__file__), "..")
    for nome_env in [".env.local", ".env"]:
        caminho = os.path.normpath(os.path.join(raiz, nome_env))
        if os.path.exists(caminho):
            with open(caminho, encoding="utf-8") as f:
                for linha in f:
                    linha = linha.strip()
                    if linha.startswith("ANTHROPIC_API_KEY="):
                        key = linha.split("=", 1)[1].strip().strip('"').strip("'")
                        if key:
                            return key
    return ""


def montar_prompt(questao: dict, contexto_prova: dict | None = None) -> str:
    letras = ["A", "B", "C", "D", "E"]
    gabarito = (questao.get("correct_answer") or "A").upper().strip()[0]
    numero_questao = questao.get("id", "?")

    alternativas_linhas = []
    for letra in letras:
        valor = questao.get(f"option_{letra.lower()}", "")
        if not valor:
            continue
        marcador = " ← GABARITO" if letra == gabarito else ""
        alternativas_linhas.append(f"  {letra}) {valor}{marcador}")

    bloco_alternativas = "\n".join(alternativas_linhas)

    ctx = contexto_prova or {}
    banca = ctx.get("banca") or ctx.get("nome") or "não informada"
    ano   = ctx.get("ano") or "não informado"
    tipo  = ctx.get("tipo") or ""

    tem_imagem = questao.get("tem_imagem", False) or bool(questao.get("images"))
    aviso_imagem = "\n⚠️ QUESTÃO COM IMAGEM — considere isso na análise." if tem_imagem else ""

    return f"""════════════════════════════════════════════════════════════════
IDENTIDADE E MISSÃO
════════════════════════════════════════════════════════════════
Você é um especialista em medicina clínica e em provas de residência médica brasileira.
Sua missão é analisar questões de concursos de residência médica e produzir comentários
didáticos, tecnicamente precisos e atualizados, semelhantes aos dos melhores cursinhos
(Medcurso, Medcel, MedSoft, SIC).

════════════════════════════════════════════════════════════════
FLUXO DE TRABALHO — execute internamente nesta ordem antes de escrever o comentário
════════════════════════════════════════════════════════════════

ETAPA 1 — TRIAGEM DA QUESTÃO
Identifique internamente:
- Tema principal e subtema
- Banca: {banca} | Ano: {ano} | Tipo: {tipo}
- Especialidade médica a que pertence
- Se há referência a imagem, ECG, lâmina, dermatoscopia etc.{aviso_imagem}

ETAPA 2 — MAPEAMENTO DE REFERÊNCIAS
Com base na banca e no tema, identifique qual(is) diretriz(es) essa banca costuma adotar.
Use a tabela abaixo como guia primário. Se o tema não estiver coberto, use a diretriz
brasileira mais recente da sociedade médica da especialidade correspondente.
Priorize: (1) sociedade médica brasileira, (2) consensos nacionais, (3) diretrizes
internacionais quando não houver equivalente nacional.

TABELA DE REFERÊNCIAS POR TEMA:
• HAS → 8ª Diretriz Brasileira de HAS (SBC, 2025) — alto risco de desatualização
• Diabetes mellitus → Diretriz SBD (edição mais recente) + ADA Standards of Care
• Sepse → Surviving Sepsis Campaign 2021 + Hour-1 Bundle (abandonou EGDT/ScvO2)
• IC com FE reduzida → Diretriz SBC (mais recente); incluir SGLT2 e sacubitril/valsartana
• FA / Anticoagulação → Diretriz SBC + ESC; priorizar NOACs sobre warfarina
• DPOC → GOLD (edição mais recente)
• Rastreio oncológico → MS/INCA como padrão; atenção a bancas acadêmicas (FMUSP,
  UNICAMP) que podem adotar ACG ou USPSTF (ex: CA cólon: MS=50 anos; USPSTF=45 anos)
• HIV/TARV → PCDT do Ministério da Saúde (edição vigente)
• Calendário vacinal → PNI / SBIm (ano mais recente)
• Outros temas → diretriz da sociedade da especialidade correspondente

ETAPA 3 — VERIFICAÇÃO DE ATUALIDADE
Compare o conteúdo da questão com a diretriz identificada. Classifique como:
  ✅ ATUALIZADA — gabarito alinhado com diretrizes vigentes
  ⚠️ ATENÇÃO — algum aspecto pode ter sido revisado recentemente
  ❌ DESATUALIZADA — gabarito ou conduta contradiz diretriz atual

Temas com checagem obrigatória de atualidade:
Metas de PA, terapias-alvo em sepse, rastreios oncológicos, calendário vacinal,
TARV para HIV, anticoagulação em FA, IC com FE reduzida, classificação da DPOC.

ETAPA 4 — ELABORAÇÃO DO COMENTÁRIO
Produza o comentário no formato abaixo. Não exiba o raciocínio das etapas 1-3 —
apenas o comentário final formatado.

════════════════════════════════════════════════════════════════
DADOS DA QUESTÃO
════════════════════════════════════════════════════════════════
Número: {numero_questao}
Banca: {banca} | Ano: {ano}

ENUNCIADO:
{questao.get("statement", "(sem enunciado)")}

ALTERNATIVAS:
{bloco_alternativas}
════════════════════════════════════════════════════════════════

REGRAS DE COMPORTAMENTO:
- Nunca invente referências. Se não tiver certeza de uma diretriz, sinalize no comentário.
- Comente TODAS as alternativas, inclusive as claramente erradas.
- Diferencie "errado na prova" de "errado na prática clínica atual".
- Nível de linguagem: acessível ao interno de medicina, sem ser superficial.
- Extensão: questões simples → comentários objetivos; questões complexas/controversas → mais extensos.
- Quando o tema for controverso entre bancas, explicite as duas posições.
- A seção 💡 DICA DE PROVA só deve aparecer se existir mnemônico ou macete real e conhecido
  no meio médico (ex: SNOOP para cefaleia). Não invente dicas.
- A seção 🔄 ATUALIZAÇÃO IMPORTANTE só aparece se o status for ⚠️ ou ❌.

FORMATO OBRIGATÓRIO DO COMENTÁRIO:

📋 QUESTÃO {numero_questao} — [TEMA PRINCIPAL]

🏥 Banca: {banca} | Ano: {ano} | Especialidade: [especialidade]
[⚠️ QUESTÃO COM IMAGEM — apenas se aplicável]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 GABARITO: Alternativa {gabarito}
[✅ ATUALIZADA | ⚠️ ATENÇÃO — POSSÍVEL DESATUALIZAÇÃO | ❌ DESATUALIZADA]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 COMENTÁRIO GERAL
[Contextualização do tema. Raciocínio clínico central. Mecanismo fisiopatológico ou conceito cobrado. Dados epidemiológicos relevantes quando úteis.]

🔍 ANÁLISE DAS ALTERNATIVAS

✅ Alternativa {gabarito} — CORRETA
[Por que está correta. Conecte com a diretriz de referência.]

❌ Alternativa [letra] — INCORRETA
[Erro conceitual ou clínico. Em que contexto diferente seria correta.]

[Repita para TODAS as alternativas incorretas]

💡 DICA DE PROVA  ← OMITIR se não houver macete/mnemônico real
[Conceito-chave. Mnemônicos ou associações úteis apenas se já existem no meio médico.]

🔄 ATUALIZAÇÃO IMPORTANTE  ← OMITIR se status = ✅ ATUALIZADA
[O que mudou nas diretrizes e qual seria a conduta/gabarito pelo padrão atual.]"""


def chamar_api(questao: dict, api_key: str, modelo: str, delay: float,
               contexto_prova: dict | None = None) -> str:
    prompt = montar_prompt(questao, contexto_prova)

    # -----------------------------------------------------------------------
    # Groq (comentado — substituído por Claude)
    # -----------------------------------------------------------------------
    # headers_groq = {
    #     "Authorization": f"Bearer {api_key}",
    #     "Content-Type": "application/json",
    # }
    # payload_groq = {
    #     "model": modelo,
    #     "messages": [{"role": "user", "content": prompt}],
    #     "temperature": 0.2,
    #     "max_tokens": 1200,
    # }
    # resp = requests.post(GROQ_API_URL, headers=headers_groq, json=payload_groq, timeout=90)
    # conteudo = resp.json()["choices"][0]["message"]["content"].strip()
    # -----------------------------------------------------------------------

    headers = {
        "x-api-key": api_key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }
    payload = {
        "model": modelo,
        "max_tokens": 2000,
        "temperature": 0.2,
        "messages": [{"role": "user", "content": prompt}],
    }

    for tentativa in range(1, MAX_TENTATIVAS + 1):
        try:
            resp = requests.post(CLAUDE_API_URL, headers=headers, json=payload, timeout=120)

            if resp.status_code == 429:
                retry_after = int(resp.headers.get("retry-after", 30))
                espera = max(retry_after, 30)
                print(f"\n    ⏳ Rate limit. Aguardando {espera}s...", end="", flush=True)
                time.sleep(espera)
                continue

            if resp.status_code == 529:
                espera = 60
                print(f"\n    ⏳ API sobrecarregada. Aguardando {espera}s...", end="", flush=True)
                time.sleep(espera)
                continue

            resp.raise_for_status()

            data = resp.json()
            conteudo = data["content"][0]["text"].strip()
            time.sleep(delay)
            return conteudo

        except requests.exceptions.HTTPError as e:
            if tentativa < MAX_TENTATIVAS:
                print(f"\n    ⚠ Tentativa {tentativa} falhou ({e}). Retentando...", end="", flush=True)
                time.sleep(5 * tentativa)
            else:
                raise RuntimeError(f"HTTP {resp.status_code}: {e}") from e

        except requests.exceptions.Timeout:
            if tentativa < MAX_TENTATIVAS:
                print(f"\n    ⏰ Timeout na tentativa {tentativa}. Retentando...", end="", flush=True)
                time.sleep(5)
            else:
                raise RuntimeError("Timeout após várias tentativas")

        except Exception as e:
            raise RuntimeError(f"Erro inesperado: {e}") from e

    raise RuntimeError("Todas as tentativas falharam")


def salvar_saida(resultados_json: list, resultados_csv: list, caminho_json: str, caminho_csv: str):
    with open(caminho_json, "w", encoding="utf-8") as f:
        json.dump({"comentarios": resultados_json}, f, ensure_ascii=False, indent=2)

    with open(caminho_csv, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["prova_id", "questao_id", "comentario"],
            quoting=csv.QUOTE_ALL,
        )
        writer.writeheader()
        writer.writerows(resultados_csv)


def normalizar_formato(dados: dict, limite_questoes: int | None = None) -> list:
    """
    Aceita dois formatos de entrada e retorna sempre uma lista de provas
    no formato interno do script.

    Formato 1 — padrão do script / API /api/provas:
        { "provas": [ { "id", "nome", "questions": [...] } ] }

    Formato 2 — saída do pipeline de extração de PDF:
        { "titulo_prova": { "banca", "ano", "tipo" }, "questoes": [ { "numero",
          "enunciado", "alternativas": [{"letra","texto"}], "letra_correta" } ] }
    """
    if "provas" in dados and isinstance(dados["provas"], list):
        return dados["provas"]

    if "questoes" in dados and isinstance(dados["questoes"], list):
        titulo = dados.get("titulo_prova", {})
        banca = titulo.get("banca", "")
        ano = titulo.get("ano", "")
        tipo = titulo.get("tipo", "")
        nome = f"{banca} {ano}".strip() or "Prova sem nome"

        questoes_raw = dados["questoes"]
        if limite_questoes:
            questoes_raw = questoes_raw[:limite_questoes]

        questions = []
        for q in questoes_raw:
            alts: dict[str, str] = {}
            for alt in q.get("alternativas", []):
                letra = str(alt.get("letra", "")).upper().strip()
                texto = str(alt.get("texto", "")).strip()
                if letra in ("A", "B", "C", "D", "E"):
                    alts[letra] = texto

            questions.append({
                "id": q.get("numero"),
                "statement": str(q.get("enunciado", "")).strip(),
                "option_a": alts.get("A", ""),
                "option_b": alts.get("B", ""),
                "option_c": alts.get("C") or None,
                "option_d": alts.get("D") or None,
                "option_e": alts.get("E") or None,
                "correct_answer": str(q.get("letra_correta", "A")).upper().strip(),
            })

        return [{"id": 1, "nome": nome, "banca": banca, "ano": ano, "tipo": tipo, "questions": questions}]

    return []


def main():
    parser = argparse.ArgumentParser(
        description="Gera comentários explicativos para questões de provas usando IA.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("input", help="Arquivo JSON de entrada com as provas e questões")
    parser.add_argument(
        "--output-dir",
        default=".",
        metavar="DIR",
        help="Diretório de saída (padrão: diretório atual)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.3,
        metavar="SEG",
        help="Delay em segundos entre chamadas da API (padrão: 0.3)",
    )
    parser.add_argument(
        "--modelo",
        default=MODELO_PADRAO,
        metavar="MODELO",
        help=f"Modelo Claude a usar (padrão: {MODELO_PADRAO}). Ex: claude-3-5-haiku-20241022",
    )
    parser.add_argument(
        "--apenas-prova",
        type=int,
        default=None,
        metavar="ID",
        help="Processar apenas a prova com este ID (útil para testes)",
    )
    parser.add_argument(
        "--limite-questoes",
        type=int,
        default=None,
        metavar="N",
        help="Limitar a N questões por prova (útil para testes rápidos)",
    )
    args = parser.parse_args()

    api_key = carregar_api_key()
    if not api_key:
        print(
            "\nERRO: ANTHROPIC_API_KEY não encontrada.\n"
            "Defina a variável de ambiente ou adicione ao arquivo .env.local:\n"
            "  ANTHROPIC_API_KEY=sk-ant-...\n"
        )
        sys.exit(1)

    if not os.path.exists(args.input):
        print(f"\nERRO: Arquivo '{args.input}' não encontrado.\n")
        sys.exit(1)

    with open(args.input, encoding="utf-8") as f:
        try:
            dados = json.load(f)
        except json.JSONDecodeError as e:
            print(f"\nERRO: O arquivo não é um JSON válido: {e}\n")
            sys.exit(1)

    provas = normalizar_formato(dados, limite_questoes=args.limite_questoes)
    if not provas:
        print(
            "\nERRO: Formato não reconhecido. O JSON deve conter:\n"
            "  - Um array 'provas' (formato padrão), ou\n"
            "  - Um array 'questoes' com 'titulo_prova' (formato de extração de PDF).\n"
        )
        sys.exit(1)

    if args.apenas_prova is not None:
        provas = [p for p in provas if p.get("id") == args.apenas_prova]
        if not provas:
            print(f"\nERRO: Nenhuma prova encontrada com id={args.apenas_prova}.\n")
            sys.exit(1)

    if args.limite_questoes and "provas" in dados:
        for p in provas:
            p["questions"] = p.get("questions", [])[:args.limite_questoes]

    os.makedirs(args.output_dir, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    caminho_json = os.path.join(args.output_dir, f"comentarios_{timestamp}.json")
    caminho_csv = os.path.join(args.output_dir, f"comentarios_{timestamp}.csv")

    total_questoes = sum(len(p.get("questions", [])) for p in provas)
    total_provas = len(provas)

    print(f"\n{'═'*60}")
    print(f"  Gerador de Comentários — MedMind")
    print(f"{'═'*60}")
    print(f"  Provas:    {total_provas}")
    print(f"  Questões:  {total_questoes}")
    print(f"  Modelo:    {args.modelo}")
    print(f"  Saída:     {args.output_dir}")
    print(f"{'═'*60}\n")

    resultados_json: list = []
    resultados_csv: list = []
    processadas = 0
    falhas = 0

    inicio = time.time()

    for idx_prova, prova in enumerate(provas, 1):
        prova_id = prova.get("id")
        prova_nome = prova.get("nome", f"Prova {prova_id}")
        questoes = prova.get("questions", [])

        contexto_prova = {
            "banca": prova.get("banca") or prova_nome,
            "ano":   prova.get("ano") or "",
            "tipo":  prova.get("tipo") or "",
            "nome":  prova_nome,
        }

        if not questoes:
            print(f"[{idx_prova}/{total_provas}] {prova_nome} — sem questões, pulando.\n")
            continue

        print(f"[{idx_prova}/{total_provas}] {prova_nome} ({len(questoes)} questão/ões)")

        entrada_prova = {
            "prova_id": prova_id,
            "nome": prova_nome,
            "questoes": [],
        }

        for questao in questoes:
            questao_id = questao.get("id")
            processadas += 1
            progresso = f"{processadas}/{total_questoes}"

            print(f"  [{progresso}] ID {questao_id} ...", end=" ", flush=True)

            try:
                comentario = chamar_api(questao, api_key, args.modelo, args.delay, contexto_prova)
                print("✓")
            except RuntimeError as e:
                comentario = f"[ERRO AO GERAR COMENTÁRIO: {e}]"
                falhas += 1
                print(f"✗  ({e})")

            entrada_prova["questoes"].append({
                "questao_id": questao_id,
                "comentario": comentario,
            })
            resultados_csv.append({
                "prova_id": prova_id,
                "questao_id": questao_id,
                "comentario": comentario,
            })

        resultados_json.append(entrada_prova)

        salvar_saida(resultados_json, resultados_csv, caminho_json, caminho_csv)
        print(f"  → Progresso salvo após {prova_nome}\n")

    duracao = time.time() - inicio
    minutos, segundos = divmod(int(duracao), 60)

    print(f"{'═'*60}")
    print(f"  Concluído em {minutos}m {segundos}s")
    print(f"  Questões processadas: {processadas - falhas}/{total_questoes}")
    if falhas:
        print(f"  Falhas: {falhas}")
    print(f"  JSON → {caminho_json}")
    print(f"  CSV  → {caminho_csv}")
    print(f"{'═'*60}\n")


if __name__ == "__main__":
    main()
