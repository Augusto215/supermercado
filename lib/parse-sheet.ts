import { FIELD_ORDER } from "@/lib/fields";
import { loadRhidDirectoryData, type RhidPersonDTO } from "@/lib/rhid-api";
import { loadRhidReportData } from "@/lib/rhid-report";
import { type PayrollRow, type RhidProcessedRow } from "@/lib/types";

const DEFAULT_ACTIVE_PERSON_STATUSES = [1];

function emptyValues(): Record<string, number> {
  const values: Record<string, number> = {};

  for (const key of FIELD_ORDER) {
    values[key] = 0;
  }

  return values;
}

function toSafeText(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed) {
      return trimmed;
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return fallback;
}

function normalizedCode(value: unknown): string {
  const text = toSafeText(value, "");
  return text.replace(/\s+/g, "");
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function roundTwo(value: number): number {
  return Number(value.toFixed(2));
}

function toHours(totalMinutes: number): number {
  if (!Number.isFinite(totalMinutes)) {
    return 0;
  }

  return roundTwo(totalMinutes / 60);
}

function applyRhidMetrics(values: Record<string, number>, processed: RhidProcessedRow | null): Record<string, number> {
  if (!processed) {
    return values;
  }

  return {
    ...values,
    "43": Math.max(0, roundTwo(processed.faltas)),
    "44": Math.max(0, roundTwo(processed.valorDesconto)),
    "3490": Math.max(0, toHours(processed.atrasoTotalMin)),
    "150": Math.max(0, toHours(processed.horasExtrasTotaisMin)),
    "325": Math.max(0, roundTwo(processed.valorValeRefeicao))
  };
}

function shouldEnrichPayrollWithReport(): boolean {
  const raw = (process.env.RHID_ENRICH_PAYROLL_WITH_REPORT ?? "false").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function getActivePersonStatuses(): number[] {
  const raw = (process.env.RHID_ACTIVE_PERSON_STATUSES ?? "").trim();
  const candidates = (raw || DEFAULT_ACTIVE_PERSON_STATUSES.join(","))
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.floor(value));

  if (candidates.length === 0) {
    return [...DEFAULT_ACTIVE_PERSON_STATUSES];
  }

  return Array.from(new Set(candidates)).sort((first, second) => first - second);
}

function resolvePersonStatus(person: RhidPersonDTO): number | null {
  const statusValue = person.status as unknown;

  if (typeof statusValue === "number" && Number.isFinite(statusValue)) {
    return Math.floor(statusValue);
  }

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

  return {
    activePeople,
    inactiveCount,
    missingStatusCount
  };
}

export async function loadPayrollRows(): Promise<PayrollRow[]> {
  const { people, departments, warnings, token } = await loadRhidDirectoryData();
  const {
    activePeople,
    inactiveCount,
    missingStatusCount
  } = filterActivePeople(people);
  let reportRows: RhidProcessedRow[] = [];
  let reportWarnings: string[] = [];

  warnings.push(
    `Filtro de ativos aplicado em colaboradores: ${activePeople.length} ativos de ${people.length} colaboradores (status ativos: ${getActivePersonStatuses().join(", ")}).`
  );

  if (inactiveCount > 0) {
    warnings.push(`${inactiveCount} colaboradores ignorados por status inativo.`);
  }

  if (missingStatusCount > 0) {
    warnings.push(`${missingStatusCount} colaboradores ignorados por status ausente/invalido.`);
  }

  if (shouldEnrichPayrollWithReport()) {
    try {
      const report = await loadRhidReportData({
        prefetchedDirectoryData: {
          people: activePeople,
          departments,
          companies: [],
          roles: [],
          warnings: [],
          token
        }
      });
      reportRows = report.processedRows;
      reportWarnings = report.warnings;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Falha ao enriquecer folha com apuracao: ${message}`);
    }
  }

  for (const warning of warnings) {
    console.warn(`[RHiD] ${warning}`);
  }

  for (const warning of reportWarnings) {
    console.warn(`[RHiD][Apuracao] ${warning}`);
  }

  if (activePeople.length === 0) {
    return [];
  }

  const departmentsById = new Map<number, string>();
  const processedById = new Map<string, RhidProcessedRow>();
  const processedByName = new Map<string, RhidProcessedRow>();

  for (const department of departments) {
    if (typeof department.id === "number" && Number.isFinite(department.id)) {
      departmentsById.set(department.id, toSafeText(department.name, "Sem departamento"));
    }
  }

  for (const row of reportRows) {
    processedById.set(row.id, row);

    const nameKey = normalizeName(row.nome);

    if (nameKey && !processedByName.has(nameKey)) {
      processedByName.set(nameKey, row);
    }
  }

  let matchedProcessedRows = 0;
  let rowsWithPointValues = 0;

  const rows: PayrollRow[] = activePeople.map((person, index) => {
    const personId =
      typeof person.id === "number" && Number.isFinite(person.id) ? person.id : index + 1;
    const registration = normalizedCode(person.registration);
    const personCode = normalizedCode(person.code);
    const codigo = registration || personCode || `RH${String(personId).padStart(5, "0")}`;
    const funcao =
      typeof person.idDepartment === "number" && Number.isFinite(person.idDepartment)
        ? (departmentsById.get(person.idDepartment) ?? "Sem departamento")
        : "Sem departamento";
    const personName = toSafeText(person.name, `Funcionario ${personId}`);
    const processed =
      processedById.get(String(personId)) ?? processedByName.get(normalizeName(personName)) ?? null;
    const valores = applyRhidMetrics(emptyValues(), processed);

    if (processed) {
      matchedProcessedRows += 1;
    }

    if ((valores["43"] ?? 0) > 0 || (valores["3490"] ?? 0) > 0 || (valores["150"] ?? 0) > 0) {
      rowsWithPointValues += 1;
    }

    return {
      id: `rhid-person-${personId}`,
      codigo,
      funcionario: personName,
      funcao,
      tipoProcessamento: "RHiD API",
      valores
    };
  });

  console.log("[RHiD][ParseSheet] Mapeamento de valores concluido", {
    totalPeople: activePeople.length,
    totalProcessedRows: reportRows.length,
    matchedProcessedRows,
    rowsWithPointValues
  });

  rows.sort((first, second) => first.funcionario.localeCompare(second.funcionario, "pt-BR"));

  return rows;
}
