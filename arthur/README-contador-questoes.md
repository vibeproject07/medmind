# Contagem de provas — provaderesidencia.com.br

Script: `arthur/crawler_contador_questoes.py`

Coleta **apenas**:
- nome de cada prova
- quantidade de questões

Não baixa enunciados, alternativas, gabaritos nem imagens.

## Instalação

```bash
cd arthur
pip install -r requirements-crawler.txt
cp .env.example .env   # preencha CRAWLER_COOKIE_HEADER se for premium
```

## Uso

```bash
# Demo (sem login)
python crawler_contador_questoes.py --perfil demo

# Premium (cookies do navegador no .env)
python crawler_contador_questoes.py --perfil premium_paid

# Limitar e ajustar delay
python crawler_contador_questoes.py --perfil premium_paid --max-provas 20 --delay 2.0

# Saída explícita
python crawler_contador_questoes.py --perfil demo --saida exports/contagem.json
```

Sem `--saida`, grava automaticamente em `arthur/exports/contagem_questoes_<timestamp>.json` (+ `.csv`).

## Cookies (premium)

1. Login em https://www.provaderesidencia.com.br  
2. F12 → Application → Cookies  
3. Crie **`arthur/.env`** (não o `.env.example`) com **uma linha**:

```env
CRAWLER_COOKIE_HEADER=csrftoken=...; sessionid=...; cf_clearance=...; tkpd=...
```

4. Rode **na mesma máquina/IP** do login (Cloudflare amarra o `cf_clearance` ao IP)

**Erros comuns:** cookies no `.env.example`; cookies em linhas soltas sem `CRAWLER_COOKIE_HEADER=`; placeholders `SEU_TOKEN`.

## Saída

```json
{
  "total_provas": 120,
  "total_questoes": 5400,
  "provas": [
    { "nome": "USP - SP - 2024 - R1", "url": "...", "questoes": 100 }
  ]
}
```
