import {
  loadRhidApuracao,
  loadRhidDirectoryData,
  getEffectiveRhidToken,
  isTokenExpired,
  type RhidDirectoryData,
  type RhidPersonDTO,
  type RhidApuracaoResult,
} from "@/lib/rhid-api";
import { persistRhidReport, readPersistedRhidReport } from "@/lib/rhid-report-db";
import {
  type RhidAnalyticalSummary,
  type RhidLists,
  type RhidProcessedRow,
  type RhidRawRow,
  type RhidReportData,
} from "@/lib/types";

const DEFAULT_WORK_DAYS = 26;
const VALE_REFEICAO_BASE = 15.82;
const VALE_REFEICAO_PERCENT = 0.2;
const DEFAULT_APURACAO_CONCURRENCY = 1;
const MIN_APURACAO_CONCURRENCY = 1;
const MAX_APURACAO_CONCURRENCY = 10;
const DEFAULT_APURACAO_CHUNK_DAYS = 5;
const MIN_APURACAO_CHUNK_DAYS = 1;
const MAX_APURACAO_CHUNK_DAYS = 31;
const DEFAULT_APURACAO_TIMEOUT_MS = 20_000;
const MAX_APURACAO_TIMEOUT_MS = 120_000;
const DEFAULT_APURACAO_TOTAL_TIMEOUT_MS = 0;
const MAX_APURACAO_TOTAL_TIMEOUT_MS = 300_000;
const DEFAULT_APURACAO_MAX_FAILURES = 0;
const MAX_APURACAO_MAX_FAILURES = 500;
const DEFAULT_REPORT_CACHE_TTL_SEC = 300;
const DEFAULT_ACTIVE_PERSON_STATUSES = [1];

