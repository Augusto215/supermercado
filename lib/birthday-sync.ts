/**
 * Sincronização dos aniversários a partir do cadastro completo do RHiD.
 *
 * A API pública (`api.svc`) não expõe data de nascimento, mas o serviço interno
 * usado pela interface web (`customerdb/person.svc/r`) retorna o cadastro
 * completo (aba "Dados Pessoais"), incluindo `dateOfBirth`, e aceita o mesmo
 * token de login. Por ser um serviço não documentado, pode mudar sem aviso —
 * o cadastro manual/planilha do painel continua funcionando como alternativa.
 */
import { loadRhidDirectoryData } from "@/lib/rhid-api";
import { supabase } from "@/lib/supabase";

const DEFAULT_CUSTOMERDB_BASE_URL = "https://www.rhid.com.br/v2/customerdb";
/** Idade máxima dos dados antes de uma nova leitura ser disparada ao abrir o painel. */
const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const PAGE_LENGTH = 100;
const MAX_PAGES = 100;
const PAGE_DELAY_MS = 500;
const FETCH_TIMEOUT_MS = 30_000;
const DB_BATCH_SIZE = 500;

interface CustomerDbPersonRow {
  id?: number;
  name?: string;
  status?: number;
  dateOfBirth?: string | null;
  dateOfBirthStr?: string | null;
}

interface CustomerDbListResponse {
  data?: CustomerDbPersonRow[];
  recordsTotal?: number;
  recordsFiltered?: number;
  error?: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __birthdayLastSyncAtMs: number | undefined;
  // eslint-disable-next-line no-var
  var __birthdaySyncInFlight: Promise<RefreshBirthdaysResult> | null | undefined;
}

/**
 * Estado da última sincronização, guardado em `globalThis` (mesma convenção do
 * lib/scheduler.ts) porque em desenvolvimento o Next recarrega os módulos a cada
 * requisição e uma variável de módulo comum seria zerada toda vez.
 *
 * Fica em memória, e não no banco, de propósito: se o servidor reiniciar, a
 * primeira abertura do painel revalida os dados — que é o comportamento
 * desejado — sem precisar de coluna nova na tabela.
 */
function getLastSyncAtMs(): number {
  return globalThis.__birthdayLastSyncAtMs ?? 0;
}

