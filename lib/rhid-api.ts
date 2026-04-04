// ─── Constantes de configuração ──────────────────────────────────────────────

const DEFAULT_BASE_URL = "https://www.rhid.com.br/v2/api.svc";
const DEFAULT_LOGIN_PATH = "login";
const DEFAULT_PAGE_LENGTH = 100;
const MIN_PAGE_LENGTH = 20;
const MAX_PAGE_LENGTH = 100;
const DEFAULT_CACHE_TTL_SEC = 120;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 800;
const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 10_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 180_000;
const DEFAULT_FORBIDDEN_COOLDOWN_MS = 60_000;
const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_RESOURCE_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_PAGES_PER_RESOURCE = 200;
const DEFAULT_MAX_RECORDS_PER_RESOURCE = 20_000;
const DEFAULT_TOKEN_REFRESH_SKEW_MS = 120_000;
const MAX_REQUEST_INTERVAL_MS = 30_000;
const MAX_RETRY_ATTEMPTS = 10;
const MAX_FETCH_TIMEOUT_MS = 120_000;
const MAX_RESOURCE_TIMEOUT_MS = 300_000;
const MAX_MAX_PAGES_PER_RESOURCE = 5_000;
const MAX_MAX_RECORDS_PER_RESOURCE = 1_000_000;
const MAX_TOKEN_REFRESH_SKEW_MS = 900_000;

// ─── Estado global ───────────────────────────────────────────────────────────

let requestQueue: Promise<void> = Promise.resolve();
let nextRequestAllowedAtMs = 0;
let runtimeToken: string | null = null;
let tokenRefreshInFlight: Promise<string | null> | null = null;

// ─── DTOs de diretório ───────────────────────────────────────────────────────

interface RhidListResult<T> {
  totalRecords?: number;
  records?: T[];
}

export interface RhidPersonDTO {
  id?: number;
  name?: string;
  registration?: string;
  code?: number;
  idDepartment?: number;
  idRole?: number;
  idCompany?: number;
  status?: number;
}

export interface RhidDepartmentDTO {
  id?: number;
  name?: string;
  idCompany?: number;
}

export interface RhidCompanyDTO {
  id?: number;
  name?: string;
  cnpj?: string;
}

export interface RhidRoleDTO {
  id?: number;
  name?: string;
}

export interface RhidDirectoryData {
  people: RhidPersonDTO[];
  departments: RhidDepartmentDTO[];
  companies: RhidCompanyDTO[];
  roles: RhidRoleDTO[];
  warnings: string[];
  token: string | null;
}

interface DirectoryCacheEntry {
  token: string;
  data: RhidDirectoryData;
  expiresAtMs: number;
}

let directoryCache: DirectoryCacheEntry | null = null;

// ─── DTOs de apuração de ponto ───────────────────────────────────────────────

/**
 * Representa uma batida individual (entrada ou saída) dentro de um dia apurado.
 * Fonte: campo `listAfdtManutencao` de cada item retornado por `apuracao_ponto`.
 */
export interface RhidBatidaDTO {
  /** Data/hora exata da batida (ISO 8601). */
  dateTime?: string;
  /** Data da batida no formato "YYYYMMDDHHmm". */
  dateTimeStr?: string;
  /** Data do dia de referência (início da jornada). */
  date?: string;
  /** Hora da batida no formato HHMM (ex: 1900 = 19h00). */
  hora?: number;
  /** Hora prevista no horário contratual no formato HHMM. */
  horaPrevista?: number;
  /** Tipo: "E" = entrada, "S" = saída. */
  _typeEntradaSaida?: "E" | "S" | string;
  /** Tipo de registro: "O" = original, etc. */
  _typeRegister?: string;
  /** Classificação da batida (ex: "1" = entrada normal, "2" = saída normal). */
  _typeClassification?: string;
  /** Diferença real em minutos em relação ao horário previsto. */
  diferencaReal?: number;
  /** Diferença considerada após regras de tolerância (0 = dentro da tolerância). */
  diferencaConsiderada?: number;
  /** Deslocamento de dia (0 = mesmo dia, 1 = dia seguinte — jornadas noturnas). */
  deslocamentoDia?: number;
  /** Identificador da batida no AFD. */
  idAfd?: number;
  /** Justificativa aplicada à batida, se houver. */
  idJustification?: number | null;
  abreviationJustification?: string | null;
  /** Indica se a batida está oculta na interface. */
  oculto?: boolean;
  /** Indica se é uma batida temporária (lançada manualmente sem AFD). */
  isTemporary?: boolean;
}

/**
 * Representa um dia completo da apuração de ponto de um colaborador.
 * Cada item do array retornado por `apuracao_ponto` é um `RhidDiaApuracaoDTO`.
 *
 * Observações importantes sobre o modelo de dados:
 * - Todos os campos de horas/minutos estão em **minutos inteiros**.
 * - Jornadas noturnas (ex: 19h–07h) fazem com que `date` aponte para o dia
 *   de início da jornada, mas as batidas de saída podem ter `deslocamentoDia=1`.
 * - `folga: true` indica dia de folga programada; `faltaDiaInteiro: true` indica
 *   falta não justificada por dia inteiro. Um dia pode ter ambos os flags se for
 *   folga mas o colaborador não comparecer (depende da configuração do cliente).
 * - `compensado: true` significa que o dia foi compensado (banco de horas/DSR).
 * - `neutro: true` significa que o dia não gera débito nem crédito na apuração.
 */
export interface RhidDiaApuracaoDTO {
  /** Número de páginas da resposta (sempre 1 nesta API). */
  paginas?: number;
  /** PIS/NIS do colaborador. */
  pis?: number;
  /** ID do colaborador. */
  idPerson?: number;
  /** ID do turno/escala. */
  idShift?: number;
  /** Nome do colaborador. */
  name?: string;
  /** Mensagem de erro do RHiD para este dia (null = sem erro). */
  error?: string | null;
  /** Indica se o colaborador está arquivado. */
  arquivado?: boolean;

