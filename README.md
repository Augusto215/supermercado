# Painel de Automacoes - R Cruz Supermercado

Frontend em Next.js para operacao da folha com:

- Edicao manual por colaborador e por campo da folha
- Regras de automacao ativaveis/desativaveis
- Dashboard com indicadores operacionais
- Ajuste em massa por campo
- Integracao direta com API do RHiD (sem importacao de planilhas)

## Paginas

- `/` Painel geral com cards e ranking
- `/colaboradores` Tabela completa para edicao manual de todos os campos
- `/campos` Visao por campo + acao em massa
- `/automacoes` Controle de regras e execucao

## Rodar localmente

Defina as variaveis da API RHiD:

1. `export RHID_API_TOKEN="SEU_BEARER_TOKEN_RHID"`
2. (Opcional) `export RHID_API_BASE_URL="https://www.rhid.com.br/v2/api.svc"`
3. (Opcional) `export RHID_FETCH_APURACAO="true"` para consultar faltas/atrasos/extras por periodo (aumenta bastante o volume de chamadas)
4. (Opcional) `export RHID_APURACAO_CHUNK_DAYS="5"` para quebrar a consulta de apuracao em blocos menores e reduzir timeout por requisicao
5. (Opcional) `export RHID_APURACAO_CONCURRENCY="1"` para rodar em modo sequencial (mais seguro contra rate limit)
6. (Opcional) `export RHID_MIN_REQUEST_INTERVAL_MS="800"` para impor delay minimo entre chamadas
7. (Opcional) `export RHID_RETRY_MAX_ATTEMPTS="3"`, `export RHID_RETRY_BASE_DELAY_MS="10000"` e `export RHID_403_COOLDOWN_MS="60000"` para backoff progressivo em 403/429/5xx
8. (Opcional) `export RHID_FETCH_TIMEOUT_MS="20000"` e `export RHID_RESOURCE_TIMEOUT_MS="30000"` para timeout por chamada e por recurso (evita loading preso)
9. (Opcional) `export RHID_API_ROUTE_TIMEOUT_MS="45000"` para timeout total da rota `/api/data`
10. (Opcional) `export RHID_APURACAO_TIMEOUT_MS="20000"` para timeout da apuracao por colaborador/faixa
11. (Opcional) `export RHID_REPORT_CACHE_TTL_SEC="300"` para reutilizar o relatorio em memoria e reduzir chamadas repetidas na API
12. (Opcional) `export RHID_DATA_INI="2026-03-01"` e `export RHID_DATA_FINAL="2026-03-31"`

Depois:

1. `npm install`
2. `npm run dev`
3. Abrir `http://localhost:3000`

## Exportacao CSV

- Endpoint: `GET /api/data/export`
- Para forcar recarga antes de exportar: `GET /api/data/export?refresh=1`
