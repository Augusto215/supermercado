import { FIELD_DEFINITIONS } from "@/lib/fields";
import type { PayrollRow, RhidProcessedRow } from "@/lib/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roundTwo(value: number): number {
  return Number(value.toFixed(2));
}

function toHours(totalMinutes: number): number {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return 0;
  return roundTwo(totalMinutes / 60);
}

function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ─── CSV base ─────────────────────────────────────────────────────────────────

export function generatePayrollCSV(rows: PayrollRow[]): string {
  const headers = [
    "Codigo",
    "Funcionario",
    "Funcao",
    "Tipo Processamento",
    ...FIELD_DEFINITIONS.map((field) => `${field.codigo} - ${field.label}`)
  ];

  const csvLines = rows.map((row) => {
    const baseFields = [
      row.codigo || "",
      row.funcionario || "",
      row.funcao || "",
      row.tipoProcessamento || ""
    ];

    const valueFields = FIELD_DEFINITIONS.map((field) => {
      const value = row.valores[field.key] ?? 0;
      return typeof value === "number"
        ? value.toString().replace(".", ",")
        : String(value).replace(".", ",");
    });

    return [...baseFields, ...valueFields]
      .map((field) => {
        const s = String(field);
        if (s.includes(";") || s.includes('"') || s.includes("\n")) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      })
      .join(";");
  });

  return [headers.join(";"), ...csvLines].join("\n");
}

export function downloadPayrollCSV(csvContent: string, filename = "relatorio_folha.csv"): void {
  const bom = "\uFEFF";
  const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

export function exportPayrollReport(rows: PayrollRow[], filename?: string): void {
  if (!rows || rows.length === 0) {
    alert("Nenhum dado para exportar.");
    return;
  }

  const csvContent = generatePayrollCSV(rows);
  const now = new Date();
  const date = now.toLocaleDateString("pt-BR").replace(/\//g, "-");
  const time = now.toLocaleTimeString("pt-BR").replace(/:/g, "-");
  downloadPayrollCSV(csvContent, filename ?? `relatorio_folha_${date}_${time}.csv`);
}

// ─── Export do Painel RHiD (mescla PayrollRows com dados da apuração) ─────────

/**
 * Gera o CSV final mesclando:
 * - Campos não-RHiD (Compras, Diferença de Caixa, Comissão, etc.) do PayrollRow existente
 * - Métricas RHiD (Faltas, Atraso, HE, Vale Refeição, DSR) do relatório apurado no Painel
 *
 * Campos preenchidos:
 *   43  – Faltas                  ← processedRow.faltas
 *   44  – Desconto DSR            ← processedRow.valorDesconto (quando motivo = DSR)
 *   150 – Horas Extras 50%        ← processedRow.horasExtrasPagarMin / 60
 *   325 – Vale Refeição           ← processedRow.valorValeRefeicao
 *   3490 – Faltas/Atraso Horas    ← processedRow.atrasoTotalMin / 60
 *
 * Campos preservados do PayrollRow (se já preenchidos manualmente):
 *   208 – Compras, 226 – Dif. Caixa, 37 – Comissão, 108 – Contrib Sindical,
 *   200 – HE 100%, 206 – Prêmio Metas, 460 – Vale
 */
export function exportRhidPainelReport(
  payrollRows: PayrollRow[],
  processedRows: RhidProcessedRow[],
  filename?: string
): void {
  if (!payrollRows.length) {
    alert("Nenhum colaborador carregado para exportar.");
    return;
  }

  // Índice pelo nome normalizado para cruzar as duas fontes
  const byNome = new Map<string, RhidProcessedRow>();
  for (const r of processedRows) {
    const key = normalizeName(r.nome);
    if (key && !byNome.has(key)) byNome.set(key, r);
  }

  const merged: PayrollRow[] = payrollRows.map((row) => {
    const rhid = byNome.get(normalizeName(row.funcionario)) ?? null;

    if (!rhid) return row; // sem match: mantém o que tinha

    return {
      ...row,
      valores: {
        // preserva campos manuais (Compras, Dif. Caixa, etc.)
        ...row.valores,
        // sobrescreve com os dados reais da apuração
        "43":   Math.max(0, roundTwo(rhid.faltas)),
        "44":   Math.max(0, roundTwo(rhid.valorDesconto)),
        "150":  Math.max(0, toHours(rhid.horasExtrasPagarMin)),
        "325":  Math.max(0, roundTwo(rhid.valorValeRefeicao)),
        "3490": Math.max(0, toHours(rhid.atrasoTotalMin))
      }
    };
  });

  const csvContent = generatePayrollCSV(merged);
  const now = new Date();
  const date = now.toLocaleDateString("pt-BR").replace(/\//g, "-");
  const time = now.toLocaleTimeString("pt-BR").replace(/:/g, "-");
  downloadPayrollCSV(csvContent, filename ?? `relatorio_rhid_${date}_${time}.csv`);
}