  // ── Identificação do dia ──────────────────────────────────────────────────
  /** Data/hora de início da jornada (ISO 8601). Para jornadas noturnas, pode ser às 19h do dia anterior. */
  dateTimeInicio?: string;
  /** Data de referência do dia (ISO 8601, sempre às 00:00:00). */
  date?: string;
  /** Data no formato "YYYYMMDD". */
  dateTimeStr?: string;

  // ── Horário contratual ────────────────────────────────────────────────────
  /** ID do horário contratual aplicado. */
  idHorarioContratual?: number;
  /** Descrição simples do horário, ex: "19:00-07:00". */
  strHorarioContratualSimples?: string;

  // ── Horas trabalhadas ─────────────────────────────────────────────────────
  /** Total de minutos trabalhados no dia (batidas brutas). */
  totalHorasTrabalhadas?: number;
  /** Minutos diurnos normais (não extras). */
  horasDiurnasNaoExtra?: number;
  /** Minutos noturnos normais (não extras). */
  horasNoturnasNaoExtra?: number;
  /** Minutos noturnos não extras com adicional noturno aplicado. */
  horasNoturnasNaoExtra_MultiplicadoNot?: number;
  /** Total de minutos no período noturno (extras + normais). */
  horasTotalNoturno?: number;
  /** Total noturno com adicional noturno aplicado. */
  horasTotalNoturno_MultiplicadoNot?: number;
  /** Total de minutos não extras (normais). */
  horasTotalNaoExtra?: number;
  /** Total não extras com adicional noturno aplicado. */
  horasTotalNaoExtra_MultiplicadoNot?: number;

  // ── Horas extras ──────────────────────────────────────────────────────────
  /** Minutos extras calculados (após tolerâncias e regras de compensação). */
  horasExtrasCalculadas?: number;
  /** Extras com percentual de hora extra aplicado (ex: 100% = dobro). */
  horasExtrasCalculadas_MultiplicadoEx?: number;
  /** Extras com adicional noturno aplicado. */
  horasExtrasCalculadas_MultiplicadoNot?: number;
  /** Extras com ambos os adicionais (extra + noturno). */
  horasExtrasCalculadas_MultiplicadoExNot?: number;
  /** Extra diurna em minutos. */
  extraDiurna?: number;
  extraDiurna_MultiplicadoEx?: number;
  /** Extra noturna em minutos. */
  extraNoturna?: number;
  extraNoturna_MultiplicadoEx?: number;
  extraNoturna_MultiplicadoNot?: number;
  extraNoturna_MultiplicadoExNot?: number;
  /** Extra de interjornada (descanso entre jornadas). */
  extraInterjornada?: number;
  extraInterjornada_MultiplicadoEx?: number;
  /** Extra por entrada antecipada. */
  extraEntrada?: number;
  /** Extra adicionada manualmente (diurna/noturna). */
  extraAdicionadaDiurna?: number;
  extraAdicionadaNoturna?: number;
  extraAdicionadaNoturna_MultiplicadoNot?: number;
  /** Horas extras durante intervalo de almoço. */
  horasExtraIntervalo?: number;

  // ── Faltas e atrasos ──────────────────────────────────────────────────────
  /**
   * Minutos de falta pura (sem atraso de entrada ou saída antecipada).
   * Se > 0 e `faltaDiaInteiro` for true, indica falta por dia completo.
   */
  horasApenasFalta?: number;
  /** Minutos de falta somados com atrasos. */
  horasFaltaAtraso?: number;
  /** Minutos de atraso na entrada. */
  atrasoEntrada?: number;
  /** Minutos de saída antecipada. */
  saidaAntecipada?: number;
  /** Minutos ausentes totais (inclui todas as formas de ausência). */
  horasAusentes?: number;
  /** Flag: indica falta pelo dia inteiro (colaborador não compareceu). */
  faltaDiaInteiro?: boolean;
  /** Contagem de dias inteiros de falta (0 ou 1 por registro). */
  faltasDiasInteiro?: number;
  /** Minutos apenas de atraso (sem falta integral). */
  apenasAtraso?: number;
  apenasAtrasoDiurno?: number;
  apenasAtrasoNoturno?: number;

  // ── Folga / compensação ───────────────────────────────────────────────────
  /** Flag: dia de folga programada. */
  folga?: boolean;
  /** Minutos de folga. */
  minutosFolga?: number;
  /** Flag: dia compensado (banco de horas ou DSR). */
  compensado?: boolean;
  /** Flag: dia neutro (não gera débito nem crédito). */
  neutro?: boolean;
  /** Flag: almoço livre (não desconta intervalo). */
  almocoLivre?: boolean;
  /** Flag: pendência de folga. */
  pendenciaFolga?: boolean;
  /** ID da justificativa aplicada ao dia (ex: feriado, abono). */
  idJustification?: number | null;

  // ── Banco de horas ────────────────────────────────────────────────────────
  /** Saldo acumulado do banco de horas ao final deste dia (em minutos). */
  saldoBancoFinalDia?: number;
  /** Crédito/débito do dia no banco de horas. */
  saldoBancoCredDeb?: number;
  saldoBancoAjustado?: number;
  bancoMaisCredDebPositivo?: number;
  bancoMaisCredDebNegativo?: number;
  saldoBancoAjustadoMaisCredDeb?: number;

  // ── DSR ───────────────────────────────────────────────────────────────────
  /** DSR considerado no dia (em minutos). */
  dsrConsideradoMinutos?: number;
  descontoDsr?: number;
  descontoDsrInteiro?: number;

  // ── Abonos e ajustes ─────────────────────────────────────────────────────
  minutosAbono?: number;
  minutosAjuste?: number;

