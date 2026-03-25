import {
  loadRhidApuracao,
  loadRhidDirectoryData,
  type RhidPersonDTO
} from "@/lib/rhid-api";
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
const DEFAULT_APURACAO_CONCURRENCY = 1;
const MIN_APURACAO_CONCURRENCY = 1;
const MAX_APURACAO_CONCURRENCY = 4;
const DEFAULT_APURACAO_CHUNK_DAYS = 5;
const MIN_APURACAO_CHUNK_DAYS = 1;
const MAX_APURACAO_CHUNK_DAYS = 31;
const DEFAULT_APURACAO_TIMEOUT_MS = 20_000;
const MAX_APURACAO_TIMEOUT_MS = 120_000;
const DEFAULT_REPORT_CACHE_TTL_SEC = 300;

interface ReportPeriod {
  dataIni: string;
  dataFinal: string;
  diasUteis: number;
}

interface ScalarLeaf {
  normalizedKey: string;
  value: unknown;
}

interface ApuracaoChunk {
  dataIni: string;
  dataFinal: string;
}

interface ReportCacheEntry {
  cacheKey: string;
  data: RhidReportData;
  expiresAtMs: number;
}

type RawMetricKey = Omit<RhidRawRow, "id" | "nome">;
type RawMetricName = keyof RawMetricKey;
type MetricKind = "minutes" | "number";

let reportCache: ReportCacheEntry | null = null;

const METRIC_ALIASES: Record<RawMetricName, { aliases: string[]; kind: MetricKind }> = {
  totalNormaisMin: {
    aliases: ["totalnormais", "horasnormais", "horanormal", "normais"],
    kind: "minutes"
  },
  totalNoturnoMin: {
    aliases: ["totalnoturno", "horasnoturnas", "horanoturna", "noturno"],
    kind: "minutes"
  },
  diaFalta: {
    aliases: ["diafalta", "totalfaltas", "faltas", "falta"],
    kind: "number"
  },
  faltaEAtrasoMin: {
    aliases: ["faltaeatraso", "atrasototal", "atraso"],
    kind: "minutes"
  },
  abonoMin: {
    aliases: ["abono", "abonohoras"],
    kind: "minutes"
  },
  extra100DMin: {
    aliases: ["extra100d", "extra100", "horasextra100", "horaextra100"],
    kind: "minutes"
  },
  extraDiurnaMin: {
    aliases: ["extradiurna", "horaextradiurna", "horasextras50", "extra50"],
    kind: "minutes"
  },
  extraNoturnaMin: {
    aliases: ["extranoturna", "horaextranoturna"],
    kind: "minutes"
  },
  bancoTotalMin: {
    aliases: ["bancototal", "totalbanco", "banco"],
    kind: "minutes"
  },
  bancoSaldoMin: {
    aliases: ["bancosaldo", "saldobanco", "saldo"],
    kind: "minutes"
  }
};

