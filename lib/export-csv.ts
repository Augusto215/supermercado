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

export interface ExportPurchaseRow {
  funcionario_nome: string;
  dia: string;
  valor: number;
}

export interface ExportCashDiffRow {
  operador: string;
  diferenca: number;
}

export interface ExportValeRow {
  funcionario_nome: string;
  dia: string;
  valor: number;
}

export interface ExportExtras {
  purchases?: ExportPurchaseRow[];
  vales?: ExportValeRow[];
  cashDiffs?: ExportCashDiffRow[];
  /** ISO date "YYYY-MM-DD" — filtra compras/vales a partir desta data */
  dataIni?: string;
  /** ISO date "YYYY-MM-DD" — filtra compras/vales até esta data */
  dataFinal?: string;
}

/**
 * Gera o CSV final mesclando:
 * - Métricas RHiD (Faltas, Atraso, HE, Vale Refeição, DSR) do relatório apurado no Painel
 * - Compras dos funcionários filtradas pelo período (campo 208)
 * - Diferença de Caixa do último import (campo 226)
 *
 * Campos preenchidos:
 *   43   – Faltas                ← processedRow.faltas
 *   44   – Desconto DSR          ← processedRow.valorDesconto
 *   150  – Horas Extras 50%      ← processedRow.horasExtrasPagarMin / 60
 *   208  – Compras               ← soma das compras no período
 *   226  – Diferença de Caixa    ← soma das diferenças importadas
 *   325  – Vale Refeição         ← processedRow.valorValeRefeicao
 *   3490 – Faltas/Atraso Horas   ← processedRow.atrasoTotalMin / 60
 */
export function exportRhidPainelReport(
  payrollRows: PayrollRow[],
  processedRows: RhidProcessedRow[],
  extras?: ExportExtras,
  filename?: string
): void {
  if (!payrollRows.length) {
    alert("Nenhum colaborador carregado para exportar.");
    return;
  }

  // Índice RHiD pelo nome normalizado
  const byNome = new Map<string, RhidProcessedRow>();
  for (const r of processedRows) {
    const key = normalizeName(r.nome);
    if (key && !byNome.has(key)) byNome.set(key, r);
  }

  // Agrega compras por funcionário (filtrado pelo período)
  const purchasesByName = new Map<string, number>();
  if (extras?.purchases?.length) {
    for (const p of extras.purchases) {
      const inRange =
        (!extras.dataIni  || p.dia >= extras.dataIni) &&
        (!extras.dataFinal || p.dia <= extras.dataFinal);
      if (!inRange) continue;
      const key = normalizeName(p.funcionario_nome);
      purchasesByName.set(key, roundTwo((purchasesByName.get(key) ?? 0) + p.valor));
    }
  }

  // Agrega vales por funcionário (filtrado pelo período)
  const valesByName = new Map<string, number>();
  if (extras?.vales?.length) {
    for (const v of extras.vales) {
      const inRange =
        (!extras.dataIni   || v.dia >= extras.dataIni) &&
        (!extras.dataFinal || v.dia <= extras.dataFinal);
      if (!inRange) continue;
      const key = normalizeName(v.funcionario_nome);
      valesByName.set(key, roundTwo((valesByName.get(key) ?? 0) + v.valor));
    }
  }

  // Agrega diferença de caixa por operador
  const cashByName = new Map<string, number>();
  if (extras?.cashDiffs?.length) {
    for (const c of extras.cashDiffs) {
      const key = normalizeName(c.operador);
      cashByName.set(key, roundTwo((cashByName.get(key) ?? 0) + c.diferenca));
    }
  }

  const merged: PayrollRow[] = payrollRows.map((row) => {
    const rhid      = byNome.get(normalizeName(row.funcionario)) ?? null;
    const nameKey   = normalizeName(row.funcionario);
    const purchases = purchasesByName.get(nameKey);
    const cashDiff  = cashByName.get(nameKey);

    // Usa compras/vale do processed row se disponível (inclui edições manuais do painel),
    // senão cai para o valor agregado pela lista bruta
    const comprasValue = rhid?.compras !== undefined ? rhid.compras : purchases;
    const valeValue    = rhid?.vale    !== undefined ? rhid.vale    : valesByName.get(nameKey);

    return {
      ...row,
      valores: {
        ...row.valores,
        ...(rhid ? {
          "43":   Math.max(0, roundTwo(rhid.faltas)),
          "44":   Math.max(0, roundTwo(rhid.valorDesconto)),
          "150":  Math.max(0, toHours(rhid.horasExtrasPagarMin)),
          "325":  Math.max(0, roundTwo(rhid.valorValeRefeicao)),
          "3490": Math.max(0, toHours(rhid.atrasoTotalMin))
        } : {}),
        ...(comprasValue !== undefined ? { "208": comprasValue } : {}),
        ...(valeValue    !== undefined ? { "460": valeValue    } : {}),
        ...(cashDiff     !== undefined ? { "226": cashDiff     } : {})
      }
    };
  });

  const csvContent = generatePayrollCSV(merged);
  const now = new Date();
  const date = now.toLocaleDateString("pt-BR").replace(/\//g, "-");
  const time = now.toLocaleTimeString("pt-BR").replace(/:/g, "-");
  downloadPayrollCSV(csvContent, filename ?? `relatorio_rhid_${date}_${time}.csv`);
}
