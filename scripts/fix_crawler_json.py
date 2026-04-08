#!/usr/bin/env python3
"""
fix_crawler_json.py — Repara arquivos JSON gerados pelo crawler web.

Problemas tratados:
  1. Encoding Latin-1/Windows-1252 (em vez de UTF-8)
  2. Caracteres de controle ilegais na spec JSON (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F)
  3. Aspas não-escapadas dentro de valores string

Uso:
  python3 scripts/fix_crawler_json.py resultado_crawl.json
  python3 scripts/fix_crawler_json.py resultado_crawl.json --saida resultado_clean.json
"""

import sys
import json
import re
import os
import argparse


def detectar_e_decodificar(raw: bytes) -> str:
    """Tenta UTF-8, UTF-8 com BOM, depois Windows-1252 (latin-1 superset)."""
    for enc in ('utf-8-sig', 'utf-8', 'windows-1252', 'latin-1'):
        try:
            return raw.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    # Último recurso: ignora erros
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
    Qualquer outra coisa (letra, número, espaço seguido de palavra) indica
    aspas interna não-escapada.
    """
    result = []
    i = 0
    n = len(text)
    in_string = False

    while i < n:
        c = text[i]

        if in_string:
            if c == '\\' and i + 1 < n:
                # Sequência de escape legítima — copia os dois chars
                result.append(c)
                result.append(text[i + 1])
                i += 2
                continue
            elif c == '"':
                # Determina se esta aspas encerra a string ou é interna.
                # Heurística: ignora whitespace após a aspas e verifica o próximo char.
                # Fechamento legítimo: : , } ] " EOF
                # Aspas interna: qualquer outra coisa (letra, dígito, etc.)
                j = i + 1
                while j < n and text[j] in ' \t\r\n':
                    j += 1
                next_c = text[j] if j < n else ''
                if next_c in (':', ',', '}', ']', '"', ''):
                    # Fechamento legítimo da string
                    result.append('"')
                    in_string = False
                else:
                    # Aspas interna não-escapada — escapa
                    result.append('\\"')
            elif c == '\n':
                # Newline literal dentro de string — deve ser escapado
                result.append('\\n')
            elif c == '\r':
                # Carriage return literal dentro de string — deve ser escapado
                result.append('\\r')
            elif c == '\t':
                # Tab literal dentro de string — deve ser escapado
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


def reparar_arquivo(caminho_entrada: str, caminho_saida: str) -> None:
    print(f"Lendo: {caminho_entrada} ({os.path.getsize(caminho_entrada):,} bytes)")

    with open(caminho_entrada, 'rb') as f:
        raw = f.read()

    print("Decodificando...")
    text = detectar_e_decodificar(raw)
    print(f"  {len(text):,} caracteres, encoding detectado")

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

    pasta_saida = os.path.dirname(caminho_saida)
    if pasta_saida:
        os.makedirs(pasta_saida, exist_ok=True)

    print(f"Salvando em UTF-8: {caminho_saida}")
    with open(caminho_saida, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Concluído! Arquivo limpo salvo em: {caminho_saida}")
    print("Agora importe esse arquivo pelo painel de Provas na Íntegra.")


def main():
    parser = argparse.ArgumentParser(description="Repara arquivos JSON do crawler web")
    parser.add_argument("arquivo", help="Arquivo JSON do crawler a ser reparado")
    parser.add_argument("--saida", "-o", help="Arquivo de saída (padrão: <nome>_clean.json)")
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

    reparar_arquivo(caminho, saida)


if __name__ == '__main__':
    main()