  // ── Estatísticas do período ───────────────────────────────────────────────
  /** Número de dias trabalhados (0 ou 1 por registro). */
  diasTrabalhados?: number;
  /** Número de dias úteis (0 ou 1 por registro). */
  diasUteis?: number;
  /** Minutos úteis esperados no dia. */
  horasUteis?: number;

  // ── Batidas ───────────────────────────────────────────────────────────────
  /** Lista de batidas do dia (entradas e saídas processadas). */
  listAfdtManutencao?: RhidBatidaDTO[];
  /** Batidas excluídas/descartadas no processamento. */
  listAfdtExcluidos?: RhidBatidaDTO[];

  // ── Feriado ───────────────────────────────────────────────────────────────
  holiday?: unknown | null;
  isHoliday?: number;

  // ── Alertas visuais (interface RHiD) ─────────────────────────────────────
  toolTipAlert?: string | null;
  iconAlert?: string | null;
  colorAlert?: string | null;
  possuiPendencias?: boolean;

  // ── Extras por percentual ─────────────────────────────────────────────────
  percentuaisExtra?: string[];
  horaExtraDeCadaPercentual?: number[];
  horaExtraDeCadaPercentual_MultiplicadoEx?: number[];
  horaExtraDeCadaPercentual_MultiplicadoNot?: number[];
  horaExtraDeCadaPercentual_MultiplicadoExNot?: number[];

  // ── Miscelânea ────────────────────────────────────────────────────────────
  horarioFechamento?: string;
  diaFechamento?: number;
  pulouAlmoco?: number;
  colunaMix1?: number;
  colunaMix2?: number;
  colunaMix3?: number;
  colunaMix4?: number;
  sobreaviso?: number;
  sobreavisoTrabalhado?: number;
  sobreavisoSaldo?: number;
  idAfdChangeCompensacao?: number | null;
  idAfdChangeAlmoco?: number | null;
  idAfdChangeNeutro?: number | null;
  idAfdChangeFolga?: number | null;
  listAcjefOverwriteStr?: string[];
  listAcjefOverwriteExtraIndex?: unknown | null;
  idx?: number;
}

/**
 * Resultado processado retornado por `loadRhidApuracao` e `loadRhidFaltas`.
 */
export interface RhidApuracaoResult {
  /** Dias apurados no período solicitado. */
  dias: RhidDiaApuracaoDTO[];
  /** Avisos gerados durante a consulta (ex: renovação de token). */
  warnings: string[];
}

/**
 * Subconjunto de `RhidApuracaoResult` contendo apenas os dias com falta.
 * Retornado por `loadRhidFaltas`.
 */
export interface RhidFaltasResult {
  /**
   * Dias em que o colaborador faltou (falta por dia inteiro ou parcial),
   * excluindo folgas programadas sem indicativo de falta real.
   */
  faltas: RhidDiaApuracaoDTO[];
  warnings: string[];
}

// ─── Login ───────────────────────────────────────────────────────────────────

interface RhidLoginResult {
  accessToken?: string;
  error?: string;
  code?: number;
}

// ─── Helpers de configuração ─────────────────────────────────────────────────

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function getBaseUrl(): string {
  const configured = (process.env.RHID_API_BASE_URL ?? "").trim();
  return normalizeBaseUrl(configured || DEFAULT_BASE_URL);
}

function getConfiguredToken(): string {
  return (process.env.RHID_API_TOKEN ?? process.env.RHID_TOKEN ?? "").trim();
}

function getConfiguredEmail(): string {
  return (process.env.RHID_API_EMAIL ?? process.env.RHID_EMAIL ?? "").trim();
}

function getConfiguredPassword(): string {
  return (process.env.RHID_API_PASSWORD ?? process.env.RHID_PASSWORD ?? "").trim();
}

function getConfiguredDomain(): string {
  return (process.env.RHID_API_DOMAIN ?? process.env.RHID_DOMAIN ?? "").trim();
}

function getLoginPath(): string {
  const configured = (process.env.RHID_AUTH_PATH ?? "").trim();

  if (!configured) {
    return DEFAULT_LOGIN_PATH;
  }

  return configured.startsWith("/") ? configured.slice(1) : configured;
}

function getCurrentToken(): string {
  return runtimeToken ?? getConfiguredToken();
}

export function getEffectiveRhidToken(): string {
  return getCurrentToken();
}

function getConfiguredPageLength(): number {
  const raw = Number((process.env.RHID_API_PAGE_LENGTH ?? "").trim());

  if (Number.isFinite(raw) && raw > 0) {
    return Math.max(MIN_PAGE_LENGTH, Math.min(MAX_PAGE_LENGTH, Math.floor(raw)));
  }

  return DEFAULT_PAGE_LENGTH;
}

function getDirectoryCacheTtlMs(): number {
  const raw = Number((process.env.RHID_API_CACHE_TTL_SEC ?? "").trim());
  const seconds = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CACHE_TTL_SEC;
  return Math.max(10, Math.floor(seconds)) * 1000;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readPositiveNumberEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number((process.env[name] ?? "").trim());

  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }

  return clampNumber(Math.floor(raw), min, max);
}

function getMinRequestIntervalMs(): number {
  return readPositiveNumberEnv(
    "RHID_MIN_REQUEST_INTERVAL_MS",
    DEFAULT_MIN_REQUEST_INTERVAL_MS,
    0,
    MAX_REQUEST_INTERVAL_MS
  );
}

function getRetryMaxAttempts(): number {
  return readPositiveNumberEnv("RHID_RETRY_MAX_ATTEMPTS", DEFAULT_RETRY_MAX_ATTEMPTS, 1, MAX_RETRY_ATTEMPTS);
}

function getRetryBaseDelayMs(): number {
  return readPositiveNumberEnv("RHID_RETRY_BASE_DELAY_MS", DEFAULT_RETRY_BASE_DELAY_MS, 500, DEFAULT_RETRY_MAX_DELAY_MS);
}

