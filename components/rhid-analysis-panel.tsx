"use client";

import { useMemo, useState } from "react";

import { type RhidProcessedRow, type RhidReportData } from "@/lib/types";

const TOP_LIST_SIZE = 10;

function formatMinutes(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? "-" : "";
  const absolute = Math.abs(totalMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;

  return `${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatFaltas(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2
  }).format(value);
}

function metricValue(row: RhidProcessedRow, key: "atraso" | "faltas" | "extras"): string {
  if (row.semEscala) return "--";

  if (key === "faltas") {
    return formatFaltas(row.faltas);
  }

  if (key === "extras") {
    return formatMinutes(row.horasExtrasTotaisMin);
  }

  return formatMinutes(row.atrasoTotalMin);
}

interface RankingListProps {
  title: string;
  rows: RhidProcessedRow[];
  metric: "atraso" | "faltas" | "extras";
  emptyLabel: string;
}

function RankingList({ title, rows, metric, emptyLabel }: RankingListProps): JSX.Element {
  const visibleRows = rows.slice(0, TOP_LIST_SIZE);

  return (
    <article className="ranking-card">
      <h4>{title}</h4>
      {visibleRows.length === 0 ? (
        <p className="empty-text">{emptyLabel}</p>
      ) : (
        <ul>
          {visibleRows.map((row) => (
            <li key={`${title}-${row.id}`}>
              <div>
                <strong>{row.nome}</strong>
                <span>
                  Faltas: {formatFaltas(row.faltas)} | Banco: {formatMinutes(row.bancoHorasMin)}
                </span>
              </div>
              <b>{metricValue(row, metric)}</b>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

interface RhidAnalysisPanelProps {
  report: RhidReportData;
  onReportUpdate: (report: RhidReportData) => void;
}

export function RhidAnalysisPanel({ report, onReportUpdate }: RhidAnalysisPanelProps): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<"TODOS" | "DESCONTAR">("TODOS");
  const [refreshing, setRefreshing] = useState(false);
  const { processedRows, lists, summary, sourceFile, warnings } = report;

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/data", {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("Falha ao atualizar dados");
      }

      const newReport = await response.json();
      onReportUpdate(newReport);
    } catch (error) {
      console.error("Erro ao atualizar dados RHiD:", error);
      alert("Erro ao atualizar dados da API RHiD.");
    } finally {
      setRefreshing(false);
    }
  };

  const filteredRows = useMemo(() => {
    if (statusFilter === "DESCONTAR") {
      return processedRows.filter((row) => row.statusFaltas === "DESCONTAR");
    }

    return processedRows;
  }, [processedRows, statusFilter]);

  return (
    <section className="panel">
      <div className="panel-head split">
        <div>
          <h3>Analise de Ponto RHiD</h3>
          <p>
            Tabela consolidada por colaborador com regras de faltas, atrasos, horas extras, banco de horas
            e estimativa de vale refeicao.
          </p>
        </div>
        <div className="topbar-actions">
          <button className="primary-btn" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? "Atualizando..." : "Atualizar da API"}
          </button>
        </div>
      </div>

      <div className="source-info">
        <strong>Origem:</strong> {sourceFile ?? "RHiD API"}
      </div>

      {warnings.length > 0 && (
        <div className="warning-box">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      )}

      <div className="metric-grid">
        <article className="metric-card sunrise">
          <span>Total de Faltas</span>
          <strong>{formatFaltas(summary.totalFaltas)}</strong>
        </article>

        <article className="metric-card ocean">
          <span>Total de Atrasos</span>
          <strong>{formatMinutes(summary.totalAtrasoMin)}</strong>
        </article>

        <article className="metric-card lime">
          <span>Total Horas Extras</span>
          <strong>{formatMinutes(summary.totalHorasExtrasMin)}</strong>
        </article>

        <article className="metric-card slate">
          <span>Vale Refeicao Estimado</span>
          <strong>{formatCurrency(summary.totalValeRefeicao)}</strong>
          <small>{summary.regraValeRefeicao}</small>
        </article>

        <article className="metric-card sunset">
          <span>Total a descontar</span>
          <strong>{formatCurrency(summary.totalValorDesconto)}</strong>
          <small>{summary.colaboradoresComValorDesconto} colaboradores com desconto</small>
        </article>
      </div>

      <div className="table-wrapper rhid-table-wrap">
        <div className="table-tools">
          <label className="table-filter">
            <span>Filtro de desconto</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "TODOS" | "DESCONTAR")}>
              <option value="TODOS">Mostrar todos</option>
              <option value="DESCONTAR">Somente quem desconta</option>
            </select>
          </label>
          <span className="table-count">
            {filteredRows.length} de {processedRows.length} colaboradores
          </span>
        </div>

        <table className="rhid-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Faltas</th>
              <th>Qtd atrasos</th>
              <th>Atraso total</th>
              <th>Extras totais</th>
              <th>Extras a pagar</th>
              <th>Extras p/ banco</th>
              <th>Banco de horas</th>
              <th>Status faltas</th>
              <th>Alerta atraso</th>
              <th>Motivo desconto</th>
              <th>Valor a descontar</th>
              <th>Vale refeicao estimado</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.id}>
                <td className="sticky-cell employee-cell">
                  <strong>{row.nome}</strong>
                </td>
                <td>{row.semEscala ? "--" : formatFaltas(row.faltas)}</td>
                <td>{row.semEscala ? "--" : String(row.quantidadeAtrasos)}</td>
                <td>{row.semEscala ? "--" : formatMinutes(row.atrasoTotalMin)}</td>
                <td>{row.semEscala ? "--" : formatMinutes(row.horasExtrasTotaisMin)}</td>
                <td>{row.semEscala ? "--" : formatMinutes(row.horasExtrasPagarMin)}</td>
                <td>{row.semEscala ? "--" : formatMinutes(row.horasExtrasBancoMin)}</td>
                <td>{row.semEscala ? "--" : formatMinutes(row.bancoHorasMin)}</td>
                <td>
                  <span className={`status-pill ${row.statusFaltas === "DESCONTAR" ? "danger" : "ok"}`}>
                    {row.statusFaltas}
                  </span>
                </td>
                <td>
                  <span className={`status-pill ${row.alertaAtraso === "ALERTA" ? "danger" : "ok"}`}>
                    {row.alertaAtraso}
                  </span>
                </td>
                <td>{row.motivoDesconto}</td>
                <td>{formatCurrency(row.valorDesconto)}</td>
                <td>{formatCurrency(row.valorValeRefeicao)}</td>
              </tr>
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={13} className="empty-row">
                  Nenhum colaborador encontrado para esse filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rhid-list-grid">
        <RankingList
          title="Colaboradores com mais atrasos"
          rows={lists.maisAtrasos}
          metric="atraso"
          emptyLabel="Nenhum atraso registrado no periodo."
        />

        <RankingList
          title="Colaboradores com faltas"
          rows={lists.comFaltas}
          metric="faltas"
          emptyLabel="Nenhuma falta registrada no periodo."
        />

        <RankingList
          title="Colaboradores com mais horas extras"
          rows={lists.maisHorasExtras}
          metric="extras"
          emptyLabel="Nenhuma hora extra registrada no periodo."
        />
      </div>

      <div className="analysis-summary">
        <h4>Resumo analitico</h4>
        <p>
          Foram avaliados {summary.totalColaboradores} colaboradores. {summary.colaboradoresComFaltas} tem
          faltas registradas e {summary.colaboradoresComDesconto} ultrapassam o limite de 2 faltas, portanto
          entram com status DESCONTAR. {summary.colaboradoresComAlertaAtraso} colaboradores ultrapassam 5
          horas de atraso acumulado. O total a descontar nesses cenarios e{" "}
          {formatCurrency(summary.totalValorDesconto)}. O saldo total de banco de horas e{" "}
          {formatMinutes(summary.totalBancoHorasMin)} e o valor estimado total de vale refeicao e{" "}
          {formatCurrency(summary.totalValeRefeicao)} considerando {summary.diasUteisConsiderados} dias uteis.
        </p>
      </div>
    </section>
  );
}
