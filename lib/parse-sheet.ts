import path from "node:path";
import { access, readFile } from "node:fs/promises";

import { FIELD_ORDER } from "@/lib/fields";
import { type PayrollRow } from "@/lib/types";

const RHID_DAYS_DEFAULT = 26;
const RHID_CANDIDATES: string[] = [
  process.env.RHID_CSV_PATH ?? "",
  path.join(process.cwd(), "relatorio_2026311_1914.CSV"),
  "/home/augusto/Downloads/relatorio_2026311_1914.CSV"
].filter((candidate) => candidate.trim().length > 0);

const LEGACY_FILE = "VARIAVEIS DA FOLHA - FILIAL 01 - Copia.csv.xls";

function decodeSpreadsheet(buffer: Buffer): string {
  const asUtf8 = buffer.toString("utf8");

  if (asUtf8.includes("\uFFFD")) {
    return buffer.toString("latin1");
  }

  return asUtf8;
}

function parseCurrency(value?: string): number {
  if (!value) {
    return 0;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return 0;
  }

  const normalized = trimmed.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}

function fieldCodeFromHeader(header: string): string {
  return header.split("-")[0]?.trim() ?? "";
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

  const normalized =
    trimmed.includes(".") && trimmed.includes(",")
      ? trimmed.replace(/\./g, "").replace(",", ".")
      : trimmed.replace(",", ".");

  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDurationToHours(value?: string): number {
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
    const [hoursPart = "0", minutesPart = "0"] = unsigned.split(":");
    const hours = Number(hoursPart);
    const minutes = Number(minutesPart);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return 0;
    }

    return signal * (Math.abs(hours) + Math.abs(minutes) / 60);
  }

  return signal * parseLocalizedNumber(unsigned);
}

function roundTwo(value: number): number {
  return Number(value.toFixed(2));
}

