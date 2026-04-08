#!/usr/bin/env python3
"""
fix_crawler_json.py — Repara e divide arquivos JSON gerados pelo crawler web.

Problemas tratados:
  1. Encoding Latin-1/Windows-1252 (em vez de UTF-8)
  2. Caracteres de controle ilegais na spec JSON (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F)
  3. Aspas não-escapadas dentro de valores string
  4. Newlines/carriage-returns literais dentro de strings

Uso:
  python3 scripts/fix_crawler_json.py resultado_crawl.json
  python3 scripts/fix_crawler_json.py resultado_crawl.json --saida resultado_clean.json
  python3 scripts/fix_crawler_json.py resultado_crawl.json --lote 10

Por padrão, após reparar o arquivo, divide as provas em lotes de 5 e salva
em uma pasta <nome>_lotes/ para facilitar a importação gradual.
"""

import sys
import json
import re
import os
import argparse
import math


def detectar_e_decodificar(raw: bytes) -> str:
    """Tenta UTF-8, UTF-8 com BOM, depois Windows-1252 (latin-1 superset)."""
    for enc in ('utf-8-sig', 'utf-8', 'windows-1252', 'latin-1'):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode('latin-1', errors='replace')


def sanitizar_controle(text: str) -> str:
    """Remove caracteres de controle ilegais na spec JSON, preservando \\t, \\n, \\r."""
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', ' ', text)


def reparar_aspas_nao_escapadas(text: str) -> str:
    """
    Percorre o texto JSON caractere a caractere.
    Dentro de uma string JSON, aspas não precedidas de \\ e não seguidas de
    um delimitador estrutural JSON são escapadas.

    Delimitadores que indicam fechamento legítimo de string:
      :  ,  }  ]  "  (início da próx. chave/valor)  EOF
    Qualquer outra coisa (letra, dígito) indica aspas interna não-escapada.
    """
    result = []
    i = 0
    n = len(text)
    in_string = False

    while i < n:
        c = text[i]

        if in_string:
            if c == '\\' and i + 1 < n:
                result.append(c)
                result.append(text[i + 1])
                i += 2
                continue
            elif c == '"':
                j = i + 1
                while j < n and text[j] in ' \t\r\n':
                    j += 1
                next_c = text[j] if j < n else ''
                if next_c in (':', ',', '}', ']', '"', ''):
                    result.append('"')
                    in_string = False
                else:
                    result.append('\\"')
            elif c == '\n':
                result.append('\\n')
            elif c == '\r':
                result.append('\\r')
            elif c == '\t':
                result.append('\\t')
            else:
                result.append(c)
        else:
            if c == '"':
                in_string = True
                result.append(c)
            else:
                result.append(c)
        i += 1

    return ''.join(result)


def salvar_lotes(provas: list, pasta_lotes: str, tamanho_lote: int) -> None:
    """Divide a lista de provas em lotes e salva cada um como um JSON separado."""
    os.makedirs(pasta_lotes, exist_ok=True)
    total = len(provas)
    n_lotes = math.ceil(total / tamanho_lote)
    digits = len(str(n_lotes))

    print(f"\nDividindo {total} provas em lotes de {tamanho_lote} → {n_lotes} arquivos")
    print(f"Pasta de saída: {pasta_lotes}/")
    print()

    for i in range(n_lotes):
        inicio = i * tamanho_lote
        fim = min(inicio + tamanho_lote, total)
        lote = provas[inicio:fim]
        n_questoes = sum(len(p.get('questoes', [])) for p in lote)

        numero = str(i + 1).zfill(digits)
        nome_arquivo = f"lote_{numero}.json"
        caminho = os.path.join(pasta_lotes, nome_arquivo)

        with open(caminho, 'w', encoding='utf-8') as f:
            json.dump({"provas": lote}, f, ensure_ascii=False, indent=2)

        nomes = [p.get('nome', '?') for p in lote]
        resumo = nomes[0] if len(nomes) == 1 else f"{nomes[0]}  …  {nomes[-1]}"
        print(f"  [{numero}/{n_lotes}] {nome_arquivo}  —  {len(lote)} provas, {n_questoes} questões")
        print(f"          {resumo}")

    print(f"\nPronto! Importe cada lote pelo painel de Provas na Íntegra.")
    print(f"Dica: comece pelo lote_{'1'.zfill(digits)}.json e avance sequencialmente.")


def reparar_arquivo(caminho_entrada: str, caminho_saida: str, tamanho_lote: int) -> None:
    print(f"Lendo: {caminho_entrada} ({os.path.getsize(caminho_entrada):,} bytes)")

    with open(caminho_entrada, 'rb') as f:
        raw = f.read()

    print("Decodificando...")
    text = detectar_e_decodificar(raw)
    print(f"  {len(text):,} caracteres")

    print("Sanitizando caracteres de controle...")
    text = sanitizar_controle(text)

    print("Verificando JSON...")
    try:
        data = json.loads(text)
        print("  JSON válido — sem necessidade de reparo de aspas")
    except json.JSONDecodeError as e:
        print(f"  JSON inválido ({e.msg} em char {e.pos}) — reparando aspas...")
        text = reparar_aspas_nao_escapadas(text)
        try:
            data = json.loads(text)
            print("  Reparo bem-sucedido!")
        except json.JSONDecodeError as e2:
            print(f"ERRO: Não foi possível reparar o JSON: {e2}")
            print("Dica: abra o arquivo em um editor de texto e procure por aspas não-escapadas.")
            sys.exit(1)

    provas = data.get('provas', [])
    total_q = sum(len(p.get('questoes', [])) for p in provas)
    print(f"  {len(provas)} provas, {total_q} questões no total")

    # Salva arquivo completo limpo
    pasta_saida = os.path.dirname(caminho_saida)
    if pasta_saida:
        os.makedirs(pasta_saida, exist_ok=True)

    print(f"\nSalvando arquivo completo limpo: {caminho_saida}")
    with open(caminho_saida, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # Divide em lotes
    base_sem_ext = os.path.splitext(caminho_saida)[0]
    pasta_lotes = f"{base_sem_ext}_lotes"
    salvar_lotes(provas, pasta_lotes, tamanho_lote)


def main():
    parser = argparse.ArgumentParser(
        description="Repara e divide em lotes arquivos JSON do crawler web",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemplos:
  python3 scripts/fix_crawler_json.py resultado_crawl.json
  python3 scripts/fix_crawler_json.py resultado_crawl.json --lote 10
  python3 scripts/fix_crawler_json.py resultado_crawl.json --saida saida/limpo.json --lote 5
        """,
    )
    parser.add_argument("arquivo", help="Arquivo JSON do crawler a ser reparado")
    parser.add_argument("--saida", "-o", help="Arquivo completo de saída (padrão: <nome>_clean.json)")
    parser.add_argument("--lote", "-l", type=int, default=5,
                        help="Quantidade de provas por lote (padrão: 5)")
    args = parser.parse_args()

    caminho = args.arquivo
    if not os.path.exists(caminho):
        print(f"Arquivo não encontrado: {caminho}")
        sys.exit(1)

    if args.saida:
        saida = args.saida
    else:
        base, ext = os.path.splitext(caminho)
        saida = f"{base}_clean{ext}"

    reparar_arquivo(caminho, saida, args.lote)


if __name__ == '__main__':
    main()
