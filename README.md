# Painel de Automacoes - R Cruz Supermercado

Frontend em Next.js para operacao da folha com:

- Edicao manual por colaborador e por campo da planilha
- Regras de automacao ativaveis/desativaveis
- Dashboard com indicadores operacionais
- Ajuste em massa por campo

## Paginas

- `/` Painel geral com cards e ranking
- `/colaboradores` Tabela completa para edicao manual de todos os campos
- `/campos` Visao por campo + acao em massa
- `/automacoes` Controle de regras e execucao

## Rodar localmente

1. `npm install`
2. `npm run dev`
3. Abrir `http://localhost:3000`

A leitura inicial de dados vem do arquivo:

- `VARIAVEIS DA FOLHA - FILIAL 01 - Copia.csv.xls`