function roundTwo(value: number): number {
  return Number(value.toFixed(2));
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

function parseDateInput(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function countBusinessDays(start: Date, end: Date): number {
  const first = new Date(start);
  const last = new Date(end);

  if (first.getTime() > last.getTime()) {
    return 0;
  }

  let businessDays = 0;

  for (let cursor = new Date(first); cursor.getTime() <= last.getTime(); cursor.setDate(cursor.getDate() + 1)) {
    const day = cursor.getDay();

    if (day !== 0 && day !== 6) {
      businessDays += 1;
    }
  }

  return businessDays;
}

function resolvePeriod(): ReportPeriod {
  const now = new Date();
  const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const configuredStart = parseDateInput((process.env.RHID_DATA_INI ?? "").trim());
  const configuredEnd = parseDateInput((process.env.RHID_DATA_FINAL ?? "").trim());
  const periodStart = configuredStart ?? defaultStart;
  const periodEnd = configuredEnd ?? now;

  const start = periodStart.getTime() <= periodEnd.getTime() ? periodStart : periodEnd;
  const end = periodStart.getTime() <= periodEnd.getTime() ? periodEnd : periodStart;
  const configuredDays = Number((process.env.RHID_DIAS_UTEIS ?? "").trim());
  const diasUteis =
    Number.isFinite(configuredDays) && configuredDays > 0
      ? roundTwo(configuredDays)
      : countBusinessDays(start, end) || DEFAULT_WORK_DAYS;

  return {
    dataIni: toDateInput(start),
    dataFinal: toDateInput(end),
    diasUteis
  };
}

function asScalar(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  return null;
}

function collectScalarLeaves(source: unknown, keyPath: string, leaves: ScalarLeaf[], depth: number): void {
  if (depth > 8) {
    return;
  }

  const scalar = asScalar(source);

  if (scalar !== null) {
    leaves.push({
      normalizedKey: normalizeHeader(keyPath),
      value: scalar
    });
    return;
  }

  if (Array.isArray(source)) {
    for (const item of source) {
      collectScalarLeaves(item, keyPath, leaves, depth + 1);
    }
    return;
  }

  if (source && typeof source === "object") {
    for (const [key, value] of Object.entries(source)) {
      const childPath = keyPath ? `${keyPath}.${key}` : key;
      collectScalarLeaves(value, childPath, leaves, depth + 1);
    }
  }
}

function parseScalarValue(value: unknown, kind: MetricKind): number {
  if (typeof value === "number") {
    if (kind === "minutes") {
      // Heuristica: valores muito altos geralmente ja estao em minutos.
      return Math.abs(value) > 480 ? Math.round(value) : Math.round(value * 60);
    }

    return value;
  }

  if (typeof value !== "string") {
    return 0;
  }

  return kind === "minutes" ? parseDurationToMinutes(value) : parseLocalizedNumber(value);
}

function sumMetricFromLeaves(leaves: ScalarLeaf[], aliases: string[], kind: MetricKind): number {
  const normalizedAliases = aliases.map(normalizeHeader);
  const exactMatches = leaves.filter((leaf) =>
    normalizedAliases.some((alias) => leaf.normalizedKey === alias || leaf.normalizedKey.endsWith(alias))
  );
  const matches =
    exactMatches.length > 0
      ? exactMatches
      : leaves.filter((leaf) => normalizedAliases.some((alias) => leaf.normalizedKey.includes(alias)));

  return matches.reduce((sum, leaf) => sum + parseScalarValue(leaf.value, kind), 0);
}

function detectDelimiter(headerLine: string): ";" | "," {
  return headerLine.split(";").length >= headerLine.split(",").length ? ";" : ",";
}

function extractMetricsFromCsv(content: string): Partial<RawMetricKey> {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return {};
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = lines[0].split(delimiter).map((header) => normalizeHeader(header));
  const metrics: Partial<RawMetricKey> = {};

  for (const [metricKey, config] of Object.entries(METRIC_ALIASES) as Array<
    [RawMetricName, { aliases: string[]; kind: MetricKind }]
  >) {
    const aliases = config.aliases.map(normalizeHeader);
    const columnIndexes = headers
      .map((header, index) => ({ header, index }))
      .filter(({ header }) => aliases.some((alias) => header === alias || header.includes(alias)))
      .map(({ index }) => index);

    if (columnIndexes.length === 0) {
      continue;
    }

    let sum = 0;

    for (const line of lines.slice(1)) {
      const columns = line.split(delimiter).map((column) => column.trim());

      for (const columnIndex of columnIndexes) {
        sum += parseScalarValue(columns[columnIndex] ?? "", config.kind);
      }
    }

    metrics[metricKey] = sum;
  }

  return metrics;
}

function extractMetricsFromPayload(payload: unknown): Partial<RawMetricKey> {
  if (payload === null || payload === undefined) {
    return {};
  }

  if (typeof payload === "string") {
    const trimmed = payload.trim();

    if (!trimmed) {
      return {};
    }

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return extractMetricsFromPayload(JSON.parse(trimmed));
      } catch {
        return {};
      }
    }

    return extractMetricsFromCsv(trimmed);
  }

  const leaves: ScalarLeaf[] = [];
  collectScalarLeaves(payload, "", leaves, 0);

  const metrics: Partial<RawMetricKey> = {};

  for (const [metricKey, config] of Object.entries(METRIC_ALIASES) as Array<
    [RawMetricName, { aliases: string[]; kind: MetricKind }]
  >) {
    const value = sumMetricFromLeaves(leaves, config.aliases, config.kind);

    if (value !== 0) {
      metrics[metricKey] = value;
    }
  }

  return metrics;
}

