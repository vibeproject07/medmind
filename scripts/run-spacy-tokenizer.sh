#!/usr/bin/env bash
set -euo pipefail

exec bash scripts/run-python-with-spacy.sh \
  -m uvicorn services.spacy_tokenizer.main:app \
  --host 127.0.0.1 \
  --port "${SPACY_TOKENIZER_PORT:-5002}"