# Rodar o crawler com mais segurança (sem VM)

Como você não tem espaço para uma VM, use uma destas opções, da mais isolada para a que usa zero espaço extra.

---

## 1. Docker (recomendado – ~200–400 MB no disco)

O container usa uma imagem mínima (Alpine + Python). O crawler roda isolado da sua máquina.

**Requisitos:** [Docker Desktop para Windows](https://www.docker.com/products/docker-desktop/) instalado.

```powershell
cd arthur
docker build -t medmind-crawler .
```

Rodar (o resultado sai na pasta `resultado` do host):

```powershell
mkdir resultado
docker run --rm -v "${PWD}/resultado:/resultado" medmind-crawler
```

Se usar cookies por variável de ambiente:

```powershell
docker run --rm -v "${PWD}/resultado:/resultado" -e CRAWLER_COOKIE_HEADER="sua=string; de=cookies" medmind-crawler
```

**Vantagem:** Isolamento de rede e arquivos; pouco espaço; mesmo script que você já usa.

---

## 2. Sandbox no Windows (zero espaço extra)

Sem Docker nem VM: você só isola o ambiente e o local onde o script roda.

1. **Pasta dedicada**  
   Ex.: `C:\crawler-run\` – use só para rodar o crawler e guardar saídas.

2. **Virtual environment só do crawler**  
   Assim as dependências não misturam com o resto do sistema:

   ```powershell
   cd C:\crawler-run
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r "C:\caminho\para\medmind\arthur\requirements-crawler.txt"
   ```

3. **Rodar sempre nessa pasta**  
   Copie só o `web_crawler_4.py` (e `requirements-crawler.txt` se quiser) para `C:\crawler-run\` e execute:

   ```powershell
   cd C:\crawler-run
   .\.venv\Scripts\Activate.ps1
   python web_crawler_4.py
   ```

4. **Opcional – usuário do Windows com menos privilégios**  
   Crie um usuário padrão (sem ser administrador), faça login com ele e rode o crawler só nesse usuário. Se algo corromper arquivos, afeta só esse perfil.

**Vantagem:** Nenhum espaço extra; reduz risco de bagunçar o resto do sistema se você só rodar daqui.

---

## 3. Nuvem (zero espaço no seu PC)

Rode o script em um serviço gratuito; no seu computador não fica nada além do código.

- **Google Cloud Shell** (gratuito): terminal Linux no navegador. Dá para clonar o repo, criar venv, instalar deps e rodar o crawler; o resultado você baixa ou envia por e-mail.
- **GitHub Actions:** workflow que roda o crawler em um job (por exemplo, em um schedule). O resultado pode ser publicado como artefato ou enviado para um repositório/API.
- **Replit / similar:** criar um projeto, colar o script e rodar sob demanda.

**Vantagem:** Isolamento total do seu PC; não usa disco local.

---

## Resumo

| Opção        | Espaço no PC | Isolamento | Esforço     |
|-------------|--------------|------------|-------------|
| Docker      | ~200–400 MB  | Alto       | Médio       |
| Sandbox Win | 0 MB         | Médio      | Baixo       |
| Nuvem       | 0 MB         | Alto       | Médio       |

Recomendação: se puder instalar o Docker, use a opção 1. Se não, use a 2 no dia a dia e, para testes mais “sujos”, a 3.
