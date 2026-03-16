import path from "node:path";
import { readFile, stat } from "node:fs/promises";

import {
  type RhidAnalyticalSummary,
  type RhidLists,
  type RhidProcessedRow,
  type RhidRawRow,
  type RhidReportData
} from "@/lib/types";

const DEFAULT_WORK_DAYS = 26;
const VALE_REFEICAO_BASE = 15.82;
const VALE_REFEICAO_PERCENT = 0.2;

function buildCsvCandidates(): string[] {
  const csvName = "relatorio_2026311_1914.CSV";
  const configuredPath = (process.env.RHID_CSV_PATH ?? "").trim();
  const candidates = new Set<string>();

  if (configuredPath) {
    candidates.add(configuredPath);

    if (!path.isAbsolute(configuredPath)) {
      candidates.add(path.join(process.cwd(), configuredPath));
      candidates.add(path.join("/app", configuredPath));
    }
  }

  candidates.add(path.join(process.cwd(), csvName));
  candidates.add(path.join("/app", csvName));
  candidates.add("/home/augusto/Downloads/relatorio_2026311_1914.CSV");

  return Array.from(candidates);
}

const RHID_CSV_CANDIDATES = buildCsvCandidates();

interface HeaderIndexes {
  nome: number;
  totalNormais: number;
  totalNoturno: number;
  diaFalta: number;
  faltaEAtraso: number;
  abono: number;
  extra100D: number;
  extraDiurna: number;
  extraNoturna: number;
  bancoTotal: number;
  bancoSaldo: number;
  diasUteis: number;
}

function roundTwo(value: number): number {
  return Number(value.toFixed(2));
}

