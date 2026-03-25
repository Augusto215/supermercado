import { FIELD_ORDER } from "@/lib/fields";
import { loadRhidDirectoryData } from "@/lib/rhid-api";
import { type PayrollRow } from "@/lib/types";

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

export async function loadPayrollRows(): Promise<PayrollRow[]> {
  const { people, departments, warnings } = await loadRhidDirectoryData();

  for (const warning of warnings) {
    console.warn(`[RHiD] ${warning}`);
  }

  if (people.length === 0) {
    return [];
  }

  const departmentsById = new Map<number, string>();

  for (const department of departments) {
    if (typeof department.id === "number" && Number.isFinite(department.id)) {
      departmentsById.set(department.id, toSafeText(department.name, "Sem departamento"));
    }
  }

  const rows: PayrollRow[] = people.map((person, index) => {
    const personId =
      typeof person.id === "number" && Number.isFinite(person.id) ? person.id : index + 1;
    const registration = normalizedCode(person.registration);
    const personCode = normalizedCode(person.code);
    const codigo = registration || personCode || `RH${String(personId).padStart(5, "0")}`;
    const funcao =
      typeof person.idDepartment === "number" && Number.isFinite(person.idDepartment)
        ? (departmentsById.get(person.idDepartment) ?? "Sem departamento")
        : "Sem departamento";

    return {
      id: `rhid-person-${personId}`,
      codigo,
      funcionario: toSafeText(person.name, `Funcionario ${personId}`),
      funcao,
      tipoProcessamento: "RHiD API",
      valores: emptyValues()
    };
  });

  rows.sort((first, second) => first.funcionario.localeCompare(second.funcionario, "pt-BR"));

  return rows;
}
