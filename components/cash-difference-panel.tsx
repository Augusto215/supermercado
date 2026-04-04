"use client";

import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

const CASH_DIFFERENCE_LIMIT = 1.05;

interface CashDifferenceRow {
  id: string;
  operador: string;
  dia: string;
  valorEsperado: number | null;
  valorContado: number | null;
  diferenca: number;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2
  }).format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  }).format(value);
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const cleaned = trimmed
    .replace(/\s+/g, "")
    .replace(/R\$/gi, "")
    .replace(/[^\d,.-]/g, "");

  if (!cleaned || cleaned === "-" || cleaned === "," || cleaned === ".") return null;

  const commaIndex = cleaned.lastIndexOf(",");
  const dotIndex   = cleaned.lastIndexOf(".");
  let normalized   = cleaned;

  if (commaIndex !== -1 && dotIndex !== -1) {
    normalized = commaIndex > dotIndex
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (commaIndex !== -1) {
    normalized = cleaned.replace(",", ".");
  } else if (dotIndex !== -1) {
    const parts = cleaned.split(".");
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      normalized = cleaned.replace(/\./g, "");
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function detectDelimiter(text: string): string {
  const delimiters = [";", ",", "\t", "|"];
  const sample = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 8);
  if (sample.length === 0) return ";";

  let selected = ";";
  let bestScore = -1;
  for (const d of delimiters) {
    const score = sample.reduce((t, l) => t + Math.max(0, l.split(d).length - 1), 0);
    if (score > bestScore) { bestScore = score; selected = d; }
  }
  return selected;
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') { cell += '"'; i++; }
      else inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === delimiter) { row.push(cell.trim()); cell = ""; continue; }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some((v) => v.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }

  row.push(cell.trim());
  if (row.some((v) => v.length > 0)) rows.push(row);
  return rows;
}

function findColumn(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const i = headers.findIndex((h) => h === alias);
    if (i >= 0) return i;
  }
  for (const alias of aliases) {
    const i = headers.findIndex((h) => h.includes(alias));
    if (i >= 0) return i;
  }
  return -1;
}

function parseDateLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Sem data";

  const serial = Number(trimmed.replace(",", "."));
  if (Number.isFinite(serial) && serial > 20_000 && serial < 80_000) {
    const date = new Date(Math.round((serial - 25_569) * 86_400_000));
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString("pt-BR", { timeZone: "UTC" });
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString("pt-BR");
  return trimmed;
}

function isRhidReportFormat(headers: string[]): boolean {
  return (
    headers.some((h) => h === "tipo processamento" || h === "tipo de processamento") &&
    headers.some((h) => h === "funcionario") &&
    headers.some((h) => h.includes("226") && h.includes("diferenca"))
  );
}

function parseRhidReportCashRows(matrix: string[][]): CashDifferenceRow[] {
  const headers   = matrix[0].map((h) => normalizeText(h));
  const funcIdx   = headers.findIndex((h) => h === "funcionario");
  const diffIdx   = headers.findIndex((h) => h.includes("226") && h.includes("diferenca"));

  if (funcIdx === -1 || diffIdx === -1) {
    throw new Error("Formato RHiD: nao foi possivel localizar colunas 'Funcionario' ou '226 - Diferenca de Caixa'.");
  }

  const result: CashDifferenceRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const line      = matrix[i];
    const operador  = (line[funcIdx] ?? "").trim();
    const diferenca = parseNumber(line[diffIdx] ?? "");

    if (!operador || diferenca === null) continue;

    result.push({ id: `cash-${i}`, operador, dia: "Mensal", valorEsperado: null, valorContado: null, diferenca });
  }
  return result;
}

// Termos que só aparecem em células de cabeçalho — não em títulos livres
const HEADER_EXACT = ["operadoras", "operadora", "operador", "data", "dia", "valor", "diferenca", "esperado", "contado", "colaborador", "funcionario"];

