# Painel de Automacoes - R Cruz Supermercado

Frontend em Next.js para operacao da folha com:

- Edicao manual por colaborador e por campo da folha
- Regras de automacao ativaveis/desativaveis
- Dashboard com indicadores operacionais
- Ajuste em massa por campo
- Integracao direta com API do RHiD (sem importacao de planilhas)

## Paginas

- `/` redireciona para `/campos`
- `/colaboradores` Tabela completa para edicao manual de todos os campos
- `/campos` Visao por campo + acao em massa
- `/painel` Analise de ponto RHiD
- `/diferenca-caixa` Importacao de planilha e metricas de diferenca de caixa
- `/compras-funcionarios` Lancamento manual de compras com selecao de funcionario
- `/automacoes` Controle de regras e execucao

## Rodar localmente

Defina as variaveis da API RHiD:

1. `export RHID_API_TOKEN="SEU_BEARER_TOKEN_RHID"`
2. (Opcional, recomendado) `export RHID_API_EMAIL="seu_email"` e `export RHID_API_PASSWORD="sua_senha"` para renovacao automatica do token via `POST /login` quando expirar
3. (Opcional) `export RHID_API_DOMAIN="seu_dominio"` para enviar o dominio no login automatico
4. (Opcional) `export RHID_API_BASE_URL="https://www.rhid.com.br/v2/api.svc"`
5. (Opcional) `export RHID_FETCH_APURACAO="true"` para consultar faltas/atrasos/extras por periodo (aumenta bastante o volume de chamadas)
6. (Opcional) `export RHID_APURACAO_CHUNK_DAYS="5"` para quebrar a consulta de apuracao em blocos menores e reduzir timeout por requisicao
7. (Opcional) `export RHID_APURACAO_CONCURRENCY="1"` para rodar em modo sequencial (mais seguro contra rate limit)
8. (Opcional) `export RHID_MIN_REQUEST_INTERVAL_MS="800"` para impor delay minimo entre chamadas
9. (Opcional) `export RHID_RETRY_MAX_ATTEMPTS="3"`, `export RHID_RETRY_BASE_DELAY_MS="10000"` e `export RHID_403_COOLDOWN_MS="60000"` para backoff progressivo em 403/429/5xx
10. (Opcional) `export RHID_FETCH_TIMEOUT_MS="20000"` e `export RHID_RESOURCE_TIMEOUT_MS="30000"` para timeout por chamada e por recurso (evita loading preso)
11. (Opcional) `export RHID_API_ROUTE_TIMEOUT_MS="90000"` para timeout total da rota `/api/data`
12. (Opcional) `export RHID_APURACAO_TIMEOUT_MS="20000"` para timeout da apuracao por colaborador/faixa
13. (Opcional) `export RHID_APURACAO_TOTAL_TIMEOUT_MS="30000"` e `export RHID_APURACAO_MAX_FAILURES="20"` para interromper apuracao em massa quando a API entra em bloqueio
14. (Opcional) `export RHID_TOKEN_REFRESH_SKEW_MS="120000"` para renovar token um pouco antes de expirar
15. (Opcional) `export RHID_REPORT_CACHE_TTL_SEC="300"` para reutilizar o relatorio em memoria e reduzir chamadas repetidas na API
16. (Opcional) `export RHID_REPORT_DB_ENABLED="true"` e `export RHID_REPORT_DB_PATH="data/rhid-report-db.json"` para persistir cache da API em arquivo local
17. (Opcional) `export RHID_DATA_INI="2026-03-01"` e `export RHID_DATA_FINAL="2026-03-31"`

Depois:

1. `npm install`
2. `npm run dev`
3. Abrir `http://localhost:3000`

## Exportacao CSV

- Endpoint: `GET /api/data/export`
- Para forcar recarga antes de exportar: `GET /api/data/export?refresh=1`
