#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-dev}"
TOKENIZER_PORT="${SPACY_TOKENIZER_PORT:-5002}"

bash scripts/run-spacy-tokenizer.sh &
TOKENIZER_PID=$!

cleanup() {
  kill "$TOKENIZER_PID" 2>/dev/null || true
  if [[ -n "${NEXT_PID:-}" ]]; then
    kill "$NEXT_PID" 2>/dev/null || true
  fi
  wait "$TOKENIZER_PID" 2>/dev/null || true
  if [[ -n "${NEXT_PID:-}" ]]; then
    wait "$NEXT_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

for _ in $(seq 1 120); do
  if ! kill -0 "$TOKENIZER_PID" 2>/dev/null; then
    echo "O serviço spaCy encerrou durante a inicialização." >&2
    wait "$TOKENIZER_PID"
  fi
  if curl --silent --fail "http://127.0.0.1:${TOKENIZER_PORT}/health" >/dev/null; then
    break
  fi
  sleep 0.5
done

if ! curl --silent --fail "http://127.0.0.1:${TOKENIZER_PORT}/health" >/dev/null; then
  echo "O serviço spaCy não ficou pronto no tempo esperado." >&2
  exit 1
fi

case "$MODE" in
  dev)
    npm run dev:next &
    ;;
  start)
    npm run start:next &
    ;;
  *)
    echo "Modo inválido: $MODE. Use dev ou start." >&2
    exit 1
    ;;
esac

NEXT_PID=$!
set +e
wait -n "$TOKENIZER_PID" "$NEXT_PID"
EXIT_CODE=$?
set -e

if kill -0 "$TOKENIZER_PID" 2>/dev/null; then
  echo "A aplicação Next.js encerrou; finalizando o tokenizer." >&2
else
  echo "O tokenizer spaCy encerrou; finalizando a aplicação para permitir reinício limpo." >&2
fi
exit "$EXIT_CODE"