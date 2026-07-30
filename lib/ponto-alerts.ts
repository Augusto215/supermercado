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

/**
 * Minutos de atraso a partir dos quais o dia vira alerta. O padrão de 10 min
 * acompanha o próprio RHiD, que rotula esses dias como "Atraso acima de 10 min".
 * Ajustável por RHID_ATRASO_ALERTA_MIN.
 */
const DEFAULT_ATRASO_THRESHOLD_MIN = 10;

function getAtrasoThresholdMin(): number {
  const raw = Number((process.env.RHID_ATRASO_ALERTA_MIN ?? "").trim());
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_ATRASO_THRESHOLD_MIN;
  return Math.floor(raw);
}

/**
 * Janela de dias que o painel de alertas acompanha, terminando hoje.
 * Padrão 1 = somente o dia atual. Aumente com RHID_ALERTAS_DIAS para incluir
 * dias anteriores (2 = hoje e ontem, e assim por diante).
 */
const DEFAULT_ALERT_WINDOW_DAYS = 1;

function getAlertWindowDays(): number {
  const raw = Number((process.env.RHID_ALERTAS_DIAS ?? "").trim());
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_ALERT_WINDOW_DAYS;
  return Math.floor(raw);
}

/** Data local no formato YYYY-MM-DD (toISOString viraria o dia à noite, por causa do fuso). */
function toLocalDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Hoje, no fuso do servidor. */
export function hojeLocal(): string {
  return toLocalDateInput(new Date());
}

/**
 * Período dos alertas de ponto: janela recente terminando **hoje**.
 *
 * Difere de `resolvePeriod()`, que segue RHID_DATA_INI/RHID_DATA_FINAL — o
 * período fechado da folha. Alerta de ponto é acompanhamento do dia a dia, então
 * precisa terminar hoje e não na data de fechamento da folha. Datas passadas
 * explicitamente (filtro do painel) continuam valendo.
 */
export function resolveAlertPeriod(overrideIni?: string, overrideFinal?: string): ReportPeriod {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - (getAlertWindowDays() - 1) * 24 * 60 * 60 * 1000);
  return resolvePeriod(
    overrideIni ?? toLocalDateInput(inicio),
    overrideFinal ?? toLocalDateInput(hoje)
  );
}

export interface DailyPontoAlert {
  funcionarioId: string;
  funcionarioNome: string;
  departamento: string;
  cargo: string;
  dia: string; // YYYY-MM-DD
  atrasoMin: number;
  temAtraso: boolean;
  batidaIncompleta: boolean;
  qtdBatidas: number;
  detalhe: string;
}

/**
 * Minutos de atraso do dia.
 *
 * Nesta operação as escalas são flexíveis: nas batidas de entrada o RHiD grava
 * `horaPrevista` igual à hora real, então `atrasoEntrada` fica sempre zerado e o
 * débito do dia aparece em `saidaAntecipada` (jornada encerrada antes de fechar
 * as horas devidas) — é esse caso que o próprio RHiD rotula como "Atraso".
 * Somamos os dois componentes para também cobrir escalas de horário fixo, onde
 * o atraso na entrada é preenchido de verdade, e usamos `apenasAtraso` como
 * alternativa quando o RHiD só informa o agregado.
 */
export function resolveAtrasoMin(dia: RhidDiaApuracaoDTO): number {
  const componentes = (dia.atrasoEntrada ?? 0) + (dia.saidaAntecipada ?? 0);
  if (componentes > 0) return componentes;
  return dia.apenasAtraso ?? 0;
}

// ─── Extração diária a partir da apuração do RHiD ─────────────────────────────

function buildDetalhe(
  dia: RhidDiaApuracaoDTO,
  batidaIncompleta: boolean,
  temAtraso: boolean,
  atrasoMin: number
): string {
  const parts: string[] = [];
  if (batidaIncompleta) parts.push("Batida incompleta no dia (numero impar de marcacoes de entrada/saida)");
  if (temAtraso) parts.push(`Atraso de ${atrasoMin} min no dia`);
  const toolTip = (dia.toolTipAlert ?? "").replace(/\r?\n/g, " | ").trim();
  if (toolTip) parts.push(toolTip);
  return parts.join(" — ");
}

