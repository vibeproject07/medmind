#!/usr/bin/env bash

# Setup automático executado após merges de tarefas.
# Não inicializar o SQLite aqui: a aplicação usa PostgreSQL e esse comando
# criaria/modificaria um banco local fora do fluxo de produção.
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export CI=1

echo "Sincronizando dependências sem remover o ambiente existente..."
npm install --prefer-offline --no-audit --no-fund

echo "Dependências sincronizadas com sucesso."