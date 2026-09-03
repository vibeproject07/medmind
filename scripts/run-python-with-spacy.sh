#!/usr/bin/env bash
set -euo pipefail

PYTHON_MINOR="$(python -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
PACKAGE_ROOTS="$(
  printf '%s' "$PATH" |
    tr ':' '\n' |
    sed 's#/bin$##' |
    grep -E "python${PYTHON_MINOR//./\\.}-(spacy|fastapi|uvicorn)-" |
    sort -u
)"

if [[ -z "$PACKAGE_ROOTS" ]]; then
  echo "Dependências Python do tokenizer não estão disponíveis no ambiente Nix." >&2
  exit 1
fi

PYTHON_PACKAGE_PATH="$(
  nix-store -qR $PACKAGE_ROOTS |
    while read -r root; do
      candidate="$root/lib/python${PYTHON_MINOR}/site-packages"
      if [[ -d "$candidate" ]]; then
        printf '%s:' "$candidate"
      fi
    done
)"

export PYTHONPATH="${PYTHON_PACKAGE_PATH}${PYTHONPATH:-}"
exec python "$@"