function detectDelimiter(headerLine: string): ";" | "," {
  const semicolonParts = headerLine.split(";").length;
  const commaParts = headerLine.split(",").length;
  return semicolonParts >= commaParts ? ";" : ",";
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

async function resolveRhidFilePath(): Promise<string | null> {
  for (const filePath of RHID_CANDIDATES) {
    try {
      await access(filePath);
      return filePath;
    } catch {
      continue;
    }
  }

  return null;
}

function emptyValues(): Record<string, number> {
  const values: Record<string, number> = {};

  for (const key of FIELD_ORDER) {
    values[key] = 0;
  }

  return values;
}

function parseRhidRows(content: string): PayrollRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = lines[0].split(delimiter).map((header) => header.trim());

  const nameIndex = indexFromAliases(headers, ["nomedofuncionario", "funcionario", "nome"]);
  const totalNormaisIndex = indexFromAliases(headers, ["totalnormais"]);
  const totalNoturnoIndex = indexFromAliases(headers, ["totalnoturno"]);
  const diaFaltaIndex = indexFromAliases(headers, ["diafalta", "faltas"]);
  const faltaEAtrasoIndex = indexFromAliases(headers, ["faltaeatraso", "atrasototal"]);
  const abonoIndex = indexFromAliases(headers, ["abono"]);
  const extra100Index = indexFromAliases(headers, ["extra100d"]);
  const extraDiurnaIndex = indexFromAliases(headers, ["extradiurna"]);
  const extraNoturnaIndex = indexFromAliases(headers, ["extranoturna"]);
  const bancoTotalIndex = indexFromAliases(headers, ["bancototal"]);
  const bancoSaldoIndex = indexFromAliases(headers, ["bancosaldo", "saldobanco"]);

  if (nameIndex < 0) {
    return [];
  }

  const rows: PayrollRow[] = [];

  for (const [index, line] of lines.slice(1).entries()) {
    const columns = line.split(delimiter).map((column) => column.trim());
    const funcionario = columns[nameIndex] ?? "";

    if (!funcionario) {
      continue;
    }

    const faltas = Math.max(0, parseLocalizedNumber(columns[diaFaltaIndex]));
    const atrasoHoras = Math.max(0, parseDurationToHours(columns[faltaEAtrasoIndex]));
    const abonoHoras = Math.max(0, parseDurationToHours(columns[abonoIndex]));
    const extra100Horas = Math.max(0, parseDurationToHours(columns[extra100Index]));
    const extraDiurnaHoras = Math.max(0, parseDurationToHours(columns[extraDiurnaIndex]));
    const extraNoturnaHoras = Math.max(0, parseDurationToHours(columns[extraNoturnaIndex]));
    const totalNormaisHoras = Math.max(0, parseDurationToHours(columns[totalNormaisIndex]));
    const totalNoturnoHoras = Math.max(0, parseDurationToHours(columns[totalNoturnoIndex]));
    const bancoTotalHoras = parseDurationToHours(columns[bancoTotalIndex]);
    const bancoSaldoHoras = parseDurationToHours(columns[bancoSaldoIndex]);
    const valeRefeicao = roundTwo(Math.max(0, RHID_DAYS_DEFAULT - faltas) * 15.82 * 0.2);
    const valorDesconto = faltas > 2 ? roundTwo(faltas * 15.82 * 0.2) : 0;

    const valores = emptyValues();
    valores["37"] = roundTwo(totalNormaisHoras);
    valores["43"] = roundTwo(faltas);
    valores["44"] = valorDesconto;
    valores["108"] = roundTwo(totalNoturnoHoras);
    valores["3490"] = roundTwo(atrasoHoras);
    valores["206"] = roundTwo(abonoHoras);
    valores["200"] = roundTwo(extra100Horas);
    valores["150"] = roundTwo(extraDiurnaHoras + extraNoturnaHoras);
    valores["226"] = roundTwo(bancoTotalHoras);
    valores["460"] = roundTwo(bancoSaldoHoras);
    valores["325"] = valeRefeicao;

    rows.push({
      id: `rhid-${index + 1}`,
      codigo: `RH${String(index + 1).padStart(5, "0")}`,
      funcionario,
      funcao: "Nao informado",
      tipoProcessamento: "RHiD",
      valores
    });
  }

  return rows;
}

function parseLegacyRows(content: string): PayrollRow[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  const headers = lines[0].split(";").map((header) => header.trim());
  const valueColumns = headers.slice(4).map(fieldCodeFromHeader);

  const rows: PayrollRow[] = [];

  lines.slice(1).forEach((line, index) => {
    const columns = line.split(";");
    const codigo = columns[0]?.trim() ?? "";

    if (!codigo) {
      return;
    }

    const valores = emptyValues();

    valueColumns.forEach((code, valueIndex) => {
      if (!FIELD_ORDER.includes(code)) {
        return;
      }

      const rawValue = columns[valueIndex + 4];
      valores[code] = parseCurrency(rawValue);
    });

    rows.push({
      id: `${codigo}-${index}`,
      codigo,
      funcionario: columns[1]?.trim() ?? "",
      funcao: columns[2]?.trim() ?? "",
      tipoProcessamento: columns[3]?.trim() ?? "0",
      valores
    });
  });

  return rows;
}

export async function loadPayrollRows(): Promise<PayrollRow[]> {
  try {
    const rhidPath = await resolveRhidFilePath();

    if (rhidPath) {
      const rhidBuffer = await readFile(rhidPath);
      const rhidContent = decodeSpreadsheet(rhidBuffer);
      return parseRhidRows(rhidContent);
    }

    const legacyPath = path.join(process.cwd(), LEGACY_FILE);
    const legacyBuffer = await readFile(legacyPath);
    const legacyContent = decodeSpreadsheet(legacyBuffer);
    return parseLegacyRows(legacyContent);
  } catch (error) {
    console.error("Falha ao carregar a planilha de folha:", error);
    return [];
  }
}
