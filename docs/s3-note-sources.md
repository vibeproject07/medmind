# Fontes privadas de notas no S3

As fontes multimodais de notas são gravadas no prefixo `sources/` e **não** usam URL pública. O aplicativo primeiro verifica que a pessoa tem acesso à nota, emite uma URL pré-assinada curta para upload ou leitura e registra somente os metadados no PostgreSQL.

## Variáveis necessárias

Configure `AWS_S3_BUCKET`, `AWS_REGION`, e um dos pares de credenciais abaixo:

- `AWS_ACCESS_KEY_ID` e `AWS_SECRET_ACCESS_KEY`; ou
- `IAM_AWS_S3_access_key` e `IAM_AWS_S3_secret_key`.

## Política mínima do IAM

Substitua `medmind-bucket-s3` se o bucket tiver outro nome. A aplicação não precisa de `s3:ListBucket`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PrivateNoteSources",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::medmind-bucket-s3/sources/*"
    },
    {
      "Sid": "QuestionImages",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::medmind-bucket-s3/questions/*"
    }
  ]
}
```

Mantenha o prefixo `sources/` privado. O prefixo `questions/` continua no fluxo de imagens com URL direta e, por isso, necessita de leitura pública enquanto esse fluxo não usar URLs pré-assinadas.

## CORS necessário para upload direto

Como arquivos grandes são enviados do navegador diretamente ao S3, adicione esta configuração CORS ao bucket e substitua o domínio pelo domínio publicado e/ou de desenvolvimento da aplicação:

```json
[
  {
    "AllowedHeaders": ["content-type"],
    "AllowedMethods": ["POST", "GET", "HEAD"],
    "AllowedOrigins": [
      "https://SEU-DOMINIO-DE-PRODUCAO",
      "https://SEU-DOMINIO.replit.dev"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Os formatos aceitos são PDF, Word, PowerPoint, texto, CSV, JPEG, PNG, GIF, WebP, MP3, M4A, WAV, OGG, MP4, WebM e MOV. O limite de armazenamento é de 500 MB por arquivo; a transcrição tem o limite próprio do serviço de transcrição.

## Limpeza de uploads abandonados

Os uploads usam o prefixo temporário `sources/staging/` e só são copiados para o prefixo final depois da conferência de tamanho e checksum. Configure uma regra de ciclo de vida no bucket para expirar objetos em `sources/staging/` após 1 dia. O aplicativo remove os metadados pendentes nessa mesma janela.