"use client";

import { useMemo } from "react";

import { usePayroll } from "@/components/payroll-provider";
import { FIELD_DEFINITIONS } from "@/lib/fields";
import { exportPayrollReport } from "@/lib/export-csv";

const gainCodes = FIELD_DEFINITIONS.filter((field) => field.category === "Ganhos").map((field) => field.key);
const discountCodes = FIELD_DEFINITIONS.filter((field) => field.category === "Descontos").map((field) => field.key);

function sumByCodes(values: Record<string, number>, codes: string[]): number {
  return codes.reduce((sum, code) => sum + (values[code] ?? 0), 0);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2
  }).format(value);
}

export function DashboardOverview(): JSX.Element {
  const { rows, rules, summary } = usePayroll();

  const metrics = useMemo(() => {
    const ganhos = rows.reduce((sum, row) => sum + sumByCodes(row.valores, gainCodes), 0);
    const descontos = rows.reduce((sum, row) => sum + sumByCodes(row.valores, discountCodes), 0);
    const alertas = rows.filter((row) => (row.valores["43"] ?? 0) > 0 || (row.valores["226"] ?? 0) !== 0).length;

    return {
      ganhos,
      descontos,
      alertas,
      regrasAtivas: rules.filter((rule) => rule.ativo).length
    };
  }, [rows, rules]);

  const ranking = useMemo(() => {
    return [...rows]
      .sort((first, second) => (second.valores["208"] ?? 0) - (first.valores["208"] ?? 0))
      .slice(0, 5);
  }, [rows]);

  const handleExportReport = () => {
    exportPayrollReport(rows);
  };

  return (
    <section className="panel">
      <div className="panel-head split">
        <div>
          <h3>Visao Geral da Operacao</h3>
          <p>Painel em tempo real com totais de folha, alertas e automacoes.</p>
        </div>
        <button 
          className="btn btn-primary"
          onClick={handleExportReport}
          title="Exporta relatorio completo em CSV para enviar ao RH"
        >
          📥 Exportar Relatorio para RH
        </button>
      </div>

      <div className="metric-grid">
        <article className="metric-card sunrise">
          <span>Total Ganhos</span>
          <strong>{formatCurrency(metrics.ganhos)}</strong>
        </article>

        <article className="metric-card ocean">
          <span>Total Descontos</span>
          <strong>{formatCurrency(metrics.descontos)}</strong>
        </article>

        <article className="metric-card lime">
          <span>Alertas de ponto/caixa</span>
          <strong>{metrics.alertas}</strong>
        </article>

        <article className="metric-card slate">
          <span>Regras ativas</span>
          <strong>{metrics.regrasAtivas}</strong>
          <small>{summary ? `Ultima execucao: ${new Date(summary.ultimaExecucao).toLocaleTimeString("pt-BR")}` : "Sem execucao"}</small>
        </article>
      </div>

      <div className="ranking-card">
        <h4>Top 5 compras por colaborador</h4>

        <ul>
          {ranking.map((row) => (
            <li key={row.id}>
              <div>
                <strong>{row.funcionario}</strong>
                <span>{row.funcao}</span>
              </div>
              <b>{formatCurrency(row.valores["208"] ?? 0)}</b>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