export function decodeCsv(buffer: Buffer): string {
  const utf8Text = buffer.toString("utf8");

  if (utf8Text.includes("\uFFFD")) {
    return buffer.toString("latin1");
  }

  return utf8Text;
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseLocalizedNumber(value?: string): number {
  if (!value) {
    return 0;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return 0;
  }

  const withoutSpaces = trimmed.replace(/\s+/g, "");
  const normalized =
    withoutSpaces.includes(".") && withoutSpaces.includes(",")
      ? withoutSpaces.replace(/\./g, "").replace(",", ".")
      : withoutSpaces.replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDurationToMinutes(value?: string): number {
  if (!value) {
    return 0;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return 0;
  }

  const signal = trimmed.startsWith("-") ? -1 : 1;
  const unsigned = trimmed.replace(/^[+-]/, "");

  if (unsigned.includes(":")) {
    const [hourPart = "0", minutePart = "0"] = unsigned.split(":");
    const hours = Number(hourPart);
    const minutes = Number(minutePart);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return 0;
    }

    return signal * (Math.abs(hours) * 60 + Math.abs(minutes));
  }

  return signal * Math.round(parseLocalizedNumber(unsigned) * 60);
}

function toAbsenceCount(value?: string): number {
  const parsed = parseLocalizedNumber(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return roundTwo(parsed);
}

function detectDelimiter(headerLine: string): ";" | "," {
  const semicolonCount = headerLine.split(";").length;
  const commaCount = headerLine.split(",").length;

  return semicolonCount >= commaCount ? ";" : ",";
}

function getColumn(columns: string[], index: number): string {
  if (index < 0) {
    return "";
  }

  return columns[index]?.trim() ?? "";
}

function indexFromAliases(headers: string[], aliases: string[]): number {
  const normalizedHeaders = headers.map(normalizeHeader);

  for (const alias of aliases) {
    const index = normalizedHeaders.indexOf(alias);

    if (index >= 0) {
      return index;
    }
  }

  return -1;
}

function readHeaderIndexes(headers: string[]): HeaderIndexes {
  return {
    nome: indexFromAliases(headers, ["nomedofuncionario", "funcionario", "nome"]),
    totalNormais: indexFromAliases(headers, ["totalnormais"]),
    totalNoturno: indexFromAliases(headers, ["totalnoturno"]),
    diaFalta: indexFromAliases(headers, ["diafalta", "faltas"]),
    faltaEAtraso: indexFromAliases(headers, ["faltaeatraso", "atrasototal", "atraso"]),
    abono: indexFromAliases(headers, ["abono"]),
    extra100D: indexFromAliases(headers, ["extra100d"]),
    extraDiurna: indexFromAliases(headers, ["extradiurna"]),
    extraNoturna: indexFromAliases(headers, ["extranoturna"]),
    bancoTotal: indexFromAliases(headers, ["bancototal"]),
    bancoSaldo: indexFromAliases(headers, ["bancosaldo", "saldobanco"]),
    diasUteis: indexFromAliases(headers, ["diasuteis", "diasuteismes", "diasuteisdomes"])
  };
}

function sortByMetric(rows: RhidProcessedRow[], getter: (row: RhidProcessedRow) => number): RhidProcessedRow[] {
  return [...rows].sort((first, second) => {
    const distance = getter(second) - getter(first);

    if (distance !== 0) {
      return distance;
    }

    return first.nome.localeCompare(second.nome, "pt-BR");
  });
}

export function buildLists(rows: RhidProcessedRow[]): RhidLists {
  return {
    maisAtrasos: sortByMetric(
      rows.filter((row) => row.atrasoTotalMin > 0),
      (row) => row.atrasoTotalMin
    ),
    comFaltas: sortByMetric(
      rows.filter((row) => row.faltas > 0),
      (row) => row.faltas
    ),
    maisHorasExtras: sortByMetric(
      rows.filter((row) => row.horasExtrasTotaisMin > 0),
      (row) => row.horasExtrasTotaisMin
    )
  };
}

function pickTop(rows: RhidProcessedRow[]): RhidProcessedRow | null {
  return rows[0] ?? null;
}

export function buildSummary(rows: RhidProcessedRow[], lists: RhidLists, diasUteis: number): RhidAnalyticalSummary {
  const totalColaboradores = rows.length;
  const totalFaltas = rows.reduce((sum, row) => sum + row.faltas, 0);
  const totalAtrasoMin = rows.reduce((sum, row) => sum + row.atrasoTotalMin, 0);
  const totalHorasExtrasMin = rows.reduce((sum, row) => sum + row.horasExtrasTotaisMin, 0);
  const totalValeRefeicao = rows.reduce((sum, row) => sum + row.valorValeRefeicao, 0);
  const totalValorDesconto = rows.reduce((sum, row) => sum + row.valorDesconto, 0);
  const totalBancoHorasMin = rows.reduce((sum, row) => sum + row.bancoHorasMin, 0);

  return {
    totalColaboradores,
    totalFaltas: roundTwo(totalFaltas),
    totalAtrasoMin,
    totalHorasExtrasMin,
    totalValeRefeicao: roundTwo(totalValeRefeicao),
    totalValorDesconto: roundTwo(totalValorDesconto),
    totalBancoHorasMin,
    colaboradoresComFaltas: rows.filter((row) => row.faltas > 0).length,
    colaboradoresComDesconto: rows.filter((row) => row.statusFaltas === "DESCONTAR").length,
    colaboradoresComValorDesconto: rows.filter((row) => row.valorDesconto > 0).length,
    colaboradoresComAlertaAtraso: rows.filter((row) => row.alertaAtraso === "ALERTA").length,
    maiorAtraso: pickTop(lists.maisAtrasos),
    maiorFaltas: pickTop(sortByMetric(rows, (row) => row.faltas).filter((row) => row.faltas > 0)),
    maiorHorasExtras: pickTop(lists.maisHorasExtras),
    diasUteisConsiderados: diasUteis,
    regraValeRefeicao: "(Dias uteis - faltas) x 15,82 x 20%"
  };
}

export function processRows(rawRows: RhidRawRow[], diasUteis: number): RhidProcessedRow[] {
  return rawRows.map((row) => {
    const faltas = Math.max(0, row.diaFalta);
    const atrasoTotalMin = Math.max(0, row.faltaEAtrasoMin);
    const horasExtrasTotaisMin = Math.max(0, row.extra100DMin + row.extraDiurnaMin + row.extraNoturnaMin);
    const statusFaltas: "DESCONTAR" | "OK" = faltas > 2 ? "DESCONTAR" : "OK";
    const baseDiasVale = Math.max(0, diasUteis - faltas);
    const valorValeRefeicao = roundTwo(baseDiasVale * VALE_REFEICAO_BASE * VALE_REFEICAO_PERCENT);
    const descontoPorFalta = roundTwo(faltas * VALE_REFEICAO_BASE * VALE_REFEICAO_PERCENT);
    const valorDesconto = statusFaltas === "DESCONTAR" ? descontoPorFalta : 0;
    const motivoDesconto = statusFaltas === "DESCONTAR" ? "Faltas acima de 2 no periodo" : "Sem desconto";

    return {
      id: row.id,
      nome: row.nome,
      faltas,
      atrasoTotalMin,
      horasExtrasTotaisMin,
      bancoHorasMin: row.bancoSaldoMin,
      statusFaltas,
      alertaAtraso: atrasoTotalMin > 5 * 60 ? "ALERTA" : "OK",
      motivoDesconto,
      valorDesconto,
      valorValeRefeicao
    };
  });
}

async function resolveCsvPath(): Promise<string | null> {
  for (const candidate of RHID_CSV_CANDIDATES) {
    try {
      const fileStats = await stat(candidate);

      if (fileStats.isFile()) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function parseRawRows(content: string, warnings: string[]): { rawRows: RhidRawRow[]; diasUteis: number } {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    warnings.push("Arquivo CSV vazio.");
    return { rawRows: [], diasUteis: DEFAULT_WORK_DAYS };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = lines[0].split(delimiter).map((column) => column.trim());
  const indexes = readHeaderIndexes(headers);

  if (indexes.nome < 0) {
    warnings.push("Coluna 'Nome do funcionario' nao encontrada.");
  }

  const diasUteisValues: number[] = [];
  const rawRows: RhidRawRow[] = [];

  for (const [lineIndex, line] of lines.slice(1).entries()) {
    const columns = line.split(delimiter).map((column) => column.trim());
    const nome = getColumn(columns, indexes.nome);

    if (!nome) {
      continue;
    }

    const diasUteisLinha = parseLocalizedNumber(getColumn(columns, indexes.diasUteis));

    if (diasUteisLinha > 0) {
      diasUteisValues.push(diasUteisLinha);
    }

    rawRows.push({
      id: `${lineIndex + 1}-${nome}`,
      nome,
      totalNormaisMin: parseDurationToMinutes(getColumn(columns, indexes.totalNormais)),
      totalNoturnoMin: parseDurationToMinutes(getColumn(columns, indexes.totalNoturno)),
      diaFalta: toAbsenceCount(getColumn(columns, indexes.diaFalta)),
      faltaEAtrasoMin: parseDurationToMinutes(getColumn(columns, indexes.faltaEAtraso)),
      abonoMin: parseDurationToMinutes(getColumn(columns, indexes.abono)),
      extra100DMin: parseDurationToMinutes(getColumn(columns, indexes.extra100D)),
      extraDiurnaMin: parseDurationToMinutes(getColumn(columns, indexes.extraDiurna)),
      extraNoturnaMin: parseDurationToMinutes(getColumn(columns, indexes.extraNoturna)),
      bancoTotalMin: parseDurationToMinutes(getColumn(columns, indexes.bancoTotal)),
      bancoSaldoMin: parseDurationToMinutes(getColumn(columns, indexes.bancoSaldo))
    });
  }

  if (indexes.diasUteis < 0) {
    warnings.push("CSV sem coluna de dias uteis. Aplicado valor padrao de 26 dias.");
  }

  const diasUteis =
    diasUteisValues.length > 0
      ? roundTwo(diasUteisValues.reduce((sum, value) => sum + value, 0) / diasUteisValues.length)
      : DEFAULT_WORK_DAYS;

  return { rawRows, diasUteis };
}

export function emptyReport(warnings: string[], sourceFile: string | null): RhidReportData {
  const emptyLists: RhidLists = {
    maisAtrasos: [],
    comFaltas: [],
    maisHorasExtras: []
  };

  return {
    sourceFile,
    processedRows: [],
    lists: emptyLists,
    summary: buildSummary([], emptyLists, DEFAULT_WORK_DAYS),
    warnings
  };
}

export async function loadRhidReportData(): Promise<RhidReportData> {
  const warnings: string[] = [];
  const sourceFile = await resolveCsvPath();

  if (!sourceFile) {
    warnings.push("Arquivo RHiD nao encontrado. Defina RHID_CSV_PATH para um CSV valido.");
    return emptyReport(warnings, null);
  }

  try {
    const buffer = await readFile(sourceFile);
    const content = decodeCsv(buffer);
    const { rawRows, diasUteis } = parseRawRows(content, warnings);
    const processedRows = processRows(rawRows, diasUteis);
    const lists = buildLists(processedRows);

    return {
      sourceFile,
      processedRows,
      lists,
      summary: buildSummary(processedRows, lists, diasUteis),
      warnings
    };
  } catch (error) {
    console.error("Falha ao carregar CSV RHiD:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    warnings.push(`Falha de leitura do CSV RHiD: ${errorMessage}`);
    return emptyReport(warnings, sourceFile);
  }
}