function getRetryMaxDelayMs(): number {
  return readPositiveNumberEnv(
    "RHID_RETRY_MAX_DELAY_MS",
    DEFAULT_RETRY_MAX_DELAY_MS,
    1_000,
    3_600_000
  );
}

function getForbiddenCooldownMs(): number {
  return readPositiveNumberEnv(
    "RHID_403_COOLDOWN_MS",
    DEFAULT_FORBIDDEN_COOLDOWN_MS,
    1_000,
    DEFAULT_RETRY_MAX_DELAY_MS
  );
}

function getFetchTimeoutMs(): number {
  return readPositiveNumberEnv(
    "RHID_FETCH_TIMEOUT_MS",
    DEFAULT_FETCH_TIMEOUT_MS,
    1_000,
    MAX_FETCH_TIMEOUT_MS
  );
}

function getResourceTimeoutMs(): number {
  return readPositiveNumberEnv(
    "RHID_RESOURCE_TIMEOUT_MS",
    DEFAULT_RESOURCE_TIMEOUT_MS,
    1_000,
    MAX_RESOURCE_TIMEOUT_MS
  );
}

function getMaxPagesPerResource(): number {
  return readPositiveNumberEnv(
    "RHID_MAX_PAGES_PER_RESOURCE",
    DEFAULT_MAX_PAGES_PER_RESOURCE,
    1,
    MAX_MAX_PAGES_PER_RESOURCE
  );
}

function getMaxRecordsPerResource(): number {
  return readPositiveNumberEnv(
    "RHID_MAX_RECORDS_PER_RESOURCE",
    DEFAULT_MAX_RECORDS_PER_RESOURCE,
    100,
    MAX_MAX_RECORDS_PER_RESOURCE
  );
}

function getTokenRefreshSkewMs(): number {
  return readPositiveNumberEnv(
    "RHID_TOKEN_REFRESH_SKEW_MS",
    DEFAULT_TOKEN_REFRESH_SKEW_MS,
    10_000,
    MAX_TOKEN_REFRESH_SKEW_MS
  );
}

// ─── Helpers de retry / rate limit ───────────────────────────────────────────

function shouldRetryStatus(status: number): boolean {
  return status === 403 || status === 408 || status === 429 || status >= 500;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForRateLimitSlot(): Promise<void> {
  const minIntervalMs = getMinRequestIntervalMs();

  if (minIntervalMs <= 0) {
    return;
  }

  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = requestQueue;
  requestQueue = current;

  await previous;

  const now = Date.now();
  const waitMs = Math.max(0, nextRequestAllowedAtMs - now);

  if (waitMs > 0) {
    await sleep(waitMs);
  }

  nextRequestAllowedAtMs = Date.now() + minIntervalMs;
  release();
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number(value.trim());

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.floor(seconds * 1000);
  }

  const dateMs = Date.parse(value);

  if (Number.isNaN(dateMs)) {
    return null;
  }

  return Math.max(0, dateMs - Date.now());
}

function computeRetryDelayMs(attempt: number, status: number | null, retryAfterHeader: string | null): number {
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
  const retryMaxDelayMs = getRetryMaxDelayMs();
  const linearBackoffMs = Math.min(retryMaxDelayMs, getRetryBaseDelayMs() * attempt);
  const suggestedMs = retryAfterMs ?? linearBackoffMs;
  const withForbiddenCooldownMs =
    status === 403 ? Math.max(suggestedMs, getForbiddenCooldownMs()) : suggestedMs;
  const jitterMs = Math.floor(Math.random() * 250);
  return Math.min(retryMaxDelayMs, withForbiddenCooldownMs + jitterMs);
}

