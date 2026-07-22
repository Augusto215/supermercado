"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface AlertRow {
  id: string;
  funcionario_id: string;
  funcionario_nome: string;
  departamento: string | null;
  cargo: string | null;
  dia: string;
  extra_min: number;
  mais_2h_extra: boolean;
  batida_incompleta: boolean;
  qtd_batidas: number;
  detalhe: string | null;
  atualizado_em: string;
}

interface Period {
  dataIni: string;
  dataFinal: string;
}

type TipoFiltro = "TODOS" | "2h" | "batida";

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatDate(isoDate: string): string {
  if (!isoDate) return "";
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

function formatDateTime(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR");
}

export function PontoAlertsPanel(): JSX.Element {
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [period, setPeriod] = useState<Period | null>(null);
  const [tipo, setTipo] = useState<TipoFiltro>("TODOS");
  const [busca, setBusca] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAlerts = useCallback(async (nextTipo: TipoFiltro) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nextTipo !== "TODOS") params.set("tipo", nextTipo);
      const res = await fetch(`/api/ponto-alertas?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Falha ao carregar alertas de ponto.");
      const data = (await res.json()) as { period: Period; rows: AlertRow[] };
      setRows(Array.isArray(data.rows) ? data.rows : []);
      setPeriod(data.period);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar alertas de ponto.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAlerts(tipo);
  }, [tipo, loadAlerts]);

  const handleRefreshAgora = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/ponto-alertas", { method: "POST" });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Falha ao atualizar dados do RHiD.");
      }
      await loadAlerts(tipo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao atualizar dados do RHiD.");
    } finally {
      setRefreshing(false);
    }
  };

  const filteredRows = useMemo(() => {
    const term = busca.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (r) =>
        r.funcionario_nome.toLowerCase().includes(term) ||
        (r.departamento ?? "").toLowerCase().includes(term)
    );
  }, [rows, busca]);

  const metrics = useMemo(() => {
    const colaboradores = new Set(filteredRows.map((r) => r.funcionario_id));
    const com2h = filteredRows.filter((r) => r.mais_2h_extra).length;
    const comBatida = filteredRows.filter((r) => r.batida_incompleta).length;
    const ultimaAtualizacao = filteredRows.reduce<string | null>((max, r) => {
      if (!max || r.atualizado_em > max) return r.atualizado_em;
      return max;
    }, null);
    return { colaboradores: colaboradores.size, com2h, comBatida, ultimaAtualizacao };
  }, [filteredRows]);

  return (
    <section className="panel">
      <div className="panel-head split">
        <div>
          <p className="section-kicker">Dia a dia</p>
          <h3>Alertas de Ponto</h3>
          <p>
            Colaboradores que ultrapassaram 2h de hora extra em um único dia ou que ficaram com uma batida
            incompleta no ponto (entrada ou saída não registrada). Atualizado automaticamente a cada 10 minutos
            a partir da API do RHiD.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => void handleRefreshAgora()} disabled={refreshing}>
          {refreshing ? "Atualizando..." : "Atualizar agora"}
        </button>
      </div>

      {period && (
        <p className="period-hint">
          Período: <strong>{formatDate(period.dataIni)} até {formatDate(period.dataFinal)}</strong>
          {metrics.ultimaAtualizacao && (
            <> &mdash; última leitura do ponto: <strong>{formatDateTime(metrics.ultimaAtualizacao)}</strong></>
          )}
        </p>
      )}

      {error && (
        <div className="warning-box">
          <p>{error}</p>
        </div>
      )}

      <div className="metric-grid">
        <article className="metric-card sunrise">
          <span>Colaboradores com alerta</span>
          <strong>{metrics.colaboradores}</strong>
        </article>
        <article className="metric-card sunset">
          <span>Dias com +2h de extra</span>
          <strong>{metrics.com2h}</strong>
        </article>
        <article className="metric-card ocean">
          <span>Dias com batida incompleta</span>
          <strong>{metrics.comBatida}</strong>
        </article>
      </div>

      <div className="table-wrapper">
        <div className="table-tools">
          <div className="table-filters-row">
            <label className="table-filter">
              <span>Tipo de alerta</span>
              <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoFiltro)}>
                <option value="TODOS">Todos os alertas</option>
                <option value="2h">Somente +2h de extra no dia</option>
                <option value="batida">Somente batida incompleta</option>
              </select>
            </label>
            <label className="table-filter">
              <span>Buscar colaborador</span>
              <input
                className="filter-input"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome ou departamento"
              />
            </label>
          </div>
          <span className="table-count">{filteredRows.length} dia(s) com alerta</span>
        </div>

        <table className="purchases-table">
          <thead>
            <tr>
              <th>Dia</th>
              <th>Funcionario</th>
              <th>Departamento</th>
              <th>Extra no dia</th>
              <th>Batidas no dia</th>
              <th>Alerta</th>
              <th>Detalhe</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="empty-row">Carregando...</td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty-row">Nenhum alerta de ponto no período selecionado.</td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDate(row.dia)}</td>
                  <td><strong>{row.funcionario_nome}</strong></td>
                  <td>{row.departamento || "—"}</td>
                  <td>{formatMinutes(row.extra_min)}</td>
                  <td>{row.qtd_batidas}</td>
                  <td>
                    <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                      {row.mais_2h_extra && <span className="status-pill danger">+2H EXTRA</span>}
                      {row.batida_incompleta && <span className="status-pill danger">BATIDA INCOMPLETA</span>}
                    </div>
                  </td>
                  <td>{row.detalhe || "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