interface ReportPeriod {
  dataIni: string;
  dataFinal: string;
  diasUteis: number;
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

interface ReportInFlightEntry {
  cacheKey: string;
  promise: Promise<RhidReportData>;
}

let reportCache: ReportCacheEntry | null = null;
let reportInFlight: ReportInFlightEntry | null = null;

// ─── Helpers numéricos ────────────────────────────────────────────────────────

function roundTwo(value: number): number {
  return Number(value.toFixed(2));
}

function parseDateInput(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function countBusinessDays(start: Date, end: Date): number {
  const first = new Date(start);
  const last = new Date(end);
  if (first.getTime() > last.getTime()) return 0;
  let businessDays = 0;
  for (
    let cursor = new Date(first);
    cursor.getTime() <= last.getTime();
    cursor.setDate(cursor.getDate() + 1)
  ) {
    // Segunda a sábado (0 = domingo)
    if (cursor.getDay() !== 0) businessDays += 1;
  }
  return businessDays;
}

// ─── Período ──────────────────────────────────────────────────────────────────

function resolvePeriod(overrideIni?: string, overrideFinal?: string): ReportPeriod {
  const now = new Date();
  // Padrão: dia 21 do mês anterior ao dia 20 do mês atual
  const prevMonthIdx = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const prevMonthYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const defaultStart = new Date(prevMonthYear, prevMonthIdx, 21);
  const defaultEnd = new Date(now.getFullYear(), now.getMonth(), 20);
  const configuredStart = parseDateInput((overrideIni ?? process.env.RHID_DATA_INI ?? "").trim());
  const configuredEnd = parseDateInput((overrideFinal ?? process.env.RHID_DATA_FINAL ?? "").trim());
  const periodStart = configuredStart ?? defaultStart;
  const periodEnd = configuredEnd ?? defaultEnd;

  const start =
    periodStart.getTime() <= periodEnd.getTime() ? periodStart : periodEnd;
  const end =
    periodStart.getTime() <= periodEnd.getTime() ? periodEnd : periodStart;

  const configuredDays = Number((process.env.RHID_DIAS_UTEIS ?? "").trim());
  const diasUteis =
    Number.isFinite(configuredDays) && configuredDays > 0
      ? roundTwo(configuredDays)
      : countBusinessDays(start, end) || DEFAULT_WORK_DAYS;

  return {
    dataIni: toDateInput(start),
    dataFinal: toDateInput(end),
    diasUteis,
  };
}

// ─── Configurações via env ────────────────────────────────────────────────────

function shouldFetchApuracao(): boolean {
  const raw = (process.env.RHID_FETCH_APURACAO ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

function getApuracaoConcurrency(): number {
  const raw = Number((process.env.RHID_APURACAO_CONCURRENCY ?? "").trim());
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_APURACAO_CONCURRENCY;
  return Math.max(
    MIN_APURACAO_CONCURRENCY,
    Math.min(MAX_APURACAO_CONCURRENCY, Math.floor(raw))
  );
}

function getApuracaoChunkDays(): number {
  const raw = Number((process.env.RHID_APURACAO_CHUNK_DAYS ?? "").trim());
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_APURACAO_CHUNK_DAYS;
  return Math.max(
    MIN_APURACAO_CHUNK_DAYS,
    Math.min(MAX_APURACAO_CHUNK_DAYS, Math.floor(raw))
  );
}

function getApuracaoTimeoutMs(): number {
  const raw = Number((process.env.RHID_APURACAO_TIMEOUT_MS ?? "").trim());
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_APURACAO_TIMEOUT_MS;
  return Math.max(1_000, Math.min(MAX_APURACAO_TIMEOUT_MS, Math.floor(raw)));
}

function getApuracaoTotalTimeoutMs(): number {
  const raw = Number(
    (process.env.RHID_APURACAO_TOTAL_TIMEOUT_MS ?? "").trim()
  );
  if (!Number.isFinite(raw)) return DEFAULT_APURACAO_TOTAL_TIMEOUT_MS;
  if (raw <= 0) return 0;
  return Math.max(
    1_000,
    Math.min(MAX_APURACAO_TOTAL_TIMEOUT_MS, Math.floor(raw))
  );
}

function getApuracaoMaxFailures(): number {
  const raw = Number((process.env.RHID_APURACAO_MAX_FAILURES ?? "").trim());
  if (!Number.isFinite(raw)) return DEFAULT_APURACAO_MAX_FAILURES;
  if (raw <= 0) return 0;
  return Math.max(1, Math.min(MAX_APURACAO_MAX_FAILURES, Math.floor(raw)));
}

function getReportCacheTtlMs(): number {
  const raw = Number((process.env.RHID_REPORT_CACHE_TTL_SEC ?? "").trim());
  const seconds =
    Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REPORT_CACHE_TTL_SEC;
  return Math.max(10, Math.floor(seconds)) * 1000;
}

function getActivePersonStatuses(): number[] {
  const raw = (process.env.RHID_ACTIVE_PERSON_STATUSES ?? "").trim();
  const candidates = (raw || DEFAULT_ACTIVE_PERSON_STATUSES.join(","))
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v))
    .map((v) => Math.floor(v));
  if (candidates.length === 0) return [...DEFAULT_ACTIVE_PERSON_STATUSES];
  return Array.from(new Set(candidates)).sort((a, b) => a - b);
}

function getReportCacheKey(period: ReportPeriod): string {
  const token = getEffectiveRhidToken().trim();
  return JSON.stringify({
    token,
    dataIni: period.dataIni,
    dataFinal: period.dataFinal,
    diasUteis: period.diasUteis,
    fetchApuracao: shouldFetchApuracao(),
    chunkDays: getApuracaoChunkDays(),
    concurrency: getApuracaoConcurrency(),
    activeStatuses: getActivePersonStatuses(),
  });
}

// ─── Filtro de ativos ─────────────────────────────────────────────────────────

function resolvePersonStatus(person: RhidPersonDTO): number | null {
  const statusValue = person.status as unknown;
  if (typeof statusValue === "number" && Number.isFinite(statusValue))
    return Math.floor(statusValue);
  if (typeof statusValue === "string") {
    const parsed = Number(statusValue.trim());
    return Number.isFinite(parsed) ? Math.floor(parsed) : null;
  }
  return null;
}

function filterActivePeople(people: RhidPersonDTO[]): {
  activePeople: RhidPersonDTO[];
  inactiveCount: number;
  missingStatusCount: number;
} {
  const activeStatuses = new Set<number>(getActivePersonStatuses());
  let inactiveCount = 0;
  let missingStatusCount = 0;

  const activePeople = people.filter((person) => {
    const status = resolvePersonStatus(person);
    if (status === null) {
      missingStatusCount += 1;
      return false;
    }
    if (!activeStatuses.has(status)) {
      inactiveCount += 1;
      return false;
    }
    return true;
  });

  return { activePeople, inactiveCount, missingStatusCount };
}

// ─── CORREÇÃO PRINCIPAL: extração de métricas dos dias apurados ───────────────

/**
 * Recebe o resultado de `loadRhidApuracao` (que contém `dias: RhidDiaApuracaoDTO[]`)
 * e soma os campos relevantes de cada dia para montar as métricas brutas do colaborador.
 *
 * Todos os campos de tempo no DTO já estão em **minutos inteiros**.
 */
function extractMetricsFromApuracao(
  result: RhidApuracaoResult
): Partial<{
  totalNormaisMin: number;
  totalNoturnoMin: number;
  diaFalta: number;
  faltaEAtrasoMin: number;
  abonoMin: number;
  extra100DMin: number;
  extraDiurnaMin: number;
  extraNoturnaMin: number;
  bancoTotalMin: number;
  bancoSaldoMin: number;
  semEscala: boolean;
  quantidadeAtrasos: number;
}> {
  const dias = result.dias;

  if (!dias || dias.length === 0) {
    return { semEscala: true };
  }

  const semEscala = dias.every(
    (dia) => !dia.idHorarioContratual || dia.idHorarioContratual === -1
  );

  let totalNormaisMin = 0;
  let totalNoturnoMin = 0;
  let diaFalta = 0;
  let faltaEAtrasoMin = 0;
  let abonoMin = 0;
  let extra100DMin = 0;
  let extraDiurnaMin = 0;
  let extraNoturnaMin = 0;
  let bancoSaldoMin = 0;
  let quantidadeAtrasos = 0;

  for (const dia of dias) {
    totalNormaisMin += dia.horasDiurnasNaoExtra ?? 0;
    totalNoturnoMin += dia.horasNoturnasNaoExtra ?? 0;

    // Faltas: dia inteiro, exceto folga programada com neutro=true
    if (dia.faltaDiaInteiro === true && !(dia.folga === true && dia.neutro === true)) {
      diaFalta += 1;
    }

    const diaTotalAtraso = (dia.atrasoEntrada ?? 0) + (dia.saidaAntecipada ?? 0) + (dia.horasApenasFalta ?? 0);

    faltaEAtrasoMin += diaTotalAtraso;

    // Conta dias com qualquer minuto de atraso/saída antecipada/falta parcial
    if (diaTotalAtraso > 0 && dia.faltaDiaInteiro !== true) {
      quantidadeAtrasos += 1;
    }

    abonoMin += dia.minutosAbono ?? 0;
    extra100DMin += dia.extraDiurna ?? 0;
    extraNoturnaMin += dia.extraNoturna ?? 0;
    bancoSaldoMin += dia.saldoBancoCredDeb ?? 0;
  }

  const lastDiaWithSaldo = [...dias]
    .reverse()
    .find(
      (dia) =>
        typeof dia.saldoBancoFinalDia === "number" &&
        Number.isFinite(dia.saldoBancoFinalDia)
    );
  const bancoTotalMin = lastDiaWithSaldo?.saldoBancoFinalDia ?? bancoSaldoMin;

  return {
    totalNormaisMin,
    totalNoturnoMin,
    diaFalta,
    faltaEAtrasoMin,
    abonoMin,
    extra100DMin,
    extraDiurnaMin,
    extraNoturnaMin,
    bancoTotalMin,
    bancoSaldoMin,
    semEscala,
    quantidadeAtrasos,
  };
}

// ─── Helpers de linha bruta ───────────────────────────────────────────────────

function baseRawRow(person: RhidPersonDTO, fallbackIndex: number): RhidRawRow {
  const id =
    typeof person.id === "number" && Number.isFinite(person.id)
      ? person.id
      : fallbackIndex + 1;
  const nome =
    typeof person.name === "string" && person.name.trim()
      ? person.name.trim()
      : `Funcionario ${id}`;
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
    bancoSaldoMin: 0,
    semEscala: false,
    quantidadeAtrasos: 0,
  };
}

function mergeRawMetrics(
  base: RhidRawRow,
  metrics: Partial<Omit<RhidRawRow, "id" | "nome">>
): RhidRawRow {
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
    bancoSaldoMin: base.bancoSaldoMin + (metrics.bancoSaldoMin ?? 0),
    semEscala: base.semEscala && (metrics.semEscala ?? true),
    quantidadeAtrasos: base.quantidadeAtrasos + (metrics.quantidadeAtrasos ?? 0),
  };
}

