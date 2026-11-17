"use client";

import { useCallback, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import { calcDiasValeTransporte, calcValeTransporte, contarDiasUteisMes } from "@/lib/fields";
import { type RhidProcessedRow, type RhidReportData } from "@/lib/types";

/**
 * Vale Transporte
 *
 * VT = (dias úteis do mês atual - faltas do mês anterior) x padrão (R$ por dia)
 *
 * - Lista = colaboradores ativos no ponto (RHiD). Desligado sai sozinho.
 * - Padrão: carga inicial das planilhas de transporte; colaborador novo vem em branco
 *   para o RH preencher aqui. Depois de salvo, fica para os próximos meses.
 * - Faltas do mês anterior = período de apuração 21 do mês anterior a 20 do mês do VT.
 */

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

type Origem = "planilha" | "manual" | "novo";

interface LinhaVt {
  id: string;
  nome: string;
  departamento: string;
  faltas: number;
  padraoDia: number | null;
  origem: Origem;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function formatPadrao(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseValor(raw: string): number | null | undefined {
  const t = raw.trim().replace(/^R\$\s*/i, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function periodoFaltas(mes: string) {
  const [y, m] = mes.split("-").map(Number);
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  const fim = `${y}-${String(m).padStart(2, "0")}-20`;
  const hoje = todayIso();
  return {
    dataIni: `${prevYear}-${String(prevMonth).padStart(2, "0")}-21`,
    dataFinal: fim > hoje ? hoje : fim,
  };
}

function mesOptions() {
  const now = new Date();
  const opts: { value: string; label: string }[] = [];
  // do próximo mês (VT costuma ser pago antes) até 12 meses atrás
  for (let i = 1; i >= -12; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    opts.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: `${MONTHS[d.getMonth()]} de ${d.getFullYear()}`,
    });
  }
  return opts;
}

function mesAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function diasUteisDoMes(mes: string): number {
  const [y, m] = mes.split("-").map(Number);
  return contarDiasUteisMes(y, m - 1);
}

function toLinha(row: RhidProcessedRow): LinhaVt {
  return {
    id: row.id,
    nome: row.nome,
    departamento: row.departamento ?? "",
    faltas: row.faltas,
    padraoDia: row.vtPadraoDia ?? null,
    origem: row.vtPadraoOrigem ?? (row.vtPadraoDia ? "planilha" : "novo"),
  };
}

const ORIGEM_LABEL: Record<Origem, string> = {
  planilha: "Planilha",
  manual: "Preenchido",
  novo: "Novo",
};

// ─── Célula do padrão (editável, salva no banco) ─────────────────────────────

function PadraoCell({
  linha,
  onSave,
}: {
  linha: LinhaVt;
  onSave: (linha: LinhaVt, valor: number | null) => Promise<void>;
}) {
  const inicial = linha.padraoDia === null ? "" : formatPadrao(linha.padraoDia);
  const [draft, setDraft] = useState(inicial);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [ultimoInicial, setUltimoInicial] = useState(inicial);

  if (inicial !== ultimoInicial) {
    setUltimoInicial(inicial);
    setDraft(inicial);
  }

  const commit = async () => {
    const valor = parseValor(draft);
    if (valor === undefined) {
      setStatus("error");
      return;
    }
    if (valor === linha.padraoDia) {
      setDraft(valor === null ? "" : formatPadrao(valor));
      setStatus("idle");
      return;
    }
    setStatus("saving");
    try {
      await onSave(linha, valor);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  return (
    <input
      className="table-input"
      style={{
        width: 90,
        textAlign: "right",
        borderColor: status === "error" ? "#dc2626" : linha.padraoDia === null ? "#f59e0b" : undefined,
        background: linha.padraoDia === null ? "#fffbeb" : undefined,
      }}
      inputMode="decimal"
      placeholder="Preencher"
      value={draft}
      disabled={status === "saving"}
      title={status === "error" ? "Valor inválido ou falha ao salvar" : "Padrão em R$ por dia (ex.: 9,60). Enter para salvar."}
      onChange={(e) => {
        setDraft(e.target.value);
        if (status === "error") setStatus("idle");
      }}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(inicial);
          setStatus("idle");
        }
      }}
    />
  );
}

// ─── Exportação para planilha ────────────────────────────────────────────────

function exportarPlanilha(linhas: LinhaVt[], diasUteis: number, mesLabel: string) {
  const header = ["FUNCIONÁRIO", "DEPARTAMENTO", "F", "DIAS", "PADRÃO (CUSTO DIA)", "TOTAL"];
  const montarAba = (lista: LinhaVt[]) => {
    const rows: (string | number | null)[][] = [header];
    for (const l of lista) {
      rows.push([
        l.nome,
        l.departamento,
        l.faltas,
        calcDiasValeTransporte(diasUteis, l.faltas),
        l.padraoDia,
        calcValeTransporte(diasUteis, l.faltas, l.padraoDia),
      ]);
    }
    const total = lista.reduce((s, l) => s + calcValeTransporte(diasUteis, l.faltas, l.padraoDia), 0);
    rows.push(["TOTAL", "", "", "", "", Math.round(total * 100) / 100]);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 42 }, { wch: 22 }, { wch: 5 }, { wch: 6 }, { wch: 18 }, { wch: 12 }];
    return ws;
  };

  const ordenadas = [...linhas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const wb = XLSX.utils.book_new();

  const info = XLSX.utils.aoa_to_sheet([
    [`VALE TRANSPORTE — ${mesLabel.toUpperCase()}`],
    [`Dias úteis do mês: ${diasUteis}`],
    ["Regra: (dias úteis do mês atual - faltas do mês anterior) x padrão (R$ por dia)"],
  ]);
  XLSX.utils.book_append_sheet(wb, montarAba(ordenadas), "VT - GERAL");

  // Uma aba por padrão, igual à planilha manual ("PADRÃO 9,60", "PADRÃO 12,00"...)
  const porPadrao = new Map<number, LinhaVt[]>();
  for (const l of ordenadas) {
    if (l.padraoDia === null) continue;
    porPadrao.set(l.padraoDia, [...(porPadrao.get(l.padraoDia) ?? []), l]);
  }
  for (const padrao of [...porPadrao.keys()].sort((a, b) => a - b)) {
    XLSX.utils.book_append_sheet(wb, montarAba(porPadrao.get(padrao)!), `PADRÃO ${formatPadrao(padrao)}`);
  }
  const semPadrao = ordenadas.filter((l) => l.padraoDia === null);
  if (semPadrao.length) XLSX.utils.book_append_sheet(wb, montarAba(semPadrao), "SEM PADRÃO");
  XLSX.utils.book_append_sheet(wb, info, "INFO");

  XLSX.writeFile(wb, `VT ${mesLabel.toUpperCase()}.xlsx`);
}

// ─── Painel ──────────────────────────────────────────────────────────────────

export function ValeTransportePanel(): JSX.Element {
  const opcoes = useMemo(() => mesOptions(), []);
  const [mes, setMes] = useState(mesAtual());
  const [diasUteis, setDiasUteis] = useState<number>(diasUteisDoMes(mesAtual()));
  const [mesCarregado, setMesCarregado] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<LinhaVt[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [soSemPadrao, setSoSemPadrao] = useState(false);

  const mesLabel = opcoes.find((o) => o.value === (mesCarregado ?? mes))?.label ?? mes;

  const carregar = useCallback(async () => {
    const { dataIni, dataFinal } = periodoFaltas(mes);
    setLoading(true);
    setError(null);
    setProgress({ current: 0, total: 0 });
    try {
      const res = await fetch(`/api/data?${new URLSearchParams({ dataIni, dataFinal })}`, { cache: "no-store" });
      if (!res.body) throw new Error("Resposta sem corpo.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let report: RhidReportData | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(t.slice(5).trim()) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (ev.type === "progress") setProgress({ current: ev.current as number, total: ev.total as number });
          else if (ev.type === "done") report = ev.report as RhidReportData;
          else if (ev.type === "error") throw new Error(ev.message as string);
        }
      }
      if (!report) throw new Error("Relatório não retornado.");
      setLinhas(report.processedRows.map(toLinha));
      setWarnings(report.warnings.filter((w) => /VT/i.test(w)));
      setMesCarregado(mes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao consultar o ponto (RHiD).");
    } finally {
      setLoading(false);
    }
  }, [mes]);

  const salvarPadrao = useCallback(async (linha: LinhaVt, valor: number | null) => {
    setSaveError(null);
    const res = await fetch("/api/vale-transporte/padroes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ funcionarioId: linha.id, funcionarioNome: linha.nome, padraoDia: valor }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const msg = body.error ?? "Falha ao salvar o padrão.";
      setSaveError(`${linha.nome}: ${msg}`);
      throw new Error(msg);
    }
    const salvo = (await res.json()) as { padraoDia: number | null; origem: Origem };
    setLinhas((atual) =>
      atual.map((l) => (l.id === linha.id ? { ...l, padraoDia: salvo.padraoDia, origem: salvo.origem } : l))
    );
  }, []);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas
      .filter((l) => (!soSemPadrao || l.padraoDia === null))
      .filter((l) => !q || l.nome.toLowerCase().includes(q) || l.departamento.toLowerCase().includes(q))
      .sort((a, b) => {
        // sem padrão primeiro, para o RH ver o que falta preencher
        if ((a.padraoDia === null) !== (b.padraoDia === null)) return a.padraoDia === null ? -1 : 1;
        return a.nome.localeCompare(b.nome, "pt-BR");
      });
  }, [linhas, busca, soSemPadrao]);

  const total = useMemo(
    () => linhas.reduce((s, l) => s + calcValeTransporte(diasUteis, l.faltas, l.padraoDia), 0),
    [linhas, diasUteis]
  );
  const semPadrao = linhas.filter((l) => l.padraoDia === null).length;

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-head split">
          <div>
            <h3>Vale Transporte</h3>
            <p>
              VT = (dias úteis do mês - faltas do mês anterior) x padrão (R$ por dia). A lista vem do ponto:
              desligados saem sozinhos e novos entram com o padrão em branco para preencher.
            </p>
          </div>
          {mesCarregado && (
            <button
              className="btn btn-primary"
              onClick={() => exportarPlanilha(linhas, diasUteis, mesLabel)}
              disabled={!linhas.length}
            >
              Exportar planilha
            </button>
          )}
        </div>

        <div className="selector-row">
          <div className="selector-field">
            <label className="selector-label" htmlFor="vt-mes">Mês do VT</label>
            <select
              id="vt-mes"
              className="selector-input"
              value={mes}
              onChange={(e) => {
                setMes(e.target.value);
                setDiasUteis(diasUteisDoMes(e.target.value));
              }}
            >
              {opcoes.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="selector-field">
            <label className="selector-label" htmlFor="vt-dias">Dias úteis do mês (seg. a sáb.)</label>
            <input
              id="vt-dias"
              className="selector-input"
              type="number"
              min={0}
              max={31}
              value={diasUteis}
              onChange={(e) => setDiasUteis(Math.max(0, Number(e.target.value) || 0))}
              title="Desconte os feriados do mês, se houver"
            />
          </div>
          <div className="selector-field" style={{ justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={() => void carregar()} disabled={loading}>
              {loading
                ? progress.total
                  ? `Apurando ${progress.current}/${progress.total}...`
                  : "Carregando do ponto..."
                : mesCarregado
                  ? "Recarregar"
                  : "Carregar"}
            </button>
          </div>
        </div>
        <p className="empty-text" style={{ marginTop: 8 }}>
          Faltas consideradas: {(() => {
            const { dataIni, dataFinal } = periodoFaltas(mes);
            const f = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("pt-BR");
            return `${f(dataIni)} até ${f(dataFinal)}`;
          })()}. Ajuste os dias úteis se o mês tiver feriado.
        </p>

        {error && <div className="warning-box"><p>{error}</p></div>}
        {saveError && <div className="warning-box"><p>{saveError}</p></div>}
        {warnings.map((w) => <div key={w} className="warning-box"><p>{w}</p></div>)}
      </section>

      {mesCarregado && (
        <>
          <div className="metric-grid">
            <article className="metric-card ocean">
              <span>Total VT — {mesLabel}</span>
              <strong>{formatCurrency(total)}</strong>
              <small>{diasUteis} dias úteis</small>
            </article>
            <article className="metric-card slate">
              <span>Colaboradores ativos</span>
              <strong>{linhas.length}</strong>
            </article>
            <article className={`metric-card ${semPadrao ? "sunset" : "lime"}`}>
              <span>Sem padrão preenchido</span>
              <strong>{semPadrao}</strong>
              <small>{semPadrao ? "Preencha o padrão na tabela" : "Todos preenchidos"}</small>
            </article>
          </div>

          <section className="panel">
            <div className="table-wrapper">
              <div className="table-tools">
                <div className="table-filters-row">
                  <label className="table-filter">
                    <span>Buscar</span>
                    <input
                      className="filter-input"
                      placeholder="Nome ou departamento"
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                    />
                  </label>
                  <label className="table-filter" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <input type="checkbox" checked={soSemPadrao} onChange={(e) => setSoSemPadrao(e.target.checked)} />
                    <span>Só sem padrão</span>
                  </label>
                </div>
                <span className="table-count">{filtradas.length} colaboradores</span>
              </div>

              <table className="rhid-table">
                <thead>
                  <tr>
                    <th>Funcionário</th>
                    <th>Departamento</th>
                    <th>Faltas (mês anterior)</th>
                    <th>Dias</th>
                    <th>Padrão (R$/dia)</th>
                    <th>Total VT</th>
                    <th>Origem do padrão</th>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((l) => (
                    <tr key={l.id}>
                      <td className="sticky-cell employee-cell"><strong>{l.nome}</strong></td>
                      <td>{l.departamento || "--"}</td>
                      <td>{l.faltas}</td>
                      <td>{calcDiasValeTransporte(diasUteis, l.faltas)}</td>
                      <td><PadraoCell linha={l} onSave={salvarPadrao} /></td>
                      <td>{l.padraoDia === null ? "--" : formatCurrency(calcValeTransporte(diasUteis, l.faltas, l.padraoDia))}</td>
                      <td>{ORIGEM_LABEL[l.origem]}</td>
                    </tr>
                  ))}
                  {filtradas.length === 0 && (
                    <tr>
                      <td colSpan={7} className="empty-row">Nenhum colaborador encontrado.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