// ─── Helpers de JWT ───────────────────────────────────────────────────────────

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payloadPart] = token.split(".");

  if (!payloadPart) {
    return null;
  }

  try {
    const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function tokenExpiryEpoch(token: string): number | null {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;

  if (typeof exp === "number" && Number.isFinite(exp)) {
    return exp;
  }

  if (typeof exp === "string") {
    const parsed = Number(exp);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function summarizeErrorBody(body: string): string {
  const trimmed = body.trim();

  if (!trimmed) {
    return "";
  }

  const isHtml = /<!doctype html|<html[\s>]/i.test(trimmed);

  if (isHtml) {
    const rawTitle = trimmed.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const rawHeading = trimmed.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
    const htmlSummary = [rawTitle, rawHeading]
      .map((value) => value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" - ");

    if (htmlSummary) {
      return htmlSummary.length > 180 ? `${htmlSummary.slice(0, 180)}...` : htmlSummary;
    }
  }

  const compact = trimmed
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!compact) {
    return "";
  }

  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
}

function rhidUrl(pathWithQuery: string): string {
  const path = pathWithQuery.startsWith("/") ? pathWithQuery.slice(1) : pathWithQuery;
  return `${getBaseUrl()}/${path}`;
}

function hasAuthCredentials(): boolean {
  return Boolean(getConfiguredEmail() && getConfiguredPassword());
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function removeExpiredTokenWarnings(warnings: string[]): void {
  const filtered = warnings.filter((warning) => !warning.startsWith("RHID_API_TOKEN expirado em"));

  warnings.length = 0;
  warnings.push(...filtered);
}

function isUnauthorizedMessage(message: string): boolean {
  return /(401|unauthoriz|forbidden|token|jwt|expirad|expired|nao autorizado|não autorizado|invalid|sessao|sessão|acesso negado|acesso inv)/i.test(message);
}

function extractDomainFromToken(token: string): string {
  const payload = decodeJwtPayload(token);
  const domain = payload?.cidCustomerDomain;

  return typeof domain === "string" ? domain.trim() : "";
}

export function isTokenExpired(token: string, nowMs = Date.now()): boolean {
  const exp = tokenExpiryEpoch(token);

  if (exp === null) {
    return false;
  }

  return nowMs >= exp * 1000;
}

function shouldRefreshTokenSoon(token: string, nowMs = Date.now()): boolean {
  const exp = tokenExpiryEpoch(token);

  if (exp === null) {
    return false;
  }

  return nowMs >= exp * 1000 - getTokenRefreshSkewMs();
}

function resolveLoginDomain(previousToken: string | null): string | undefined {
  const configuredDomain = getConfiguredDomain();

  if (configuredDomain) {
    return configuredDomain;
  }

  const knownToken = runtimeToken ?? previousToken ?? getConfiguredToken();

  if (!knownToken) {
    return undefined;
  }

  const inferred = extractDomainFromToken(knownToken);
  return inferred || undefined;
}

// ─── Login / renovação de token ───────────────────────────────────────────────

async function requestLoginToken(previousToken: string | null): Promise<string> {
  const email = getConfiguredEmail();
  const password = getConfiguredPassword();

  if (!email || !password) {
    throw new Error("Credenciais RHID_API_EMAIL/RHID_API_PASSWORD nao configuradas para renovacao automatica.");
  }

  const payload: { email: string; password: string; domain?: string } = {
    email,
    password
  };
  const domain = resolveLoginDomain(previousToken);

  if (domain) {
    payload.domain = domain;
  }

  const maxAttempts = getRetryMaxAttempts();
  const fetchTimeoutMs = getFetchTimeoutMs();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await waitForRateLimitSlot();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, fetchTimeoutMs);

    try {
      const response = await fetch(rhidUrl(getLoginPath()), {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: controller.signal
      });
      const raw = await response.text();

      if (!response.ok) {
        const details = summarizeErrorBody(raw);
        throw new Error(`RHiD ${response.status} ${response.statusText}${details ? ` - ${details}` : ""}`);
      }

      let parsed: RhidLoginResult | null = null;

      try {
        parsed = raw.trim() ? (JSON.parse(raw) as RhidLoginResult) : null;
      } catch {
        parsed = null;
      }

      const token = typeof parsed?.accessToken === "string" ? parsed.accessToken.trim() : "";

      if (!token) {
        const message = parsed?.error ? `: ${parsed.error}` : ".";
        throw new Error(`RHiD /login nao retornou accessToken${message}`);
      }

      return token;
    } catch (error) {
      const message = normalizeErrorMessage(error);
      const canRetry =
        attempt < maxAttempts &&
        (/timeout/i.test(message) || /RHiD (401|403|408|429|5\d\d)\b/i.test(message));
      lastError = error instanceof Error ? error : new Error(message);

      if (canRetry) {
        await sleep(computeRetryDelayMs(attempt, null, null));
        continue;
      }

      throw lastError;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error("Falha ao gerar novo token no endpoint /login.");
}

async function refreshToken(force: boolean, previousToken: string | null): Promise<string | null> {
  if (!hasAuthCredentials()) {
    return null;
  }

  const now = Date.now();

  if (tokenRefreshInFlight) {
    return tokenRefreshInFlight;
  }

  if (!force && runtimeToken && !shouldRefreshTokenSoon(runtimeToken, now)) {
    return runtimeToken;
  }

  const refreshPromise = (async (): Promise<string | null> => {
    try {
      const nextToken = await requestLoginToken(previousToken);
      runtimeToken = nextToken;
      return nextToken;
    } catch (error) {
      console.error("[RHiD] Falha ao renovar token:", normalizeErrorMessage(error));
      return null;
    }
  })();

  tokenRefreshInFlight = refreshPromise;

  try {
    return await refreshPromise;
  } finally {
    if (tokenRefreshInFlight === refreshPromise) {
      tokenRefreshInFlight = null;
    }
  }
}

async function ensureUsableToken(forceRefresh: boolean): Promise<string | null> {
  const now = Date.now();
  const currentToken = getCurrentToken();

  if (!currentToken) {
    return forceRefresh ? refreshToken(true, null) : refreshToken(false, null);
  }

  if (!forceRefresh && !shouldRefreshTokenSoon(currentToken, now)) {
    return currentToken;
  }

  const refreshed = await refreshToken(forceRefresh || isTokenExpired(currentToken, now), currentToken);
  return refreshed ?? (forceRefresh ? null : currentToken);
}

// ─── Camada HTTP base ─────────────────────────────────────────────────────────

async function requestRaw(pathWithQuery: string, token: string, acceptHeader: string): Promise<string> {
  const maxAttempts = getRetryMaxAttempts();
  let lastError: Error | null = null;
  const fetchTimeoutMs = getFetchTimeoutMs();
  let currentToken = token;
  let refreshedOnce = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await waitForRateLimitSlot();

    let response: Response | null = null;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, fetchTimeoutMs);

    try {
      response = await fetch(rhidUrl(pathWithQuery), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${currentToken}`,
          Accept: acceptHeader
        },
        cache: "no-store",
        signal: controller.signal
      });
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      lastError = isAbort
        ? new Error(`Timeout em requisicao RHiD apos ${fetchTimeoutMs}ms.`)
        : error instanceof Error
          ? error
          : new Error(String(error));

      if (attempt < maxAttempts) {
        await sleep(computeRetryDelayMs(attempt, null, null));
        continue;
      }
    } finally {
      clearTimeout(timeoutId);
    }

    if (response === null) {
      break;
    }

    const raw = await response.text();

    if (response.ok) {
      return raw;
    }

    const bodySummary = summarizeErrorBody(raw);
    const authFailure =
      response.status === 401 ||
      (response.status === 403 && /token|jwt|expirad|expired|unauthoriz|nao autorizado|não autorizado/i.test(bodySummary));

    if (authFailure && !refreshedOnce) {
      const refreshedToken = await refreshToken(true, currentToken);

      if (refreshedToken && refreshedToken !== currentToken) {
        currentToken = refreshedToken;
        refreshedOnce = true;
        attempt -= 1;
        continue;
      }
    }

    const details = bodySummary ? ` - ${bodySummary}` : "";
    const responseError = new Error(`RHiD ${response.status} ${response.statusText}${details}`);
    const canRetry = shouldRetryStatus(response.status);

    if (!canRetry || attempt >= maxAttempts) {
      throw responseError; // BUGFIX: era "responfalseError" no original
    }

    lastError = responseError;
    await sleep(computeRetryDelayMs(attempt, response.status, response.headers.get("retry-after")));
  }

  throw lastError ?? new Error("Falha ao consultar API RHiD apos varias tentativas.");
}

async function requestJson<T>(pathWithQuery: string, token: string): Promise<T> {
  const raw = await requestRaw(pathWithQuery, token, "application/json");

  if (!raw.trim()) {
    return {} as T;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("RHiD retornou resposta nao JSON.");
  }
}

// ─── Paginação (diretório) ────────────────────────────────────────────────────

function fingerprintRecord(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 3).map((item) => fingerprintRecord(item)).join("|");
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const preferredKeys = ["id", "code", "registration", "name"];
    const preferredEntries = preferredKeys
      .map((key) => [key, objectValue[key]] as const)
      .filter(([, entryValue]) => typeof entryValue === "string" || typeof entryValue === "number");

    if (preferredEntries.length > 0) {
      return preferredEntries.map(([key, entryValue]) => `${key}:${String(entryValue)}`).join("|");
    }

    return Object.keys(objectValue)
      .sort((first, second) => first.localeCompare(second))
      .slice(0, 4)
      .map((key) => `${key}:${typeof objectValue[key]}`)
      .join("|");
  }

  return typeof value;
}

function pageFingerprint<T>(records: T[]): string {
  if (records.length === 0) {
    return "empty";
  }

  const middleIndex = Math.floor(records.length / 2);
  const first = fingerprintRecord(records[0]);
  const middle = fingerprintRecord(records[middleIndex]);
  const last = fingerprintRecord(records[records.length - 1]);
  return `${records.length}:${first}:${middle}:${last}`;
}

async function fetchPagedRecords<T>(resource: "person" | "department" | "company" | "role", token: string): Promise<T[]> {
  const allRecords: T[] = [];
  let start = 0;
  let expectedTotal: number | null = null;
  const maxPages = getMaxPagesPerResource();
  const maxRecords = getMaxRecordsPerResource();
  let pageCount = 0;
  let previousPageFingerprint: string | null = null;
  let repeatedPageCount = 0;
  const preferredLength = getConfiguredPageLength();
  const fallbackLengths = Array.from(new Set([preferredLength, 80, 50, 20])).filter(
    (size) => size <= MAX_PAGE_LENGTH && size >= MIN_PAGE_LENGTH
  );
  let fallbackIndex = 0;

  while (true) {
    if (pageCount >= maxPages) {
      throw new Error(
        `Limite de paginas atingido ao consultar ${resource} (${maxPages}). Verifique paginacao da API RHiD.`
      );
    }

    pageCount += 1;
    const pageLength = fallbackLengths[fallbackIndex] ?? DEFAULT_PAGE_LENGTH;
    const params = new URLSearchParams({
      start: String(start),
      length: String(pageLength)
    });
    let page: RhidListResult<T>;

    try {
      page = await requestJson<RhidListResult<T>>(`${resource}?${params.toString()}`, token);
      fallbackIndex = 0;
    } catch (error) {
      if (fallbackIndex < fallbackLengths.length - 1) {
        fallbackIndex += 1;
        continue;
      }

      throw error;
    }

    const records = Array.isArray(page.records) ? page.records : [];
    const currentPageFingerprint = pageFingerprint(records);

    if (currentPageFingerprint === previousPageFingerprint && records.length > 0) {
      repeatedPageCount += 1;
    } else {
      repeatedPageCount = 0;
    }

    previousPageFingerprint = currentPageFingerprint;

    if (typeof page.totalRecords === "number" && Number.isFinite(page.totalRecords)) {
      expectedTotal = page.totalRecords;
    }

    allRecords.push(...records);

    if (allRecords.length > maxRecords) {
      throw new Error(
        `Limite de registros atingido ao consultar ${resource} (${maxRecords}). Verifique paginacao da API RHiD.`
      );
    }

    if (records.length === pageLength && expectedTotal === null && repeatedPageCount >= 2) {
      throw new Error(
        `Paginacao de ${resource} aparenta estar travada (pagina repetida em start=${start}, length=${pageLength}).`
      );
    }

    if (records.length < pageLength) {
      break;
    }

    start += records.length;

    if (expectedTotal !== null && start >= expectedTotal) {
      break;
    }
  }

  return allRecords;
}

// ─── Warnings de token ────────────────────────────────────────────────────────

export function readRhidTokenWarnings(): string[] {
  const warnings: string[] = [];
  const token = getCurrentToken();

  if (!token) {
    if (!hasAuthCredentials()) {
      warnings.push("RHID_API_TOKEN nao configurado e credenciais RHID_API_EMAIL/RHID_API_PASSWORD ausentes.");
    }
    return warnings;
  }

  const exp = tokenExpiryEpoch(token);

  if (exp !== null) {
    const expiresAt = new Date(exp * 1000);

    if (Date.now() >= exp * 1000) {
      warnings.push(`RHID_API_TOKEN expirado em ${expiresAt.toISOString()}.`);
    } else if (shouldRefreshTokenSoon(token)) {
      warnings.push(`RHID_API_TOKEN proximo da expiracao em ${expiresAt.toISOString()}.`);
    }
  }

  return warnings;
}

// ─── Diretório (pessoas e departamentos) ─────────────────────────────────────

export async function loadRhidDirectoryData(): Promise<RhidDirectoryData> {
  console.log("[RHiD][DIR] Iniciando carregamento do diretório de colaboradores...");

  const warnings = readRhidTokenWarnings();
  const configuredToken = getConfiguredToken();
  let token = await ensureUsableToken(false);

  if (!token) {
    console.error("[RHiD][DIR] ✗ Falha na autenticação: token inválido ou expirado");
    return {
      people: [],
      departments: [],
      companies: [],
      roles: [],
      warnings,
      token: null
    };
  }

  if (configuredToken && token !== configuredToken) {
    removeExpiredTokenWarnings(warnings);
    warnings.push("Token de acesso renovado automaticamente via endpoint /login.");
    console.log("[RHiD][DIR] Token renovado automaticamente");
  }

  const now = Date.now();
  const tokenExpired = isTokenExpired(token, now);

  if (tokenExpired) {
    console.log("[RHiD][DIR] Token expirado, tentando renovar...");
    const refreshedToken = await refreshToken(true, token);

    if (refreshedToken) {
      token = refreshedToken;
      removeExpiredTokenWarnings(warnings);
      warnings.push("RHID_API_TOKEN expirado: novo token obtido automaticamente no endpoint /login.");
      console.log("[RHiD][DIR] ✓ Token renovado com sucesso");
    } else {
      console.error("[RHiD][DIR] ✗ Falha ao renovar token");
      warnings.push("RHID_API_TOKEN expirado e nao foi possivel renovar automaticamente.");
    }

    if (!refreshedToken) {
      if (directoryCache && directoryCache.token === token && directoryCache.expiresAtMs > now) {
        warnings.push("Token expirado: usando cache local temporario da ultima consulta bem-sucedida.");
        console.log("[RHiD][DIR] Usando cache local como fallback");
        return {
          ...directoryCache.data,
          token: null,
          warnings: [...directoryCache.data.warnings, ...warnings]
        };
      }

      return {
        people: [],
        departments: [],
        companies: [],
        roles: [],
        warnings,
        token: null
      };
    }
  }

  if (
    directoryCache &&
    directoryCache.token === token &&
    directoryCache.expiresAtMs > now
  ) {
    console.log(`[RHiD][DIR] ✓ Usando cache: ${directoryCache.data.people.length} colaboradores`);
    return {
      ...directoryCache.data,
      warnings: [...directoryCache.data.warnings, ...warnings]
    };
  }

  async function fetchDirectoryData(activeToken: string): Promise<RhidDirectoryData> {
    const timeoutMs = getResourceTimeoutMs();
    console.log("[RHiD][DIR] Consultando colaboradores...");

    const people = await withTimeout(
      fetchPagedRecords<RhidPersonDTO>("person", activeToken),
      timeoutMs,
      "consulta de colaboradores"
    );

    console.log(`[RHiD][DIR] ✓ ${people.length} colaboradores carregados`);
    console.log("[RHiD][DIR] Consultando departamentos...");

    const departments = await withTimeout(
      fetchPagedRecords<RhidDepartmentDTO>("department", activeToken),
      timeoutMs,
      "consulta de departamentos"
    );

    console.log(`[RHiD][DIR] ✓ ${departments.length} departamentos carregados`);
    console.log("[RHiD][DIR] Consultando empresas...");

    let companies: RhidCompanyDTO[] = [];
    try {
      companies = await withTimeout(
        fetchPagedRecords<RhidCompanyDTO>("company", activeToken),
        timeoutMs,
        "consulta de empresas"
      );
      console.log(`[RHiD][DIR] ✓ ${companies.length} empresas carregadas`);
    } catch {
      console.warn("[RHiD][DIR] Nao foi possivel carregar empresas — ignorando.");
    }

    let roles: RhidRoleDTO[] = [];
    try {
      roles = await withTimeout(
        fetchPagedRecords<RhidRoleDTO>("role", activeToken),
        timeoutMs,
        "consulta de cargos"
      );
      console.log(`[RHiD][DIR] ✓ ${roles.length} cargos carregados`);
    } catch {
      console.warn("[RHiD][DIR] Nao foi possivel carregar cargos — ignorando.");
    }

    const data: RhidDirectoryData = {
      people,
      departments,
      companies,
      roles,
      warnings,
      token: activeToken
    };

    directoryCache = {
      token: activeToken,
      data,
      expiresAtMs: Date.now() + getDirectoryCacheTtlMs()
    };

    return data;
  }

  try {
    return await fetchDirectoryData(token);
  } catch (error) {
    const message = normalizeErrorMessage(error);
    console.error("[RHiD][DIR] ✗ Erro ao carregar diretório:", message);

    const isForbidden = /(^|\s)403(\s|$)|forbidden/i.test(message);
    const isUnauthorized = isUnauthorizedMessage(message);

    if (isUnauthorized) {
      try {
        const refreshedToken = await refreshToken(true, token);

        if (refreshedToken && refreshedToken !== token) {
          warnings.push("Token de acesso renovado automaticamente apos falha de autorizacao.");
          return await fetchDirectoryData(refreshedToken);
        }
      } catch (refreshError) {
        warnings.push(`Falha ao renovar token automaticamente: ${normalizeErrorMessage(refreshError)}`);
      }
    }

    if (isForbidden) {
      warnings.push(
        "RHiD retornou 403 Forbidden (bloqueio temporario por seguranca/rate limit). Aguarde alguns minutos e tente novamente."
      );
    } else {
      warnings.push(`Falha ao consultar API RHiD: ${message}`);
    }

    if (directoryCache && directoryCache.token === token) {
      warnings.push("Usando cache local temporario da ultima consulta bem-sucedida.");
      return {
        ...directoryCache.data,
        warnings: [...directoryCache.data.warnings, ...warnings]
      };
    }

    return {
      people: [],
      departments: [],
      companies: [],
      roles: [],
      warnings,
      token
    };
  }
}

// ─── Apuração de ponto ────────────────────────────────────────────────────────

export interface RhidApuracaoParams {
  idPerson: number;
  dataIni: string;
  dataFinal: string;
}

/**
 * Consulta a apuração de ponto de um colaborador no endpoint `apuracao_ponto`.
 *
 * O endpoint retorna um **array direto** de `RhidDiaApuracaoDTO` (um item por dia
 * do período solicitado), sem wrapper de paginação.
 *
 * @example
 * const result = await loadRhidApuracao({ idPerson: 7, dataIni: "2026-03-01", dataFinal: "2026-03-31" }, token);
 * for (const dia of result.dias) {
 *   console.log(dia.date, dia.totalHorasTrabalhadas, dia.faltaDiaInteiro);
 * }
 */
export async function loadRhidApuracao(
  params: RhidApuracaoParams,
  token: string
): Promise<RhidApuracaoResult> {
  const warnings: string[] = [];
  let activeToken = token;

  // Garante token válido antes de chamar
  if (!activeToken || shouldRefreshTokenSoon(activeToken)) {
    const refreshed = await ensureUsableToken(false);

    if (refreshed) {
      if (refreshed !== activeToken) {
        warnings.push("Token renovado automaticamente antes da consulta de apuracao.");
      }
      activeToken = refreshed;
    } else if (!activeToken) {
      throw new Error("Token indisponivel para consultar apuracao no RHiD.");
    }
  }

  const query = new URLSearchParams({
    idPerson: String(params.idPerson),
    dataIni: params.dataIni,
    dataFinal: params.dataFinal
  });

  const path = `apuracao_ponto?${query.toString()}`;

  async function fetchApuracao(tkn: string): Promise<RhidDiaApuracaoDTO[]> {
    const raw = await requestRaw(path, tkn, "application/json");

    if (!raw.trim()) {
      return [];
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("RHiD apuracao_ponto retornou resposta nao JSON.");
    }

    // A API retorna array direto (caminho normal)
    if (Array.isArray(parsed)) {
      return parsed as RhidDiaApuracaoDTO[];
    }

    // Fallback defensivo: array dentro de .records
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>)["records"])) {
      return (parsed as Record<string, unknown[]>)["records"] as RhidDiaApuracaoDTO[];
    }

    // A API às vezes retorna o array encodado como string JSON (double-encoded).
    // Exemplo: a raw response é '"[{\"paginas\":1,...}]"' — parse duplo resolve.
    if (typeof parsed === "string" && parsed.trim().startsWith("[")) {
      try {
        const inner = JSON.parse(parsed) as unknown;
        if (Array.isArray(inner)) {
          console.log(`[RHiD][APURACAO] Double-encoded JSON detectado e corrigido para idPerson=${params.idPerson}`);
          return inner as RhidDiaApuracaoDTO[];
        }
      } catch {
        // não era JSON válido, segue para o erro abaixo
      }
    }

    // String que não é array = token inválido (ex: "Unauthorized", "null")
    const responsePreview =
      typeof parsed === "string"
        ? `"${parsed.trim().slice(0, 120)}"`
        : JSON.stringify(parsed).slice(0, 120);
    console.warn(`[RHiD][APURACAO] Resposta inesperada de apuracao_ponto (tipo=${typeof parsed}): ${responsePreview}`);
    throw new Error(`token invalido ou sem permissao — RHiD apuracao_ponto retornou ${typeof parsed} em vez de array: ${responsePreview}`);
  }

  try {
    const dias = await fetchApuracao(activeToken);
    console.log(`[RHiD][APURACAO] ✓ ${dias.length} dias apurados para idPerson=${params.idPerson}`);
    return { dias, warnings };
  } catch (error) {
    const message = normalizeErrorMessage(error);

    if (!isUnauthorizedMessage(message)) {
      throw error;
    }

    // Tenta renovar token e refaz a chamada uma vez
    console.log("[RHiD][APURACAO] Falha de autorização, renovando token...");
    const refreshed = await ensureUsableToken(true);

    if (!refreshed) {
      throw error;
    }

    warnings.push("Token renovado automaticamente apos falha de autorizacao na consulta de apuracao.");
    const dias = await fetchApuracao(refreshed);
    console.log(`[RHiD][APURACAO] ✓ ${dias.length} dias apurados para idPerson=${params.idPerson} (apos renovacao)`);
    return { dias, warnings };
  }
}

// ─── Faltas ───────────────────────────────────────────────────────────────────

/**
 * Retorna apenas os dias com **falta real** no período, extraídos da apuração
 * de ponto (`apuracao_ponto`).
 *
 * Um dia é considerado falta quando **qualquer** uma das condições abaixo é verdadeira:
 * - `faltaDiaInteiro === true` — colaborador não compareceu no dia inteiro.
 * - `horasApenasFalta > 0` — minutos de falta parcial registrados.
 * - `horasFaltaAtraso > 0` — minutos de falta somados com atrasos.
 * - `atrasoEntrada > 0` — atraso na entrada registrado.
 * - `saidaAntecipada > 0` — saída antecipada registrada.
 *
 * Dias de **folga programada sem nenhuma das condições acima** são excluídos,
 * pois representam descanso previsto em escala, não ausência indevida.
 *
 * @example
 * const result = await loadRhidFaltas({ idPerson: 7, dataIni: "2026-03-01", dataFinal: "2026-03-31" }, token);
 * console.log(`${result.faltas.length} falta(s) no período`);
 */
export async function loadRhidFaltas(
  params: RhidApuracaoParams,
  token: string
): Promise<RhidFaltasResult> {
  const { dias, warnings } = await loadRhidApuracao(params, token);

  const faltas = dias.filter((dia) => {
    const faltaDia = dia.faltaDiaInteiro === true;
    const faltaParcial =
      (dia.horasApenasFalta ?? 0) > 0 ||
      (dia.horasFaltaAtraso ?? 0) > 0 ||
      (dia.atrasoEntrada ?? 0) > 0 ||
      (dia.saidaAntecipada ?? 0) > 0;

    return faltaDia || faltaParcial;
  });

  console.log(
    `[RHiD][FALTAS] ✓ ${faltas.length} falta(s) encontrada(s) de ${dias.length} dias apurados` +
    ` para idPerson=${params.idPerson}`
  );

  return { faltas, warnings };
}