// ─── Timeout helper ───────────────────────────────────────────────────────────

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  if (timeoutMs <= 0) return promise;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout em ${label} apos ${timeoutMs}ms.`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

// ─── Concorrência ─────────────────────────────────────────────────────────────

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  limit: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  if (items.length === 0) return [];
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

// ─── Chunks de período ────────────────────────────────────────────────────────

function splitPeriodIntoChunks(
  period: ReportPeriod,
  chunkDays: number
): ApuracaoChunk[] {
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
      dataFinal: toDateInput(chunkEnd),
    });

    cursor = new Date(chunkEnd);
    cursor.setDate(cursor.getDate() + 1);
  }

  return chunks;
}

// ─── Build das linhas brutas (CORRIGIDO) ──────────────────────────────────────

async function buildRawRows(
  people: RhidPersonDTO[],
  token: string | null,
  period: ReportPeriod,
  warnings: string[],
  onProgress?: (current: number, total: number) => void
): Promise<RhidRawRow[]> {
  const fetchApuracao = shouldFetchApuracao();
  const apuracaoConcurrency = getApuracaoConcurrency();
  const chunkDays = getApuracaoChunkDays();
  const apuracaoTimeoutMs = getApuracaoTimeoutMs();
  const apuracaoTotalTimeoutMs = getApuracaoTotalTimeoutMs();
  const apuracaoMaxFailures = getApuracaoMaxFailures();
  const chunks = splitPeriodIntoChunks(period, chunkDays);

  if (!fetchApuracao) {
    warnings.push(
      "Consulta de apuracao desativada via RHID_FETCH_APURACAO=false. Metricas virao zeradas."
    );
    return people.map((person, index) => baseRawRow(person, index));
  }

  if (!token) {
    warnings.push("Token RHID indisponivel para consultar apuracao.");
    return people.map((person, index) => baseRawRow(person, index));
  }

  if (chunks.length > 1) {
    warnings.push(
      `Consulta de apuracao segmentada em ${chunks.length} janelas de ate ${chunkDays} dias (RHID_APURACAO_CHUNK_DAYS=${chunkDays}).`
    );
  }

  if (apuracaoConcurrency <= 1) {
    warnings.push(
      "Consulta de apuracao em modo sequencial (RHID_APURACAO_CONCURRENCY=1) para evitar bloqueio."
    );
  }

  let apuracaoFailures = 0;
  let apuracaoStopped = false;
  let stopReason: string | null = null;
  const startedAt = Date.now();

  function shouldStopApuracao(): boolean {
    if (apuracaoStopped) return true;
    const elapsedMs = Date.now() - startedAt;
    if (apuracaoTotalTimeoutMs > 0 && elapsedMs >= apuracaoTotalTimeoutMs) {
      apuracaoStopped = true;
      stopReason = `Tempo limite total da apuracao atingido (${apuracaoTotalTimeoutMs}ms).`;
      return true;
    }
    return false;
  }

  const rows = await mapWithConcurrency(
    people,
    apuracaoConcurrency,
    async (person, index) => {
      let row = baseRawRow(person, index);

      if (
        shouldStopApuracao() ||
        typeof person.id !== "number" ||
        !Number.isFinite(person.id)
      ) {
        return row;
      }

      console.log(
        `[RHiD][APURACAO] Processando ${index + 1}/${people.length}: ${row.nome} (idPerson=${person.id})`
      );

      for (const chunk of chunks) {
        if (shouldStopApuracao()) break;

        try {
          // ✅ CORREÇÃO: passa person.id (idPerson) corretamente
          const apuracaoResult = await withTimeout(
            loadRhidApuracao(
              {
                idPerson: person.id,
                dataIni: chunk.dataIni,
                dataFinal: chunk.dataFinal,
              },
              token
            ),
            apuracaoTimeoutMs,
            `apuracao de ${row.nome} (${chunk.dataIni} ate ${chunk.dataFinal})`
          );

          // ✅ CORREÇÃO: extrai métricas dos dias, não do objeto wrapper
          const metrics = extractMetricsFromApuracao(apuracaoResult);
          row = mergeRawMetrics(row, metrics);

          console.log(
            `[RHiD][APURACAO] ✓ ${row.nome} | chunk ${chunk.dataIni}..${chunk.dataFinal} | ` +
              `dias=${apuracaoResult.dias.length} faltas=${metrics.diaFalta ?? 0} ` +
              `atrasoMin=${metrics.faltaEAtrasoMin ?? 0} extrasMin=${
                (metrics.extraDiurnaMin ?? 0) + (metrics.extraNoturnaMin ?? 0)
              }`
          );
        } catch (error) {
          apuracaoFailures += 1;
          const message =
            error instanceof Error ? error.message : String(error);

          console.error(
            `[RHiD][APURACAO] ✗ Erro em ${row.nome} (${chunk.dataIni}..${chunk.dataFinal}):`,
            message
          );

          if (apuracaoFailures <= 3) {
            warnings.push(
              `Falha na apuracao de ${row.nome} (${chunk.dataIni} ate ${chunk.dataFinal}): ${message}`
            );
          }

          if (
            apuracaoMaxFailures > 0 &&
            apuracaoFailures >= apuracaoMaxFailures
          ) {
            apuracaoStopped = true;
            stopReason = `Apuracao interrompida apos ${apuracaoFailures} falhas.`;
            break;
          }
        }
      }

      console.log(
        `[RHiD][APURACAO] Concluído ${index + 1}/${people.length}: ${row.nome}`,
        {
          diaFalta: row.diaFalta,
          faltaEAtrasoMin: row.faltaEAtrasoMin,
          extraTotal: row.extra100DMin + row.extraDiurnaMin + row.extraNoturnaMin,
          bancoSaldo: row.bancoSaldoMin,
        }
      );

      onProgress?.(index + 1, people.length);
      return row;
    }
  );

  if (apuracaoStopped && stopReason) {
    warnings.push(stopReason);
  }

  return rows;
}

// ─── Processamento final das linhas ───────────────────────────────────────────

export function processRows(
  rawRows: RhidRawRow[],
  diasUteis: number
): RhidProcessedRow[] {
  return rawRows.map((row) => {
    const faltas = Math.max(0, row.diaFalta);
    const atrasoTotalMin = Math.max(0, row.faltaEAtrasoMin);
    const quantidadeAtrasos = row.quantidadeAtrasos;

    // Horas extras totais
    const horasExtrasTotaisMin = Math.max(
      0,
      row.extra100DMin + row.extraDiurnaMin + row.extraNoturnaMin
    );
    const totalExtrasH = horasExtrasTotaisMin / 60;

    // Regra de extras: < 40h → tudo banco; ≥ 40h → paga 10h; ≥ 50h → paga 20h
    let horasExtrasPagarMin = 0;
    if (totalExtrasH >= 50) {
      horasExtrasPagarMin = 20 * 60;
    } else if (totalExtrasH >= 40) {
      horasExtrasPagarMin = 10 * 60;
    }
    const horasExtrasBancoMin = horasExtrasTotaisMin - horasExtrasPagarMin;

    // Banco de horas: saldo da API + extras que vão pro banco
    // Se atraso > 10h, debita do banco
    let bancoHorasMin = row.bancoSaldoMin + horasExtrasBancoMin;
    if (atrasoTotalMin > 10 * 60) {
      bancoHorasMin -= atrasoTotalMin;
    }

    // Faltas: descontar acima de 1
    const statusFaltas: "DESCONTAR" | "OK" = faltas > 1 ? "DESCONTAR" : "OK";

    const baseDiasVale = Math.max(0, diasUteis - faltas);
    const valorValeRefeicao = roundTwo(
      baseDiasVale * VALE_REFEICAO_BASE * VALE_REFEICAO_PERCENT
    );
    const descontoPorFalta = roundTwo(
      faltas * VALE_REFEICAO_BASE * VALE_REFEICAO_PERCENT
    );
    const valorDesconto = statusFaltas === "DESCONTAR" ? descontoPorFalta : 0;
    const motivoDesconto =
      statusFaltas === "DESCONTAR"
        ? "Faltas acima de 1 no periodo"
        : "Sem desconto";

    return {
      id: row.id,
      nome: row.nome,
      faltas,
      atrasoTotalMin,
      quantidadeAtrasos,
      horasExtrasTotaisMin,
      horasExtrasPagarMin,
      horasExtrasBancoMin,
      bancoHorasMin,
      statusFaltas,
      alertaAtraso: atrasoTotalMin > 5 * 60 ? "ALERTA" : "OK",
      motivoDesconto,
      valorDesconto,
      valorValeRefeicao,
      semEscala: row.semEscala,
    };
  });
}

// ─── Listas e sumário ─────────────────────────────────────────────────────────

function sortByMetric(
  rows: RhidProcessedRow[],
  getter: (row: RhidProcessedRow) => number
): RhidProcessedRow[] {
  return [...rows].sort((a, b) => {
    const diff = getter(b) - getter(a);
    if (diff !== 0) return diff;
    return a.nome.localeCompare(b.nome, "pt-BR");
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
    ),
  };
}

function pickTop(rows: RhidProcessedRow[]): RhidProcessedRow | null {
  return rows[0] ?? null;
}

export function buildSummary(
  rows: RhidProcessedRow[],
  lists: RhidLists,
  diasUteis: number
): RhidAnalyticalSummary {
  return {
    totalColaboradores: rows.length,
    totalFaltas: roundTwo(rows.reduce((sum, r) => sum + r.faltas, 0)),
    totalAtrasoMin: rows.reduce((sum, r) => sum + r.atrasoTotalMin, 0),
    totalHorasExtrasMin: rows.reduce(
      (sum, r) => sum + r.horasExtrasTotaisMin,
      0
    ),
    totalValeRefeicao: roundTwo(
      rows.reduce((sum, r) => sum + r.valorValeRefeicao, 0)
    ),
    totalValorDesconto: roundTwo(
      rows.reduce((sum, r) => sum + r.valorDesconto, 0)
    ),
    totalBancoHorasMin: rows.reduce((sum, r) => sum + r.bancoHorasMin, 0),
    colaboradoresComFaltas: rows.filter((r) => r.faltas > 0).length,
    colaboradoresComDesconto: rows.filter(
      (r) => r.statusFaltas === "DESCONTAR"
    ).length,
    colaboradoresComValorDesconto: rows.filter((r) => r.valorDesconto > 0)
      .length,
    colaboradoresComAlertaAtraso: rows.filter(
      (r) => r.alertaAtraso === "ALERTA"
    ).length,
    maiorAtraso: pickTop(lists.maisAtrasos),
    maiorFaltas: pickTop(
      sortByMetric(rows, (r) => r.faltas).filter((r) => r.faltas > 0)
    ),
    maiorHorasExtras: pickTop(lists.maisHorasExtras),
    diasUteisConsiderados: diasUteis,
    regraValeRefeicao: "(Dias uteis - faltas) x 15,82 x 20%",
  };
}

export function emptyReport(
  warnings: string[],
  sourceFile: string | null
): RhidReportData {
  const emptyLists: RhidLists = {
    maisAtrasos: [],
    comFaltas: [],
    maisHorasExtras: [],
  };
  return {
    sourceFile,
    processedRows: [],
    lists: emptyLists,
    summary: buildSummary([], emptyLists, DEFAULT_WORK_DAYS),
    warnings,
  };
}

// ─── Entry point ──────────────────────────────────────────────────────────────

interface LoadRhidReportOptions {
  forceRefresh?: boolean;
  prefetchedDirectoryData?: RhidDirectoryData;
  dataIni?: string;
  dataFinal?: string;
  onProgress?: (current: number, total: number) => void;
}

export async function loadRhidReportData(
  options?: LoadRhidReportOptions
): Promise<RhidReportData> {
  const period = resolvePeriod(options?.dataIni, options?.dataFinal);
  const cacheKey = getReportCacheKey(period);
  const now = Date.now();
  const ttlMs = getReportCacheTtlMs();
  const token = getEffectiveRhidToken().trim();
  const expiredToken = token ? isTokenExpired(token) : false;

  if (
    !options?.forceRefresh &&
    !expiredToken &&
    reportCache &&
    reportCache.cacheKey === cacheKey &&
    reportCache.expiresAtMs > now
  ) {
    return reportCache.data;
  }

  if (reportInFlight && reportInFlight.cacheKey === cacheKey) {
    return reportInFlight.promise;
  }

  if (!options?.forceRefresh) {
    const persisted = expiredToken
      ? null
      : await readPersistedRhidReport(cacheKey);

    if (persisted && persisted.expiresAtMs > now) {
      reportCache = {
        cacheKey,
        data: persisted.data,
        expiresAtMs: persisted.expiresAtMs,
      };
      return persisted.data;
    }
  }

  const runningPromise = (async () => {
    console.log("[RHiD][LOAD] Iniciando carregamento do relatório de apuração");

    const directoryData =
      options?.prefetchedDirectoryData ?? (await loadRhidDirectoryData());
    const { people, warnings: apiWarnings, token: directoryToken } = directoryData;

    console.log(
      `[RHiD][LOAD] Diretório carregado: ${people.length} colaboradores`
    );

    const warnings = [...apiWarnings];
    const { activePeople, inactiveCount, missingStatusCount } =
      filterActivePeople(people);

    console.log(
      `[RHiD][LOAD] Ativos para apuração: ${activePeople.length} colaboradores`
    );

    warnings.push(
      `Periodo de apuracao: ${period.dataIni} ate ${period.dataFinal}.`
    );
    warnings.push(
      `Filtro de ativos: ${activePeople.length} de ${people.length} colaboradores (status ativos: ${getActivePersonStatuses().join(", ")}).`
    );
    if (inactiveCount > 0)
      warnings.push(
        `${inactiveCount} colaboradores ignorados por status inativo.`
      );
    if (missingStatusCount > 0)
      warnings.push(
        `${missingStatusCount} colaboradores ignorados por status ausente/invalido.`
      );

    if (activePeople.length === 0) {
      console.warn("[RHiD][LOAD] Nenhum colaborador ativo encontrado");
      const empty = emptyReport(warnings, "RHiD API");
      const expiresAtMs = Date.now() + ttlMs;
      reportCache = { cacheKey, data: empty, expiresAtMs };
      try {
        await persistRhidReport(cacheKey, empty, expiresAtMs);
      } catch (error) {
        console.error("[RHiD][DB] Falha ao persistir relatorio vazio", error);
      }
      return empty;
    }

    console.log(
      `[RHiD][LOAD] Iniciando apuração de ${activePeople.length} colaboradores...`
    );

    const rawRows = await buildRawRows(
      activePeople,
      directoryToken,
      period,
      warnings,
      options?.onProgress
    );

    console.log("[RHiD][LOAD] Apuração concluída. Processando métricas...");

    const processedRows = processRows(rawRows, period.diasUteis);
    const lists = buildLists(processedRows);
    const report: RhidReportData = {
      sourceFile: "RHiD API",
      processedRows,
      lists,
      summary: buildSummary(processedRows, lists, period.diasUteis),
      warnings,
    };

    console.log("[RHiD][LOAD] Relatório concluído", {
      totalColaboradores: processedRows.length,
      comFaltas: report.summary.colaboradoresComFaltas,
      comAtraso: report.summary.colaboradoresComAlertaAtraso,
      comExtras: lists.maisHorasExtras.length,
    });

    const expiresAtMs = Date.now() + ttlMs;
    reportCache = { cacheKey, data: report, expiresAtMs };

    try {
      await persistRhidReport(cacheKey, report, expiresAtMs);
    } catch (error) {
      console.error("[RHiD][DB] Falha ao persistir relatorio", error);
    }

    return report;
  })();

  reportInFlight = { cacheKey, promise: runningPromise };

  try {
    return await runningPromise;
  } finally {
    if (reportInFlight?.promise === runningPromise) {
      reportInFlight = null;
    }
  }
}