function shouldFetchApuracao(): boolean {
  const raw = (process.env.RHID_FETCH_APURACAO ?? "false").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

function getApuracaoConcurrency(): number {
  const raw = Number((process.env.RHID_APURACAO_CONCURRENCY ?? "").trim());

  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_APURACAO_CONCURRENCY;
  }

  return Math.max(MIN_APURACAO_CONCURRENCY, Math.min(MAX_APURACAO_CONCURRENCY, Math.floor(raw)));
}

function getApuracaoChunkDays(): number {
  const raw = Number((process.env.RHID_APURACAO_CHUNK_DAYS ?? "").trim());

  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_APURACAO_CHUNK_DAYS;
  }

  return Math.max(MIN_APURACAO_CHUNK_DAYS, Math.min(MAX_APURACAO_CHUNK_DAYS, Math.floor(raw)));
}

function getApuracaoTimeoutMs(): number {
  const raw = Number((process.env.RHID_APURACAO_TIMEOUT_MS ?? "").trim());

  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_APURACAO_TIMEOUT_MS;
  }

  return Math.max(1_000, Math.min(MAX_APURACAO_TIMEOUT_MS, Math.floor(raw)));
}

function getReportCacheTtlMs(): number {
  const raw = Number((process.env.RHID_REPORT_CACHE_TTL_SEC ?? "").trim());
  const seconds = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REPORT_CACHE_TTL_SEC;
  return Math.max(10, Math.floor(seconds)) * 1000;
}