/** Extrai os alertas diários (batida incompleta / atraso) de um conjunto de dias apurados. */
export function extractDailyAlerts(
  dias: RhidDiaApuracaoDTO[],
  meta: { funcionarioId: string; funcionarioNome: string; departamento: string; cargo: string }
): DailyPontoAlert[] {
  const alerts: DailyPontoAlert[] = [];
  const thresholdMin = getAtrasoThresholdMin();
  const hoje = hojeLocal();

  for (const dia of dias) {
    const dataDia = resolveDiaDate(dia);
    if (!dataDia) continue;

    // Ignora dias de folga programada sem qualquer batida (nada a apurar).
    const batidas = dia.listAfdtManutencao ?? [];
    const realBatidas = batidas.filter(
      (b) => b._typeEntradaSaida === "E" || b._typeEntradaSaida === "S"
    );

    const atrasoMin = resolveAtrasoMin(dia);
    // Dia "neutro" nao gera debito nem credito (compensado por banco de horas,
    // DSR ou ajuste). O proprio RHiD nao alerta nesses dias — exibe visto verde
    // e nenhum tooltip — entao um debito ali nao e atraso de verdade.
    const temAtraso = atrasoMin > thresholdMin && dia.neutro !== true;

    // Batida "incompleta": numero impar de marcacoes reais de entrada/saida no dia
    // (colaborador esqueceu de bater entrada ou saida em algum momento do dia).
    // No dia de hoje a jornada ainda esta aberta: quem bateu a entrada e nao
    // bateu a saida so esta trabalhando, nao esqueceu nada. So avaliamos dias
    // ja encerrados.
    const batidaIncompleta =
      dataDia < hoje && realBatidas.length > 0 && realBatidas.length % 2 !== 0;

    if (!temAtraso && !batidaIncompleta) continue;

    alerts.push({
      funcionarioId: meta.funcionarioId,
      funcionarioNome: meta.funcionarioNome,
      departamento: meta.departamento,
      cargo: meta.cargo,
      dia: dataDia,
      atrasoMin,
      temAtraso,
      batidaIncompleta,
      qtdBatidas: realBatidas.length,
      detalhe: buildDetalhe(dia, batidaIncompleta, temAtraso, atrasoMin),
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
  const period = resolveAlertPeriod(options?.dataIni, options?.dataFinal);
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
    atraso_min: alert.atrasoMin,
    tem_atraso: alert.temAtraso,
    batida_incompleta: alert.batidaIncompleta,
    qtd_batidas: alert.qtdBatidas,
    detalhe: alert.detalhe,
  };
}

/** Grava (upsert) os alertas diários encontrados no Supabase. */
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

/**
 * Remove do período os alertas que deixaram de existir — dia cuja pendência foi
 * resolvida no RHiD (batida corrigida, justificativa aplicada) ou linha gravada
 * por um critério de alerta anterior. Sem isso o upsert só acrescenta, e alertas
 * antigos ficariam no painel para sempre.
 */
export async function pruneStalePontoAlerts(
  period: ReportPeriod,
  alerts: DailyPontoAlert[]
): Promise<number> {
  const { data, error } = await supabase
    .from("ponto_alertas_diarios")
    .select("id,funcionario_id,dia")
    .gte("dia", period.dataIni)
    .lte("dia", period.dataFinal);

  if (error) {
    console.error("[PontoAlertas][DB] Falha ao listar alertas para limpeza:", error.message);
    throw new Error(error.message);
  }

  const atuais = new Set(alerts.map((a) => `${a.funcionarioId}|${a.dia}`));
  const obsoletos = (data ?? [])
    .filter((row) => !atuais.has(`${row.funcionario_id}|${row.dia}`))
    .map((row) => row.id);

  if (obsoletos.length === 0) return 0;

  const BATCH_SIZE = 500;
  for (let i = 0; i < obsoletos.length; i += BATCH_SIZE) {
    const { error: delError } = await supabase
      .from("ponto_alertas_diarios")
      .delete()
      .in("id", obsoletos.slice(i, i + BATCH_SIZE));

    if (delError) {
      console.error("[PontoAlertas][DB] Falha ao remover alertas obsoletos:", delError.message);
      throw new Error(delError.message);
    }
  }

  console.log(`[PontoAlertas] ${obsoletos.length} alerta(s) obsoleto(s) removido(s) do periodo.`);
  return obsoletos.length;
}

export interface RefreshPontoAlertsResult extends LoadDailyPontoAlertsResult {
  persistidos: number;
  removidos: number;
}

/** Busca a apuração completa do período, extrai os alertas diários e sincroniza o Supabase. */
export async function refreshDailyPontoAlerts(
  options?: LoadDailyPontoAlertsOptions
): Promise<RefreshPontoAlertsResult> {
  const result = await loadDailyPontoAlerts(options);

  let persistidos = 0;
  let removidos = 0;

  // Só mexe no banco se a leitura do RHiD funcionou: um período sem nenhum
  // colaborador processado significa falha de consulta, e apagar tudo ali
  // limparia alertas legítimos.
  if (result.colaboradoresProcessados === 0) {
    result.warnings.push("Nenhum colaborador processado — alertas no banco mantidos como estavam.");
    return { ...result, persistidos, removidos };
  }

  try {
    await persistDailyPontoAlerts(result.alerts);
    persistidos = result.alerts.length;
    removidos = await pruneStalePontoAlerts(result.period, result.alerts);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.warnings.push(`Falha ao persistir alertas de ponto no Supabase: ${message}`);
  }

  return { ...result, persistidos, removidos };
}
