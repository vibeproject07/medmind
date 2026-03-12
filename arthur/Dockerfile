# Imagem mínima (~50 MB) – só Python + dependências do crawler
FROM python:3.11-alpine

WORKDIR /app

# Apenas o necessário para requests/SSL
RUN apk add --no-cache ca-certificates

COPY requirements-crawler.txt .
RUN pip install --no-cache-dir -r requirements-crawler.txt

COPY web_crawler_4.py ./

# Montar pasta do host em /resultado para receber resultado_crawl.json
# Ex.: docker run --rm -v "%cd%\resultado:/resultado" medmind-crawler
ENV CRAWLER_SAIDA=/resultado/resultado_crawl.json
ENTRYPOINT ["python", "-u", "web_crawler_4.py"]
