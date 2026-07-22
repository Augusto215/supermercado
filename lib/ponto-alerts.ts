import {
  loadRhidApuracao,
  loadRhidDirectoryData,
  type RhidDiaApuracaoDTO,
} from "@/lib/rhid-api";
import {
  resolvePeriod,
  filterActivePeople,
  resolveDiaDate,
  withTimeout,
  mapWithConcurrency,
  splitPeriodIntoChunks,
  shouldFetchApuracao,
  getApuracaoConcurrency,
  getApuracaoChunkDays,
  getApuracaoTimeoutMs,
  type ReportPeriod,
} from "@/lib/rhid-report";
import { supabase, type DbPontoAlertaDiario } from "@/lib/supabase";

// Acima de 2h (120 min) de hora extra somada (diurna + noturna) no dia.
const EXTRA_ALERT_THRESHOLD_MIN = 120;

export interface DailyPontoAlert {
  funcionarioId: string;
  funcionarioNome: string;
  departamento: string;
  cargo: string;
  dia: string; // YYYY-MM-DD
  extraMin: number;
  mais2hExtra: boolean;
  batidaIncompleta: boolean;
  qtdBatidas: number;
  detalhe: string;
}

// ─── Extração diária a partir da apuração do RHiD ─────────────────────────────

function buildDetalhe(dia: RhidDiaApuracaoDTO, batidaIncompleta: boolean, mais2hExtra: boolean): string {
  const parts: string[] = [];
  if (batidaIncompleta) parts.push("Batida incompleta no dia (numero impar de marcacoes de entrada/saida)");
  if (mais2hExtra) parts.push("Mais de 2h de hora extra no dia");
  const toolTip = (dia.toolTipAlert ?? "").replace(/\r?\n/g, " | ").trim();
  if (toolTip) parts.push(toolTip);
  return parts.join(" — ");
}

/** Extrai os alertas diários (batida incompleta / +2h extra) de um conjunto de dias apurados. */
export function extractDailyAlerts(
  dias: RhidDiaApuracaoDTO[],
  meta: { funcionarioId: string; funcionarioNome: string; departamento: string; cargo: string }
): DailyPontoAlert[] {
  const alerts: DailyPontoAlert[] = [];

  for (const dia of dias) {
    const dataDia = resolveDiaDate(dia);
    if (!dataDia) continue;

    // Ignora dias de folga programada sem qualquer batida (nada a apurar).
    const batidas = dia.listAfdtManutencao ?? [];
    const realBatidas = batidas.filter(
      (b) => b._typeEntradaSaida === "E" || b._typeEntradaSaida === "S"
    );

    const extraMin = (dia.extraDiurna ?? 0) + (dia.extraNoturna ?? 0);
    const mais2hExtra = extraMin > EXTRA_ALERT_THRESHOLD_MIN;

    // Batida "incompleta": numero impar de marcacoes reais de entrada/saida no dia
    // (colaborador esqueceu de bater entrada ou saida em algum momento do dia).
    const batidaIncompleta = realBatidas.length > 0 && realBatidas.length % 2 !== 0;

    if (!mais2hExtra && !batidaIncompleta) continue;

    alerts.push({
      funcionarioId: meta.funcionarioId,
      funcionarioNome: meta.funcionarioNome,
      departamento: meta.departamento,
      cargo: meta.cargo,
      dia: dataDia,
      extraMin,
      mais2hExtra,
      batidaIncompleta,
      qtdBatidas: realBatidas.length,
      detalhe: buildDetalhe(dia, batidaIncompleta, mais2hExtra),
    });
  }

  return alerts;
}

// ─── Coleta de todos os colaboradores ativos ──────────────────────────────────

export interface LoadDailyPontoAlertsOptions {
  dataIni?: string;
  dataFinal?: string;
  companyIds?: number[];
  onProgress?: (current: number, total: number) => void;
}

export interface LoadDailyPontoAlertsResult {
  alerts: DailyPontoAlert[];
  period: ReportPeriod;
  colaboradoresProcessados: number;
  warnings: string[];
}