function getCustomerDbBaseUrl(): string {
  const configured = (process.env.RHID_CUSTOMERDB_BASE_URL ?? "").trim();
  return (configured || DEFAULT_CUSTOMERDB_BASE_URL).replace(/\/+$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Converte o `dateOfBirth` do RHiD para "YYYY-MM-DD".
 * O serviço retorna datas no formato Microsoft JSON (`/Date(295412400000-0300)/`):
 * epoch em ms UTC + offset de exibição. Aplicamos o offset antes de extrair a
 * data para não deslocar o aniversário em um dia. Aceita também "dd/mm/aaaa"
 * como fallback (campo `dateOfBirthStr`).
 */
export function parseRhidDateOfBirth(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const msJson = raw.match(/\/Date\((-?\d+)([+-]\d{4})?\)\//);
  if (msJson) {
    let offsetMs = 0;
    if (msJson[2]) {
      const sign = msJson[2].startsWith("-") ? -1 : 1;
      const hours = Number(msJson[2].slice(1, 3));
      const minutes = Number(msJson[2].slice(3, 5));
      offsetMs = sign * (hours * 60 + minutes) * 60_000;
    }
    const date = new Date(Number(msJson[1]) + offsetMs);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    return null;
  }

  const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;

  return null;
}

async function fetchCustomerDbPage(token: string, start: number, draw: number): Promise<CustomerDbListResponse> {
  const url = `${getCustomerDbBaseUrl()}/person.svc/r?draw=${draw}&start=${start}&length=${PAGE_LENGTH}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`RHiD customerdb ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as CustomerDbListResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface RefreshBirthdaysResult {
  /** Total de cadastros lidos do RHiD (ativos e inativos). */
  processados: number;
  /** Colaboradores ativos com data de nascimento preenchida no RHiD. */
  comNascimento: number;
  /** Linhas gravadas (upsert) no Supabase. */
  persistidos: number;
  warnings: string[];
}

/**
 * Lê o cadastro completo de pessoas no RHiD e faz upsert dos aniversários dos
 * colaboradores ativos na tabela `employee_birthdays`. Entradas manuais
 * (funcionario_id "manual-*") não são tocadas.
 */
export async function refreshEmployeeBirthdays(): Promise<RefreshBirthdaysResult> {
  const warnings: string[] = [];
  const { token, warnings: dirWarnings } = await loadRhidDirectoryData();
  warnings.push(...dirWarnings);

  if (!token) {
    throw new Error("Token RHiD indisponivel para sincronizar aniversarios.");
  }

  const rows: { funcionario_id: string; funcionario_nome: string; data_nascimento: string }[] = [];
  let processados = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const start = page * PAGE_LENGTH;
    const payload = await fetchCustomerDbPage(token, start, page + 1);

    if (payload.error) {
      throw new Error(`RHiD customerdb: ${payload.error}`);
    }

    const pageRows = payload.data ?? [];
    processados += pageRows.length;

    for (const person of pageRows) {
      if (typeof person.id !== "number" || !Number.isFinite(person.id)) continue;
      if (person.status !== 1) continue; // apenas colaboradores ativos

      const nascimento =
        parseRhidDateOfBirth(person.dateOfBirth) ?? parseRhidDateOfBirth(person.dateOfBirthStr);
      if (!nascimento) continue;

      const nome =
        typeof person.name === "string" && person.name.trim()
          ? person.name.trim()
          : `Funcionario ${person.id}`;

      rows.push({
        funcionario_id: String(person.id),
        funcionario_nome: nome,
        data_nascimento: nascimento,
      });
    }

    const total = payload.recordsFiltered ?? payload.recordsTotal;
    if (pageRows.length < PAGE_LENGTH) break;
    if (typeof total === "number" && start + PAGE_LENGTH >= total) break;

    await sleep(PAGE_DELAY_MS);
  }

  if (processados === 0) {
    warnings.push("RHiD customerdb nao retornou nenhum cadastro de pessoa.");
  }

  let persistidos = 0;
  for (let i = 0; i < rows.length; i += DB_BATCH_SIZE) {
    const batch = rows.slice(i, i + DB_BATCH_SIZE);
    const { error } = await supabase
      .from("employee_birthdays")
      .upsert(batch, { onConflict: "funcionario_id" });

    if (error) {
      throw new Error(`Falha ao gravar aniversarios no Supabase: ${error.message}`);
    }
    persistidos += batch.length;
  }

  console.log(
    `[Aniversarios] ${persistidos} aniversario(s) sincronizados do RHiD (${processados} cadastros lidos).`
  );

  globalThis.__birthdayLastSyncAtMs = Date.now();
  return { processados, comNascimento: rows.length, persistidos, warnings };
}

export interface EnsureBirthdaysFreshResult {
  /** true quando uma leitura do RHiD foi realmente feita agora. */
  sincronizou: boolean;
  resultado: RefreshBirthdaysResult | null;
}

/**
 * Garante que os aniversários estão atualizados, sem custo quando já estão.
 * Chamado ao abrir o painel: se a última leitura foi há menos de `maxAgeMs`,
 * não faz nada; chamadas simultâneas compartilham a mesma sincronização.
 */
export async function ensureBirthdaysFresh(
  maxAgeMs = DEFAULT_MAX_AGE_MS
): Promise<EnsureBirthdaysFreshResult> {
  const ultimaSync = getLastSyncAtMs();
  if (ultimaSync > 0 && Date.now() - ultimaSync < maxAgeMs) {
    return { sincronizou: false, resultado: null };
  }

  if (!globalThis.__birthdaySyncInFlight) {
    globalThis.__birthdaySyncInFlight = refreshEmployeeBirthdays().finally(() => {
      globalThis.__birthdaySyncInFlight = null;
    });
  }

  return { sincronizou: true, resultado: await globalThis.__birthdaySyncInFlight };
}