function isHeaderRow(row: string[]): boolean {
  const normalized = row.map((h) => normalizeText(h));
  const exactMatches = normalized.filter((h) => HEADER_EXACT.includes(h)).length;
  return exactMatches >= 2;
}

function findHeaderRow(matrix: string[][]): number {
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    if (isHeaderRow(matrix[i])) return i;
  }
  return 0;
}

function parseCashRows(text: string): CashDifferenceRow[] {
  const delimiter = detectDelimiter(text);
  const matrix    = parseDelimited(text, delimiter);

  if (matrix.length < 2) throw new Error("Planilha sem dados suficientes para calcular diferenca de caixa.");

  const headerRowIdx = findHeaderRow(matrix);
  const headers = matrix[headerRowIdx].map((h) => normalizeText(h));

  if (isRhidReportFormat(headers)) {
    return parseRhidReportCashRows(matrix.slice(headerRowIdx));
  }

  const operadorIdx   = findColumn(headers, ["operadoras", "operadora", "operador", "colaborador", "funcionario", "nome", "caixa"]);
  const diaIdx        = findColumn(headers, ["dia", "data", "periodo", "movimento"]);
  const diferencaIdx  = findColumn(headers, ["valor", "diferenca", "diferença", "quebra", "sobra"]);
  const esperadoIdx   = findColumn(headers, ["esperado", "teorico", "sistema", "valor sistema", "total sistema"]);
  const contadoIdx    = findColumn(headers, ["contado", "apurado", "real", "fechamento", "valor contado"]);

  if (diferencaIdx === -1 && (esperadoIdx === -1 || contadoIdx === -1)) {
    throw new Error("Nao foi possivel identificar colunas de diferenca. Use 'Diferenca' ou as colunas 'Esperado' e 'Contado'.");
  }

  const result: CashDifferenceRow[] = [];
  for (let i = headerRowIdx + 1; i < matrix.length; i++) {
    const line = matrix[i];
    const get  = (idx: number) => (idx >= 0 ? line[idx] ?? "" : "");

    const operadorRaw  = get(operadorIdx).trim();
    const operador     = operadorRaw;

    // Pula linhas sem nome real ou que sejam totalizadores
    if (!operador || /^total[:\s]*/i.test(operador)) continue;

    const diaRaw = get(diaIdx).trim();
    if (/^total[:\s]*/i.test(diaRaw)) continue;

    const dia          = parseDateLabel(diaRaw);
    const valorEsperado = parseNumber(get(esperadoIdx));
    const valorContado  = parseNumber(get(contadoIdx));
    const diferencaDireta = parseNumber(get(diferencaIdx));
    const diferenca = diferencaDireta ??
      (valorEsperado !== null && valorContado !== null
        ? Number((valorContado - valorEsperado).toFixed(2))
        : null);

    if (diferenca === null) continue;

    result.push({ id: `cash-${i}`, operador, dia, valorEsperado, valorContado, diferenca });
  }

  // Agrupa por operador, somando as diferenças
  const byOperador = new Map<string, CashDifferenceRow>();
  for (const row of result) {
    const key = row.operador.toLowerCase().trim();
    const existing = byOperador.get(key);
    if (existing) {
      existing.diferenca = Number((existing.diferenca + row.diferenca).toFixed(2));
      existing.dia = "Múltiplos";
      existing.valorEsperado = null;
      existing.valorContado = null;
    } else {
      byOperador.set(key, { ...row });
    }
  }

  return Array.from(byOperador.values());
}

async function readSpreadsheetText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();

  const isXlsx = file.name.match(/\.(xlsx|xls|ods)$/i);
  if (isXlsx) {
    const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_csv(sheet, { FS: ";", blankrows: false });
  }

  let text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (text.includes("\uFFFD")) text = new TextDecoder("latin1").decode(buffer);
  return text;
}