function getReportCacheKey(period: ReportPeriod): string {
  const token = (process.env.RHID_API_TOKEN ?? process.env.RHID_TOKEN ?? "").trim();

  return JSON.stringify({
    token,
    dataIni: period.dataIni,
    dataFinal: period.dataFinal,
    diasUteis: period.diasUteis,
    fetchApuracao: shouldFetchApuracao(),
    chunkDays: getApuracaoChunkDays(),
    concurrency: getApuracaoConcurrency()
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout em ${label} apos ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function splitPeriodIntoChunks(period: ReportPeriod, chunkDays: number): ApuracaoChunk[] {
  const start = parseDateInput(period.dataIni);
  const end = parseDateInput(period.dataFinal);

  if (!start || !end || start.getTime() > end.getTime()) {
    return [{ dataIni: period.dataIni, dataFinal: period.dataFinal }];
  }

  const chunks: ApuracaoChunk[] = [];
  let cursor = new Date(start);

  while (cursor.getTime() <= end.getTime()) {
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + chunkDays - 1);

    if (chunkEnd.getTime() > end.getTime()) {
      chunkEnd.setTime(end.getTime());
    }

    chunks.push({
      dataIni: toDateInput(chunkStart),
      dataFinal: toDateInput(chunkEnd)
    });

    cursor = new Date(chunkEnd);
    cursor.setDate(cursor.getDate() + 1);
  }

  return chunks;
}

function baseRawRow(person: RhidPersonDTO, fallbackIndex: number): RhidRawRow {
  const id =
    typeof person.id === "number" && Number.isFinite(person.id)
      ? person.id
      : fallbackIndex + 1;

  const nome = typeof person.name === "string" && person.name.trim() ? person.name.trim() : `Funcionario ${id}`;

  return {
    id: String(id),
    nome,
    totalNormaisMin: 0,
    totalNoturnoMin: 0,
    diaFalta: 0,
    faltaEAtrasoMin: 0,
    abonoMin: 0,
    extra100DMin: 0,
    extraDiurnaMin: 0,
    extraNoturnaMin: 0,
    bancoTotalMin: 0,
    bancoSaldoMin: 0
  };
}

function mergeRawMetrics(base: RhidRawRow, metrics: Partial<RawMetricKey>): RhidRawRow {
  return {
    ...base,
    totalNormaisMin: base.totalNormaisMin + (metrics.totalNormaisMin ?? 0),
    totalNoturnoMin: base.totalNoturnoMin + (metrics.totalNoturnoMin ?? 0),
    diaFalta: base.diaFalta + (metrics.diaFalta ?? 0),
    faltaEAtrasoMin: base.faltaEAtrasoMin + (metrics.faltaEAtrasoMin ?? 0),
    abonoMin: base.abonoMin + (metrics.abonoMin ?? 0),
    extra100DMin: base.extra100DMin + (metrics.extra100DMin ?? 0),
    extraDiurnaMin: base.extraDiurnaMin + (metrics.extraDiurnaMin ?? 0),
    extraNoturnaMin: base.extraNoturnaMin + (metrics.extraNoturnaMin ?? 0),
    bancoTotalMin: base.bancoTotalMin + (metrics.bancoTotalMin ?? 0),
    bancoSaldoMin: base.bancoSaldoMin + (metrics.bancoSaldoMin ?? 0)
  };
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  limit: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }

  const results = new Array<TOutput>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function buildRawRows(
  people: RhidPersonDTO[],
  token: string | null,
  period: ReportPeriod,
  warnings: string[]
): Promise<RhidRawRow[]> {
  const fetchApuracao = shouldFetchApuracao();
  const apuracaoConcurrency = getApuracaoConcurrency();
  const chunkDays = getApuracaoChunkDays();
  const apuracaoTimeoutMs = getApuracaoTimeoutMs();
  const chunks = splitPeriodIntoChunks(period, chunkDays);

  if (!fetchApuracao) {
    warnings.push("Consulta de apuracao desativada via RHID_FETCH_APURACAO=false. Metricas virao zeradas.");
    return people.map((person, index) => baseRawRow(person, index));
  }

  if (!token) {
    warnings.push("Token RHID indisponivel para consultar apuracao.");
    return people.map((person, index) => baseRawRow(person, index));
  }

  if (chunks.length > 1) {
    warnings.push(
      `Consulta de apuracao segmentada em ${chunks.length} janelas de ate ${chunkDays} dias (RHID_APURACAO_CHUNK_DAYS=${chunkDays}) para reduzir timeout da API.`
    );
  }

  if (apuracaoConcurrency <= 1) {
    warnings.push("Consulta de apuracao em modo sequencial (RHID_APURACAO_CONCURRENCY=1) para evitar bloqueio.");
  }

  let apuracaoFailures = 0;

  return mapWithConcurrency(people, apuracaoConcurrency, async (person, index) => {
    let row = baseRawRow(person, index);

    if (typeof person.id !== "number" || !Number.isFinite(person.id)) {
      return row;
    }

    for (const chunk of chunks) {
      try {
        const payload = await withTimeout(
          loadRhidApuracao(
            {
              idPerson: person.id,
              dataIni: chunk.dataIni,
              dataFinal: chunk.dataFinal
            },
            token
          ),
          apuracaoTimeoutMs,
          `apuracao de ${row.nome} (${chunk.dataIni} ate ${chunk.dataFinal})`
        );
        const parsed = extractMetricsFromPayload(payload);
        row = mergeRawMetrics(row, parsed);
      } catch (error) {
        apuracaoFailures += 1;

        if (apuracaoFailures <= 3) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push(
            `Falha na apuracao do colaborador ${row.nome} (${chunk.dataIni} ate ${chunk.dataFinal}): ${message}`
          );
        }
      }
    }

    return row;
  });
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

export async function loadRhidReportData(options?: { forceRefresh?: boolean }): Promise<RhidReportData> {
  const period = resolvePeriod();
  const cacheKey = getReportCacheKey(period);
  const now = Date.now();

  if (!options?.forceRefresh && reportCache && reportCache.cacheKey === cacheKey && reportCache.expiresAtMs > now) {
    return reportCache.data;
  }

  const { people, warnings: apiWarnings, token } = await loadRhidDirectoryData();
  const warnings = [...apiWarnings];

  warnings.push(`Periodo de apuracao: ${period.dataIni} ate ${period.dataFinal}.`);

  if (people.length === 0) {
    const empty = emptyReport(warnings, "RHiD API");

    reportCache = {
      cacheKey,
      data: empty,
      expiresAtMs: now + getReportCacheTtlMs()
    };

    return empty;
  }

  const rawRows = await buildRawRows(people, token, period, warnings);
  const processedRows = processRows(rawRows, period.diasUteis);
  const lists = buildLists(processedRows);
  const report: RhidReportData = {
    sourceFile: "RHiD API",
    processedRows,
    lists,
    summary: buildSummary(processedRows, lists, period.diasUteis),
    warnings
  };

  reportCache = {
    cacheKey,
    data: report,
    expiresAtMs: now + getReportCacheTtlMs()
  };

  return report;
}
