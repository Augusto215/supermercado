"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { usePayroll } from "@/components/payroll-provider";

interface EmployeePurchase {
  id: string;
  funcionarioId: string;
  funcionarioNome: string;
  produto: string;
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
  produto: string;
  dia: string;
  valor: number;
}

function fromDb(row: DbRow): EmployeePurchase {
  return {
    id:              row.id,
    funcionarioId:   row.funcionario_id,
    funcionarioNome: row.funcionario_nome,
    produto:         row.produto,
    dia:             row.dia,
    valor:           Number(row.valor)
  };
}

export function EmployeePurchasesPanel(): JSX.Element {
  const { rows } = usePayroll();
  const [purchases, setPurchases] = useState<EmployeePurchase[]>([]);
  const [loaded, setLoaded]       = useState(false);
  const [saving, setSaving]       = useState(false);
  const [funcionarioId, setFuncionarioId] = useState("");
  const [produto, setProduto]     = useState("");
  const [dia, setDia]             = useState(defaultDateValue);
  const [valor, setValor]         = useState("");
  const [error, setError]         = useState<string | null>(null);

  const employeeOptions = useMemo(
    () =>
      [...rows]
        .map((row) => ({ id: row.id, codigo: row.codigo, nome: row.funcionario }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [rows]
  );

  // Keep selected employee valid when the list changes
  useEffect(() => {
    if (employeeOptions.length === 0) { setFuncionarioId(""); return; }
    if (!employeeOptions.some((e) => e.id === funcionarioId)) {
      setFuncionarioId(employeeOptions[0].id);
    }
  }, [employeeOptions, funcionarioId]);

  // Load from Supabase on mount
  useEffect(() => {
    fetch("/api/purchases")
      .then((res) => res.json())
      .then((data: DbRow[]) => {
        if (Array.isArray(data)) setPurchases(data.map(fromDb));
      })
      .catch(() => { /* silently fail — show empty state */ })
      .finally(() => setLoaded(true));
  }, []);

  const metrics = useMemo(() => {
    const totalLancamentos = purchases.length;
    const valorTotal  = purchases.reduce((t, r) => t + r.valor, 0);
    const ticketMedio = totalLancamentos > 0 ? valorTotal / totalLancamentos : 0;
    const maiorCompra = purchases.length > 0
      ? purchases.reduce((best, r) => r.valor > best.valor ? r : best, purchases[0])
      : null;

    const totalPorDia = new Map<string, number>();
    for (const r of purchases) totalPorDia.set(r.dia, (totalPorDia.get(r.dia) ?? 0) + r.valor);

    let melhorDia: { dia: string; total: number } | null = null;
    for (const [day, total] of totalPorDia.entries()) {
      if (!melhorDia || total > melhorDia.total) melhorDia = { dia: day, total };
    }

    return { totalLancamentos, valorTotal, ticketMedio, maiorCompra, melhorDia };
  }, [purchases]);

  const sortedPurchases = useMemo(
    () => [...purchases].sort((a, b) => b.dia.localeCompare(a.dia)),
    [purchases]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!funcionarioId) { setError("Selecione o funcionario da compra."); return; }
    const selectedEmployee = employeeOptions.find((e) => e.id === funcionarioId);
    if (!selectedEmployee) { setError("Funcionario selecionado nao foi encontrado."); return; }
    const nextProduto = produto.trim();
    if (!nextProduto) { setError("Informe o produto para registrar a compra."); return; }
    if (!dia) { setError("Informe o dia da compra."); return; }
    const parsedValue = parseMoney(valor);
    if (parsedValue === null) { setError("Informe um valor valido maior que zero."); return; }

    setSaving(true);
    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          funcionarioId:   selectedEmployee.id,
          funcionarioNome: selectedEmployee.nome,
          produto:         nextProduto,
          dia,
          valor:           parsedValue
        })
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Erro ao salvar compra.");
      }

      const created = fromDb((await res.json()) as DbRow);
      setPurchases((prev) => [created, ...prev]);
      setProduto("");
      setValor("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar compra.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await fetch(`/api/purchases/${id}`, { method: "DELETE" });
      setPurchases((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setError("Erro ao excluir compra. Tente novamente.");
    }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <p className="section-kicker">Lancamento manual</p>
        <h3>Compras dos Funcionarios</h3>
        <p>Registre manualmente cada compra informando funcionario, produto, dia e valor.</p>
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
            <span>Produto</span>
            <input
              className="filter-input"
              value={produto}
              onChange={(e) => setProduto(e.target.value)}
              placeholder="Ex.: Arroz 5kg"
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
              placeholder="Ex.: 42,90"
            />
          </label>
        </div>

        <div className="manual-actions">
          <button className="primary-btn" type="submit" disabled={saving}>
            {saving ? "Salvando..." : "Adicionar compra"}
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
          <span>Maior compra</span>
          <strong>{metrics.maiorCompra ? formatCurrency(metrics.maiorCompra.valor) : "R$ 0,00"}</strong>
          <small>
            {metrics.maiorCompra
              ? `${metrics.maiorCompra.produto} - ${metrics.maiorCompra.funcionarioNome}`
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
              <th>Produto</th>
              <th>Valor</th>
              <th>Acao</th>
            </tr>
          </thead>
          <tbody>
            {sortedPurchases.map((row) => (
              <tr key={row.id}>
                <td>{formatDate(row.dia)}</td>
                <td>{row.funcionarioNome}</td>
                <td><strong>{row.produto}</strong></td>
                <td>{formatCurrency(row.valor)}</td>
                <td>
                  <button className="danger-btn" type="button" onClick={() => void handleRemove(row.id)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
            {loaded && sortedPurchases.length === 0 && (
              <tr>
                <td colSpan={5} className="empty-row">
                  Nenhuma compra registrada ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