function statusForDifference(difference: number): { label: string; className: "warning" | "ok" | "neutral" } {
  if (Math.abs(difference) > CASH_DIFFERENCE_LIMIT) return { label: "Acima do limite", className: "warning" };
  if (difference > 0) return { label: "Sobra", className: "ok" };
  if (difference < 0) return { label: "Quebra", className: "neutral" };
  return { label: "Ok", className: "ok" };
}

interface DbCashRow {
  id: string;
  operador: string;
  dia: string;
  valor_esperado: number | null;
  valor_contado: number | null;
  diferenca: number;
}

function fromDb(r: DbCashRow): CashDifferenceRow {
  return {
    id:            r.id,
    operador:      r.operador,
    dia:           r.dia,
    valorEsperado: r.valor_esperado,
    valorContado:  r.valor_contado,
    diferenca:     Number(r.diferenca)
  };
}

export function CashDifferencePanel(): JSX.Element {
  const [rows, setRows]       = useState<CashDifferenceRow[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [error, setError]     = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving]   = useState(false);

  // Load most-recent import from Supabase on mount
  useEffect(() => {
    fetch("/api/cash-differences")
      .then((res) => res.json())
      .then((data: DbCashRow[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setRows(data.map(fromDb));
        }
      })
      .catch(() => { /* show empty state */ });
  }, []);

  const metrics = useMemo(() => {
    const totalLancamentos = rows.length;
    const totalDiferenca   = rows.reduce((t, r) => t + r.diferenca, 0);
    const totalSobra  = rows.reduce((t, r) => t + (r.diferenca > 0 ? r.diferenca : 0), 0);
    const totalQuebra = rows.reduce((t, r) => t + (r.diferenca < 0 ? Math.abs(r.diferenca) : 0), 0);
    const acimaLimite = rows.filter((r) => Math.abs(r.diferenca) > CASH_DIFFERENCE_LIMIT).length;
    const mediaAbsoluta = totalLancamentos > 0
      ? rows.reduce((t, r) => t + Math.abs(r.diferenca), 0) / totalLancamentos
      : 0;

    let maiorSobra:  CashDifferenceRow | null = null;
    let maiorQuebra: CashDifferenceRow | null = null;
    for (const r of rows) {
      if (r.diferenca > 0 && (!maiorSobra  || r.diferenca > maiorSobra.diferenca))  maiorSobra  = r;
      if (r.diferenca < 0 && (!maiorQuebra || r.diferenca < maiorQuebra.diferenca)) maiorQuebra = r;
    }

    return {
      totalLancamentos, totalDiferenca, totalSobra, totalQuebra,
      acimaLimite, mediaAbsoluta,
      taxaAcimaLimite: totalLancamentos > 0 ? acimaLimite / totalLancamentos : 0,
      maiorSobra, maiorQuebra
    };
  }, [rows]);

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca)),
    [rows]
  );

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError(null);

    try {
      const text       = await readSpreadsheetText(file);
      const parsedRows = parseCashRows(text);

      if (parsedRows.length === 0) throw new Error("Nenhuma linha valida foi encontrada na planilha importada.");

      setRows(parsedRows);
      setFileName(file.name);

      // Save to Supabase in background
      setSaving(true);
      fetch("/api/cash-differences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          arquivo: file.name,
          rows: parsedRows.map((r) => ({
            operador:      r.operador,
            dia:           r.dia,
            valorEsperado: r.valorEsperado,
            valorContado:  r.valorContado,
            diferenca:     r.diferenca
          }))
        })
      })
        .catch(() => { /* non-blocking — data is already shown locally */ })
        .finally(() => setSaving(false));
    } catch (parseError) {
      setRows([]);
      setFileName("");
      setError(parseError instanceof Error ? parseError.message : "Erro ao importar planilha.");
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  };

  return (
    <section className="panel">
      <div className="panel-head split">
        <div>
          <p className="section-kicker">Conferencia por planilha</p>
          <h3>Diferenca de Caixa</h3>
          <p>
            Importe a planilha da conferencia para calcular automaticamente as metricas e identificar
            quais lancamentos estao acima do limite de R$ 1,05.
          </p>
          <div className="panel-badges">
            <span className="panel-badge">Limite de alerta: R$ 1,05</span>
            <span className="panel-badge">{rows.length} lancamentos carregados</span>
            {saving && <span className="panel-badge">Salvando...</span>}
          </div>
        </div>

        <div className="upload-section">
          <label className="upload-button" htmlFor="cash-difference-upload" aria-disabled={importing}>
            {importing ? "Importando..." : "Importar planilha"}
          </label>
          <input
            id="cash-difference-upload"
            className="hidden-input"
            type="file"
            accept=".csv,.txt,.xls,.xlsx"
            onChange={(e) => void handleImportFile(e)}
            disabled={importing}
          />
          {fileName && <span className="upload-file-name">Arquivo: {fileName}</span>}
        </div>
      </div>

      <p className="helper-text">
        Colunas reconhecidas automaticamente: operador/funcionario, dia/data e diferenca (ou esperado + contado).
      </p>

      {error && (
        <div className="warning-box"><p>{error}</p></div>
      )}

      {rows.length === 0 && !error && (
        <p className="empty-text">Nenhuma planilha importada ainda. Selecione o arquivo para iniciar a conferencia.</p>
      )}

      {rows.length > 0 && (
        <>
          <div className="metric-grid">
            <article className="metric-card sunrise">
              <span>Total de lancamentos</span>
              <strong>{metrics.totalLancamentos}</strong>
            </article>

            <article className="metric-card lime">
              <span>Total de sobras</span>
              <strong>{formatCurrency(metrics.totalSobra)}</strong>
            </article>

            <article className="metric-card sunset">
              <span>Total de quebras</span>
              <strong>{formatCurrency(metrics.totalQuebra)}</strong>
            </article>

            <article className="metric-card slate">
              <span>Acima do limite</span>
              <strong>{metrics.acimaLimite}</strong>
              <small>{formatPercent(metrics.taxaAcimaLimite)} da planilha</small>
            </article>

            <article className="metric-card ocean">
              <span>Diferenca liquida</span>
              <strong>{formatCurrency(metrics.totalDiferenca)}</strong>
              <small>Media absoluta: {formatCurrency(metrics.mediaAbsoluta)}</small>
            </article>
          </div>

          <div className="analysis-summary">
            <h4>Leitura rapida</h4>
            <p>
              Maior sobra:{" "}
              {metrics.maiorSobra
                ? `${metrics.maiorSobra.operador} (${formatCurrency(metrics.maiorSobra.diferenca)})`
                : "nao encontrada"}
              . Maior quebra:{" "}
              {metrics.maiorQuebra
                ? `${metrics.maiorQuebra.operador} (${formatCurrency(metrics.maiorQuebra.diferenca)})`
                : "nao encontrada"}
              .
            </p>
          </div>

          <div className="table-wrapper">
            <table className="cash-table">
              <thead>
                <tr>
                  <th>Operador</th>
                  <th>Dia</th>
                  <th>Valor esperado</th>
                  <th>Valor contado</th>
                  <th>Diferenca</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const status = statusForDifference(row.diferenca);
                  return (
                    <tr key={row.id}>
                      <td className="sticky-cell employee-cell"><strong>{row.operador}</strong></td>
                      <td>{row.dia}</td>
                      <td>{row.valorEsperado === null ? "-" : formatCurrency(row.valorEsperado)}</td>
                      <td>{row.valorContado  === null ? "-" : formatCurrency(row.valorContado)}</td>
                      <td>{formatCurrency(row.diferenca)}</td>
                      <td><span className={`status-pill ${status.className}`}>{status.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
