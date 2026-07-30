/**
 * Agendador em processo: mantém os dados do RHiD (relatório de apuração + alertas
 * diários de ponto) atualizados automaticamente, sem depender de alguém abrir o
 * painel. Iniciado uma única vez pelo `instrumentation.ts` quando o servidor Next
 * sobe (`next start`/`next dev`), já que este projeto roda como processo Node
 * persistente (não é serverless).
 */
import { loadRhidReportData } from "@/lib/rhid-report";
import { refreshDailyPontoAlerts } from "@/lib/ponto-alerts";
import { refreshEmployeeBirthdays } from "@/lib/birthday-sync";

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutos
const MIN_INTERVAL_MS = 60 * 1000;
const INITIAL_DELAY_MS = 15 * 1000; // pequeno atraso para o servidor terminar de subir

// Aniversários mudam raramente: sincroniza na subida e depois a cada 12h.
const DEFAULT_BIRTHDAY_INTERVAL_MS = 12 * 60 * 60 * 1000;
const BIRTHDAY_INITIAL_DELAY_MS = 45 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __pontoSchedulerStarted: boolean | undefined;
}

function getIntervalMs(): number {
  const raw = Number((process.env.RHID_AUTO_REFRESH_INTERVAL_MS ?? "").trim());
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.floor(raw));
}

function getBirthdayIntervalMs(): number {
  const raw = Number((process.env.RHID_BIRTHDAY_SYNC_INTERVAL_MS ?? "").trim());
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_BIRTHDAY_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.floor(raw));
}

function isSchedulerEnabled(): boolean {
  const raw = (process.env.RHID_AUTO_REFRESH_ENABLED ?? "true").trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

async function runRefreshCycle(): Promise<void> {
  const startedAt = Date.now();
  console.log("[Scheduler] Iniciando leitura automatica do RHiD (relatorio + alertas de ponto)...");

  try {
    const report = await loadRhidReportData({ forceRefresh: true });
    console.log(
      `[Scheduler] Relatorio RHiD atualizado: ${report.processedRows.length} colaboradores.`
    );
  } catch (error) {
    console.error(
      "[Scheduler] Falha ao atualizar relatorio RHiD:",
      error instanceof Error ? error.message : String(error)
    );
  }

  try {
    const result = await refreshDailyPontoAlerts();
    console.log(
      `[Scheduler] Alertas de ponto atualizados: ${result.alerts.length} alerta(s) em ${result.colaboradoresProcessados} colaboradores (${result.persistidos} persistido(s), ${result.removidos} removido(s)).`
    );
  } catch (error) {
    console.error(
      "[Scheduler] Falha ao atualizar alertas de ponto:",
      error instanceof Error ? error.message : String(error)
    );
  }

  console.log(`[Scheduler] Ciclo concluido em ${Date.now() - startedAt}ms.`);
}

async function runBirthdaySyncCycle(): Promise<void> {
  try {
    const result = await refreshEmployeeBirthdays();
    console.log(
      `[Scheduler] Aniversarios sincronizados do RHiD: ${result.persistidos} gravados (${result.processados} cadastros lidos).`
    );
  } catch (error) {
    console.error(
      "[Scheduler] Falha ao sincronizar aniversarios do RHiD:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

export function startPontoScheduler(): void {
  if (!isSchedulerEnabled()) {
    console.log("[Scheduler] Atualizacao automatica desativada via RHID_AUTO_REFRESH_ENABLED=false.");
    return;
  }

  // Evita registrar múltiplos intervalos (hot-reload em dev, múltiplas chamadas de register()).
  if (globalThis.__pontoSchedulerStarted) {
    return;
  }
  globalThis.__pontoSchedulerStarted = true;

  const intervalMs = getIntervalMs();
  console.log(`[Scheduler] Atualizacao automatica do ponto ativada (a cada ${Math.round(intervalMs / 60000)} min).`);

  setTimeout(() => {
    void runRefreshCycle();
  }, INITIAL_DELAY_MS);

  setInterval(() => {
    void runRefreshCycle();
  }, intervalMs);

  const birthdayIntervalMs = getBirthdayIntervalMs();
  console.log(
    `[Scheduler] Sincronizacao de aniversarios do RHiD ativada (a cada ${Math.round(birthdayIntervalMs / 3600000)}h).`
  );

  setTimeout(() => {
    void runBirthdaySyncCycle();
  }, BIRTHDAY_INITIAL_DELAY_MS);

  setInterval(() => {
    void runBirthdaySyncCycle();
  }, birthdayIntervalMs);
}
