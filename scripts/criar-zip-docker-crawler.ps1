# Gera medmind-crawler-docker.zip para usar o crawler em outra máquina.
# Uso: .\scripts\criar-zip-docker-crawler.ps1
# O ZIP será criado na raiz do projeto (medmind-crawler-docker.zip).

$ErrorActionPreference = "Stop"
$projetoRoot = $PSScriptRoot -replace "\\scripts$", ""
$arthur = Join-Path $projetoRoot "arthur"
$zipNome = "medmind-crawler-docker.zip"
$zipCaminho = Join-Path $projetoRoot $zipNome
$pastaTemp = Join-Path $projetoRoot "docker-crawler-temp"

# Arquivos a incluir no ZIP (dest = nome no ZIP)
$arquivos = @(
    @{ src = "Dockerfile"; dir = "arthur"; dest = "Dockerfile" },
    @{ src = "requirements-crawler.txt"; dir = "arthur"; dest = "requirements-crawler.txt" },
    @{ src = "web_crawler_4.py"; dir = "arthur"; dest = "web_crawler_4.py" },
    @{ src = "DOCKER-LEIA-ME.txt"; dir = "arthur"; dest = "LEIA-ME.txt" }
)

if (-not (Test-Path $arthur)) {
    Write-Error "Pasta arthur nao encontrada: $arthur"
}

# Remove ZIP anterior e pasta temp
if (Test-Path $zipCaminho) { Remove-Item $zipCaminho -Force }
if (Test-Path $pastaTemp) { Remove-Item $pastaTemp -Recurse -Force }

New-Item -ItemType Directory -Path $pastaTemp -Force | Out-Null

foreach ($a in $arquivos) {
    $srcPath = Join-Path (Join-Path $projetoRoot $a.dir) $a.src
    $destPath = Join-Path $pastaTemp $a.dest
    if (-not (Test-Path $srcPath)) {
        Write-Error "Arquivo nao encontrado: $srcPath"
    }
    Copy-Item $srcPath -Destination $destPath -Force
}

# Criar ZIP a partir do conteúdo da pasta (sem criar subpasta "docker-crawler-temp")
$arquivosZip = Get-ChildItem -Path $pastaTemp -File
Compress-Archive -Path ($arquivosZip | ForEach-Object { $_.FullName }) -DestinationPath $zipCaminho -Force

# Limpar pasta temp
Remove-Item $pastaTemp -Recurse -Force

Write-Host "ZIP criado: $zipCaminho"
Write-Host "Copie ou baixe este arquivo para a outra maquina e siga as instrucoes em LEIA-ME.txt"