export async function loadDailyPontoAlerts(
  options?: LoadDailyPontoAlertsOptions
): Promise<LoadDailyPontoAlertsResult> {
  const period = resolvePeriod(options?.dataIni, options?.dataFinal);
  const warnings: string[] = [];

  if (!shouldFetchApuracao()) {
    warnings.push("Consulta de apuracao desativada via RHID_FETCH_APURACAO=false.");
    return { alerts: [], period, colaboradoresProcessados: 0, warnings };
  }

  const directoryData = await loadRhidDirectoryData();
  const { people, warnings: dirWarnings, token } = directoryData;
  warnings.push(...dirWarnings);

  if (!token) {
    warnings.push("Token RHID indisponivel para consultar apuracao.");
    return { alerts: [], period, colaboradoresProcessados: 0, warnings };
  }

  const { activePeople } = filterActivePeople(people);
  const filteredPeople = options?.companyIds?.length
    ? activePeople.filter((p) => p.idCompany !== undefined && options.companyIds!.includes(p.idCompany))
    : activePeople;

  const deptNameMap = new Map<number, string>();
  for (const dept of directoryData.departments) {
    if (dept.id !== undefined && dept.name) deptNameMap.set(dept.id, dept.name);
  }
  const roleNameMap = new Map<number, string>();
  for (const role of directoryData.roles) {
    if (role.id !== undefined && role.name) roleNameMap.set(role.id, role.name);
  }

  const chunks = splitPeriodIntoChunks(period, getApuracaoChunkDays());
  const concurrency = getApuracaoConcurrency();
  const timeoutMs = getApuracaoTimeoutMs();

  let processed = 0;
  const perPersonAlerts = await mapWithConcurrency(
    filteredPeople,
    concurrency,
    async (person, index) => {
      if (typeof person.id !== "number" || !Number.isFinite(person.id)) return [];

      const nome = typeof person.name === "string" && person.name.trim() ? person.name.trim() : `Funcionario ${person.id}`;
      const meta = {
        funcionarioId: String(person.id),
        funcionarioNome: nome,
        departamento: person.idDepartment ? deptNameMap.get(person.idDepartment) ?? "" : "",
        cargo: person.idRole ? roleNameMap.get(person.idRole) ?? "" : "",
      };

      const personAlerts: DailyPontoAlert[] = [];

      for (const chunk of chunks) {
        try {
          const result = await withTimeout(
            loadRhidApuracao({ idPerson: person.id, dataIni: chunk.dataIni, dataFinal: chunk.dataFinal }, token),
            timeoutMs,
            `apuracao (alertas de ponto) de ${nome} (${chunk.dataIni} ate ${chunk.dataFinal})`
          );
          personAlerts.push(...extractDailyAlerts(result.dias, meta));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (processed < 5) {
            warnings.push(`Falha na apuracao de alertas de ${nome} (${chunk.dataIni} ate ${chunk.dataFinal}): ${message}`);
          }
        }
      }

      processed += 1;
      options?.onProgress?.(processed, filteredPeople.length);
      return personAlerts;
    }
  );

  const alerts = perPersonAlerts.flat();
  console.log(
    `[PontoAlertas] ${alerts.length} alerta(s) diario(s) encontrados em ${filteredPeople.length} colaboradores (${period.dataIni} a ${period.dataFinal}).`
  );

  return { alerts, period, colaboradoresProcessados: filteredPeople.length, warnings };
}

// ─── Persistência (Supabase) ──────────────────────────────────────────────────

function toDbRow(alert: DailyPontoAlert): Omit<DbPontoAlertaDiario, "id" | "atualizado_em"> {
  return {
    funcionario_id: alert.funcionarioId,
    funcionario_nome: alert.funcionarioNome,
    departamento: alert.departamento,
    cargo: alert.cargo,
    dia: alert.dia,
    extra_min: alert.extraMin,
    mais_2h_extra: alert.mais2hExtra,
    batida_incompleta: alert.batidaIncompleta,
    qtd_batidas: alert.qtdBatidas,
    detalhe: alert.detalhe,
  };
}

/** Grava (upsert) os alertas diários encontrados no Supabase. Ignorado silenciosamente se o Supabase não estiver configurado. */
export async function persistDailyPontoAlerts(alerts: DailyPontoAlert[]): Promise<void> {
  if (alerts.length === 0) return;

  const rows = alerts.map(toDbRow);
  const BATCH_SIZE = 500;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("ponto_alertas_diarios")
      .upsert(batch, { onConflict: "funcionario_id,dia" });

    if (error) {
      console.error("[PontoAlertas][DB] Falha ao gravar alertas diarios:", error.message);
      throw new Error(error.message);
    }
  }
}

export interface RefreshPontoAlertsResult extends LoadDailyPontoAlertsResult {
  persistidos: number;
}

/** Busca a apuração completa do período, extrai os alertas diários e persiste no Supabase. */
export async function refreshDailyPontoAlerts(
  options?: LoadDailyPontoAlertsOptions
): Promise<RefreshPontoAlertsResult> {
  const result = await loadDailyPontoAlerts(options);

  let persistidos = 0;
  try {
    await persistDailyPontoAlerts(result.alerts);
    persistidos = result.alerts.length;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.warnings.push(`Falha ao persistir alertas de ponto no Supabase: ${message}`);
  }

  return { ...result, persistidos };
}
