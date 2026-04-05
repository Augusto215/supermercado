"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { usePayroll } from "@/components/payroll-provider";

interface EmployeeVale {
  id: string;
  funcionarioId: string;
  funcionarioNome: string;
  descricao: string;
  dia: string;
  valor: number;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2
  }).format(value);
}

function formatDate(isoDate: string): string {
  if (!isoDate) return "Sem data";
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString("pt-BR");
}

function parseMoney(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const cleaned = trimmed
    .replace(/\s+/g, "")
    .replace(/R\$/gi, "")
    .replace(/[^\d,.-]/g, "");

  if (!cleaned || cleaned === "-" || cleaned === "," || cleaned === ".") return null;

  const commaIndex = cleaned.lastIndexOf(",");
  const dotIndex   = cleaned.lastIndexOf(".");
  let normalized   = cleaned;

  if (commaIndex !== -1 && dotIndex !== -1) {
    normalized = commaIndex > dotIndex
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (commaIndex !== -1) {
    normalized = cleaned.replace(",", ".");
  } else if (dotIndex !== -1) {
    const parts = cleaned.split(".");
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      normalized = cleaned.replace(/\./g, "");
    }
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Number(parsed.toFixed(2));
}

function defaultDateValue(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

interface DbRow {
  id: string;
  funcionario_id: string;
  funcionario_nome: string;
  descricao: string;
  dia: string;
  valor: number;
}

function fromDb(row: DbRow): EmployeeVale {
  return {
    id:              row.id,
    funcionarioId:   row.funcionario_id,
    funcionarioNome: row.funcionario_nome,
    descricao:       row.descricao,
    dia:             row.dia,
    valor:           Number(row.valor)
  };
}

export function EmployeeValesPanel(): JSX.Element {
  const { rows } = usePayroll();
  const [vales, setVales]             = useState<EmployeeVale[]>([]);
  const [loaded, setLoaded]           = useState(false);
  const [saving, setSaving]           = useState(false);
  const [funcionarioId, setFuncionarioId] = useState("");
  const [descricao, setDescricao]     = useState("");
  const [dia, setDia]                 = useState(defaultDateValue);
  const [valor, setValor]             = useState("");
  const [error, setError]             = useState<string | null>(null);
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editDescricao, setEditDescricao] = useState("");
  const [editDia, setEditDia]         = useState("");
  const [editValor, setEditValor]     = useState("");
  const [editFuncId, setEditFuncId]   = useState("");

  const employeeOptions = useMemo(
    () =>
      [...rows]
        .map((row) => ({ id: row.id, codigo: row.codigo, nome: row.funcionario }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [rows]
  );

  useEffect(() => {
    if (employeeOptions.length === 0) { setFuncionarioId(""); return; }
    if (!employeeOptions.some((e) => e.id === funcionarioId)) {
      setFuncionarioId(employeeOptions[0].id);
    }
  }, [employeeOptions, funcionarioId]);

  useEffect(() => {
    fetch("/api/vales")
      .then((res) => res.json())
      .then((data: DbRow[]) => {
        if (Array.isArray(data)) setVales(data.map(fromDb));
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const metrics = useMemo(() => {
    const totalLancamentos = vales.length;
    const valorTotal  = vales.reduce((t, r) => t + r.valor, 0);
    const ticketMedio = totalLancamentos > 0 ? valorTotal / totalLancamentos : 0;
    const maiorVale   = vales.length > 0
      ? vales.reduce((best, r) => r.valor > best.valor ? r : best, vales[0])
      : null;

    const totalPorDia = new Map<string, number>();
    for (const r of vales) totalPorDia.set(r.dia, (totalPorDia.get(r.dia) ?? 0) + r.valor);

    let melhorDia: { dia: string; total: number } | null = null;
    for (const [day, total] of totalPorDia.entries()) {
      if (!melhorDia || total > melhorDia.total) melhorDia = { dia: day, total };
    }

    return { totalLancamentos, valorTotal, ticketMedio, maiorVale, melhorDia };
  }, [vales]);

  const sortedVales = useMemo(
    () => [...vales].sort((a, b) => b.dia.localeCompare(a.dia)),
    [vales]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!funcionarioId) { setError("Selecione o funcionario do vale."); return; }
    const selectedEmployee = employeeOptions.find((e) => e.id === funcionarioId);
    if (!selectedEmployee) { setError("Funcionario selecionado nao foi encontrado."); return; }
    const nextDescricao = descricao.trim();
    if (!nextDescricao) { setError("Informe a descricao do vale."); return; }
    if (!dia) { setError("Informe o dia do vale."); return; }
    const parsedValue = parseMoney(valor);
    if (parsedValue === null) { setError("Informe um valor valido maior que zero."); return; }

    setSaving(true);
    try {
      const res = await fetch("/api/vales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          funcionarioId:   selectedEmployee.id,
          funcionarioNome: selectedEmployee.nome,
          descricao:       nextDescricao,
          dia,
          valor:           parsedValue
        })
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Erro ao salvar vale.");
      }

      const created = fromDb((await res.json()) as DbRow);
      setVales((prev) => [created, ...prev]);
      setDescricao("");
      setValor("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar vale.");
    } finally {
      setSaving(false);
    }
  };

  const handleStartEdit = (row: EmployeeVale) => {
    setEditingId(row.id);
    setEditDescricao(row.descricao);
    setEditDia(row.dia);
    setEditValor(String(row.valor).replace(".", ","));
    setEditFuncId(row.funcionarioId);
    setError(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleSaveEdit = async (id: string) => {
    const parsedValue = parseMoney(editValor);
    if (parsedValue === null) { setError("Informe um valor valido maior que zero."); return; }
    const selectedEmployee = employeeOptions.find((e) => e.id === editFuncId);
    if (!selectedEmployee) { setError("Funcionario nao encontrado."); return; }

    setSaving(true);
    try {
      const res = await fetch(`/api/vales/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          funcionarioId:   selectedEmployee.id,
          funcionarioNome: selectedEmployee.nome,
          descricao:       editDescricao.trim(),
          dia:             editDia,
          valor:           parsedValue
        })
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Erro ao salvar.");
      }

      const updated = fromDb((await res.json()) as DbRow);
      setVales((prev) => prev.map((r) => r.id === id ? updated : r));
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao editar vale.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await fetch(`/api/vales/${id}`, { method: "DELETE" });
      setVales((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setError("Erro ao excluir vale. Tente novamente.");
    }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <p className="section-kicker">Lancamento manual</p>
        <h3>Vales dos Funcionarios</h3>
        <p>Registre manualmente cada vale informando funcionario, descricao, dia e valor.</p>
        <div className="panel-badges">
          <span className="panel-badge">{metrics.totalLancamentos} lancamentos</span>
          <span className="panel-badge">Total registrado: {formatCurrency(metrics.valorTotal)}</span>
        </div>
      </div>

      <form className="manual-form" onSubmit={(e) => void handleSubmit(e)}>
        <div className="manual-form-grid">
          <label className="manual-field">
            <span>Funcionario</span>
            <select
              className="filter-input"
              value={funcionarioId}
              onChange={(e) => setFuncionarioId(e.target.value)}
              disabled={employeeOptions.length === 0}
            >
              {employeeOptions.length === 0 && <option value="">Sem funcionarios disponiveis</option>}
              {employeeOptions.map((e) => (
                <option key={e.id} value={e.id}>{e.nome} ({e.codigo})</option>
              ))}
            </select>
          </label>

          <label className="manual-field">
            <span>Descricao</span>
            <input
              className="filter-input"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex.: Adiantamento quinzena"
            />
          </label>

          <label className="manual-field">
            <span>Dia</span>
            <input className="filter-input" type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
          </label>

          <label className="manual-field">
            <span>Valor</span>
            <input
              className="filter-input"
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder="Ex.: 150,00"
            />
          </label>
        </div>

        <div className="manual-actions">
          <button className="primary-btn" type="submit" disabled={saving}>
            {saving ? "Salvando..." : "Adicionar vale"}
          </button>
        </div>
      </form>

      {error && (
        <div className="warning-box">
          <p>{error}</p>
        </div>
      )}

      <div className="metric-grid">
        <article className="metric-card sunrise">
          <span>Lancamentos</span>
          <strong>{metrics.totalLancamentos}</strong>
        </article>

        <article className="metric-card lime">
          <span>Valor total</span>
          <strong>{formatCurrency(metrics.valorTotal)}</strong>
        </article>

        <article className="metric-card ocean">
          <span>Ticket medio</span>
          <strong>{formatCurrency(metrics.ticketMedio)}</strong>
        </article>

        <article className="metric-card sunset">
          <span>Maior vale</span>
          <strong>{metrics.maiorVale ? formatCurrency(metrics.maiorVale.valor) : "R$ 0,00"}</strong>
          <small>
            {metrics.maiorVale
              ? `${metrics.maiorVale.descricao} - ${metrics.maiorVale.funcionarioNome}`
              : "Sem lancamentos"}
          </small>
        </article>

        <article className="metric-card slate">
          <span>Dia com maior total</span>
          <strong>{metrics.melhorDia ? formatDate(metrics.melhorDia.dia) : "Sem dia"}</strong>
          <small>{metrics.melhorDia ? formatCurrency(metrics.melhorDia.total) : "R$ 0,00"}</small>
        </article>
      </div>

      <div className="table-wrapper">
        <table className="purchases-table">
          <thead>
            <tr>
              <th>Dia</th>
              <th>Funcionario</th>
              <th>Descricao</th>
              <th>Valor</th>
              <th>Acao</th>
            </tr>
          </thead>
          <tbody>
            {sortedVales.map((row) =>
              editingId === row.id ? (
                <tr key={row.id}>
                  <td>
                    <input className="filter-input" type="date" value={editDia} onChange={(e) => setEditDia(e.target.value)} />
                  </td>
                  <td>
                    <select className="filter-input" value={editFuncId} onChange={(e) => setEditFuncId(e.target.value)}>
                      {employeeOptions.map((e) => (
                        <option key={e.id} value={e.id}>{e.nome}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="filter-input" value={editDescricao} onChange={(e) => setEditDescricao(e.target.value)} />
                  </td>
                  <td>
                    <input className="filter-input" inputMode="decimal" value={editValor} onChange={(e) => setEditValor(e.target.value)} />
                  </td>
                  <td style={{ display: "flex", gap: "0.4rem" }}>
                    <button className="primary-btn" type="button" disabled={saving} onClick={() => void handleSaveEdit(row.id)}>
                      Salvar
                    </button>
                    <button className="secondary-btn" type="button" onClick={handleCancelEdit}>
                      Cancelar
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={row.id}>
                  <td>{formatDate(row.dia)}</td>
                  <td>{row.funcionarioNome}</td>
                  <td><strong>{row.descricao}</strong></td>
                  <td>{formatCurrency(row.valor)}</td>
                  <td style={{ display: "flex", gap: "0.4rem" }}>
                    <button className="secondary-btn" type="button" onClick={() => handleStartEdit(row)}>
                      Editar
                    </button>
                    <button className="danger-btn" type="button" onClick={() => void handleRemove(row.id)}>
                      Excluir
                    </button>
                  </td>
                </tr>
              )
            )}
            {loaded && sortedVales.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-row">
                  Nenhum vale registrado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
