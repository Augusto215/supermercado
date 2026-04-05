"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RhidAnalysisPanel } from "@/components/rhid-analysis-panel";
import { usePayroll } from "@/components/payroll-provider";
import { FIELD_DEFINITIONS } from "@/lib/fields";
import { exportRhidPainelReport, type ExportPurchaseRow, type ExportCashDiffRow, type ExportValeRow } from "@/lib/export-csv";
import { type RhidReportData } from "@/lib/types";

interface PurchaseRow {
  id: string;
  funcionario_nome: string;
  produto: string;
  dia: string;
  valor: number;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(value);
}

function formatDate(isoDate: string): string {
  if (!isoDate) return "";
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString("pt-BR");
}

interface CompanyOption {
  id: number;
  name: string;
  cnpj: string | null;
}

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

type Mode = "competencia" | "intervalo";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function capToToday(date: string): string {
  const today = todayIso();
  return date > today ? today : date;
}

function buildPeriod(mode: Mode, selectedMonth: string, dataIniCustom: string, dataFinalCustom: string) {
  if (mode === "intervalo") {
    return { dataIni: dataIniCustom, dataFinal: capToToday(dataFinalCustom) };
  }
  const [yearStr, monthStr] = selectedMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear  = month === 1 ? year - 1 : year;
  return {
    dataIni:   `${prevYear}-${String(prevMonth).padStart(2, "0")}-21`,
    dataFinal: capToToday(`${year}-${String(month).padStart(2, "0")}-20`)
  };
}

function generateMonthOptions() {
  const now = new Date();
  const currentYear  = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const options: { value: string; label: string }[] = [];

  for (let y = currentYear - 1; y <= currentYear; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === currentYear && m > currentMonth) break;
      options.push({
        value: `${y}-${String(m).padStart(2, "0")}`,
        label: `${MONTHS[m - 1]} de ${y}`
      });
    }
  }

  return options.reverse(); // mais recente primeiro
}

function fieldLabel(code: string): string {
  const f = FIELD_DEFINITIONS.find((d) => d.key === code);
  return f ? `${f.codigo} · ${f.label}` : code;
}

export default function PainelPage(): JSX.Element {
  const { rules, rows } = usePayroll();
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [mode, setMode]                   = useState<Mode>("competencia");
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const [dataIniCustom, setDataIniCustom] = useState("");
  const [dataFinalCustom, setDataFinalCustom] = useState("");

  // Empresas
  const [companies, setCompanies]           = useState<CompanyOption[]>([]);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<number>>(new Set());
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  const [report, setReport]   = useState<RhidReportData | null>(null);
  const [reportPeriod, setReportPeriod] = useState<{ dataIni: string; dataFinal: string } | null>(null);
  const [purchases, setPurchases] = useState<PurchaseRow[]>([]);
  const [vales, setVales] = useState<PurchaseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadingCurrent, setLoadingCurrent] = useState(0);
  const [loadingTotal, setLoadingTotal]     = useState(0);
  const [error, setError]     = useState<string | null>(null);

  // Carrega lista de empresas ao montar
  useEffect(() => {
    setLoadingCompanies(true);
    fetch("/api/companies")
      .then((r) => r.ok ? r.json() : [])
      .then((data: CompanyOption[]) => {
        setCompanies(data);
        // seleciona todas por padrão
        setSelectedCompanyIds(new Set(data.map((c) => c.id)));
      })
      .catch(() => { /* silencia — empresa fica sem filtro */ })
      .finally(() => setLoadingCompanies(false));
  }, []);

  const toggleCompany = (id: number) => {
    setSelectedCompanyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllCompanies = () => {
    if (selectedCompanyIds.size === companies.length) {
      setSelectedCompanyIds(new Set());
    } else {
      setSelectedCompanyIds(new Set(companies.map((c) => c.id)));
    }
  };

  const monthOptions = generateMonthOptions();

  const selectedLabel = (() => {
    const [y, m] = selectedMonth.split("-").map(Number);
    return `${MONTHS[m - 1]} de ${y}`;
  })();

  const periodLabel = (() => {
    if (mode === "intervalo") {
      if (dataIniCustom && dataFinalCustom) {
        const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("pt-BR");
        return `${fmt(dataIniCustom)} até ${fmt(dataFinalCustom)}`;
      }
      return null;
    }
    const { dataIni, dataFinal } = buildPeriod(mode, selectedMonth, "", "");
    const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("pt-BR");
    return `${fmt(dataIni)} até ${fmt(dataFinal)}`;
  })();

  const hasCompanySelected = companies.length === 0 || selectedCompanyIds.size > 0;
  const isReadyToLoad = hasCompanySelected && (
    mode === "competencia"
      ? true
      : Boolean(dataIniCustom && dataFinalCustom && dataIniCustom <= dataFinalCustom)
  );

  const loadReport = useCallback(async () => {
    const { dataIni, dataFinal } = buildPeriod(mode, selectedMonth, dataIniCustom, dataFinalCustom);

    setLoading(true);
    setError(null);
    setLoadingCurrent(0);
    setLoadingTotal(0);
    setReportPeriod({ dataIni, dataFinal });

    try {
      const params = new URLSearchParams({ dataIni, dataFinal });
      // Só envia filtro se não estiver com todas selecionadas (ou nenhuma)
      const allSelected = selectedCompanyIds.size === companies.length;
      if (!allSelected && selectedCompanyIds.size > 0) {
        params.set("companyIds", Array.from(selectedCompanyIds).join(","));
      }
      const response = await fetch(`/api/data?${params.toString()}`, {
        cache: "no-store",
      });

      if (!response.body) throw new Error("Resposta sem corpo.");

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Processa todas as linhas "data: ..." completas do buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // guarda linha incompleta

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(trimmed.slice(5).trim()) as Record<string, unknown>;
          } catch {
            continue;
          }

          if (event.type === "progress") {
            setLoadingCurrent(event.current as number);
            setLoadingTotal(event.total as number);
          } else if (event.type === "done") {
            setReport(event.report as RhidReportData);
            fetch("/api/purchases")
              .then((r) => r.ok ? r.json() : [])
              .then((data: PurchaseRow[]) => { if (Array.isArray(data)) setPurchases(data); })
              .catch(() => {});
            fetch("/api/vales")
              .then((r) => r.ok ? r.json() : [])
              .then((data: PurchaseRow[]) => { if (Array.isArray(data)) setVales(data); })
              .catch(() => {});
          } else if (event.type === "error") {
            throw new Error(event.message as string);
          }
        }
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Falha ao consultar a API RHiD."
      );
    } finally {
      setTimeout(() => setLoading(false), 300);
    }
  }, [mode, selectedMonth, dataIniCustom, dataFinalCustom, selectedCompanyIds, companies.length]);

  const handleReset = () => {
    setReport(null);
    setReportPeriod(null);
    setPurchases([]);
    setVales([]);
    setError(null);
    setLoadingCurrent(0);
    setLoadingTotal(0);
  };

  const handleExport = async () => {
    if (!report) return;
    setExporting(true);
    try {
      const [purchasesRes, valesRes, cashRes] = await Promise.all([
        fetch("/api/purchases"),
        fetch("/api/vales"),
        fetch("/api/cash-differences")
      ]);
      const purchases = (purchasesRes.ok ? (await purchasesRes.json()) : []) as ExportPurchaseRow[];
      const valesData = (valesRes.ok    ? (await valesRes.json())    : []) as ExportValeRow[];
      const cashDiffs = (cashRes.ok     ? (await cashRes.json())     : []) as ExportCashDiffRow[];
      exportRhidPainelReport(rows, report.processedRows, {
        purchases,
        vales:    valesData,
        cashDiffs,
        dataIni:   reportPeriod?.dataIni,
        dataFinal: reportPeriod?.dataFinal
      });
    } finally {
      setExporting(false);
    }
  };

  /* ── Carregando ── */
  if (loading) {
    const hasTotal   = loadingTotal > 0;
    const pct        = hasTotal ? Math.round((loadingCurrent / loadingTotal) * 100) : null;

    return (
      <section className="panel">
        <div className="panel-head">
          <h3>Carregando dados...</h3>
          <p>
            {hasTotal
              ? `Apurando colaboradores — aguarde.`
              : "Conectando à API RHiD..."}
          </p>
        </div>

        <div className="loading-counter-block">
          {hasTotal ? (
            <>
              <div className="loading-counter">
                <span className="loading-counter-current">{loadingCurrent}</span>
                <span className="loading-counter-sep">/</span>
                <span className="loading-counter-total">{loadingTotal}</span>
              </div>
              <div className="loading-counter-label">colaboradores processados</div>
              <div className="progress-bar" style={{ marginTop: 14 }}>
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="progress-text">{pct}%</div>
            </>
          ) : (
            <div className="loading-spinner-row">
              <div className="loading-dot-pulse" />
              <span>Carregando lista de colaboradores...</span>
            </div>
          )}
        </div>
      </section>
    );
  }

  /* ── Erro ── */
  if (error && !report) {
    return (
      <section className="panel">
        <div className="panel-head split">
          <div>
            <h3>Falha ao carregar</h3>
            <p>{error}</p>
          </div>
          <button className="btn btn-primary" onClick={() => void loadReport()}>
            Tentar novamente
          </button>
        </div>
      </section>
    );
  }

  /* ── Relatório carregado ── */
  if (report) {
    const activeRules = rules.filter((r) => r.ativo);

    return (
      <div className="page-stack">
        {/* Cabeçalho + exportar */}
        <section className="panel">
          <div className="panel-head split" style={{ marginBottom: 16 }}>
            <div>
              <h3>Análise RHiD</h3>
              <p>Relatório carregado com sucesso.</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={() => void handleExport()} disabled={exporting}>
                {exporting ? "Exportando..." : "Exportar CSV"}
              </button>
              <button className="secondary-btn" onClick={handleReset}>
                ← Novo relatório
              </button>
            </div>
          </div>

          <div className="rules-used-block">
            <p className="rules-used-label">Regras aplicadas neste relatório</p>
            <ul className="rules-used-list">
              {/* Regra fixa do sistema */}
              <li className="rules-used-item">
                <span className="rules-used-name">Tolerância de atraso</span>
                <span className="rules-used-desc">
                  Atrasos de até 15 min não contam na quantidade de atrasos do colaborador.
                </span>
                <div className="rule-fields">
                  <span className="rule-field-chip rule-field-chip-builtin">Sistema</span>
                  <span className="rule-field-chip">Qtd Atrasos</span>
                </div>
              </li>
              {/* Regras configuráveis ativas */}
              {activeRules.map((rule) => (
                <li key={rule.id} className="rules-used-item">
                  <span className="rules-used-name">{rule.nome}</span>
                  <span className="rules-used-desc">{rule.descricao}</span>
                  <div className="rule-fields">
                    {rule.campoImpacto.map((code) => (
                      <span key={code} className="rule-field-chip">{fieldLabel(code)}</span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <RhidAnalysisPanel
          report={report}
          onReportUpdate={setReport}
          purchases={purchases}
          vales={vales}
          dataIni={reportPeriod?.dataIni}
          dataFinal={reportPeriod?.dataFinal}
        />
      </div>
    );
  }

  /* ── Tela inicial ── */
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Painel RHiD</h3>
        <p>Selecione o período para gerar o relatório de apuração de ponto.</p>
      </div>

      {/* Tabs de modo */}
      <div className="mode-tabs">
        <button
          className={`mode-tab${mode === "competencia" ? " active" : ""}`}
          onClick={() => setMode("competencia")}
        >
          Por competência
        </button>
        <button
          className={`mode-tab${mode === "intervalo" ? " active" : ""}`}
          onClick={() => setMode("intervalo")}
        >
          Intervalo livre
        </button>
      </div>

      {/* Competência */}
      {mode === "competencia" && (
        <div className="selector-row">
          <div className="selector-field">
            <label className="selector-label" htmlFor="month-select">
              Mês de competência
            </label>
            <select
              id="month-select"
              className="selector-input"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {monthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => void loadReport()}
            disabled={!isReadyToLoad}
          >
            Gerar relatório
          </button>
        </div>
      )}

      {/* Intervalo livre */}
      {mode === "intervalo" && (
        <div className="selector-row">
          <div className="selector-field">
            <label className="selector-label" htmlFor="date-ini">Data inicial</label>
            <input
              id="date-ini"
              type="date"
              className="selector-input"
              value={dataIniCustom}
              max={dataFinalCustom || undefined}
              onChange={(e) => setDataIniCustom(e.target.value)}
            />
          </div>
          <div className="selector-field">
            <label className="selector-label" htmlFor="date-final">Data final</label>
            <input
              id="date-final"
              type="date"
              className="selector-input"
              value={dataFinalCustom}
              min={dataIniCustom || undefined}
              max={todayIso()}
              onChange={(e) => setDataFinalCustom(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={() => void loadReport()}
            disabled={!isReadyToLoad}
          >
            Gerar relatório
          </button>
        </div>
      )}

      {/* Hint do período */}
      {periodLabel && (
        <p className="period-hint">
          Período: <strong>{mode === "competencia" ? selectedLabel : periodLabel}</strong>
          {mode === "competencia" && (
            <> &mdash; apuração de <strong>{periodLabel}</strong></>
          )}
        </p>
      )}

      {/* Seletor de empresa */}
      {(loadingCompanies || companies.length > 0) && (
        <div className="company-selector-block">
          <div className="company-selector-head">
            <span className="selector-label">Empresas</span>
            {companies.length > 1 && (
              <button className="company-toggle-all" onClick={toggleAllCompanies}>
                {selectedCompanyIds.size === companies.length ? "Desmarcar todas" : "Selecionar todas"}
              </button>
            )}
          </div>

          {loadingCompanies ? (
            <p className="company-loading">Carregando empresas...</p>
          ) : (
            <div className="company-list">
              {companies.map((c) => (
                <label key={c.id} className={`company-item${selectedCompanyIds.has(c.id) ? " selected" : ""}`}>
                  <input
                    type="checkbox"
                    checked={selectedCompanyIds.has(c.id)}
                    onChange={() => toggleCompany(c.id)}
                  />
                  <span className="company-name">{c.name}</span>
                  {c.cnpj && <span className="company-cnpj">CNPJ: {c.cnpj}</span>}
                </label>
              ))}
            </div>
          )}

          {!loadingCompanies && selectedCompanyIds.size === 0 && (
            <p className="company-warn">Selecione ao menos uma empresa para gerar o relatório.</p>
          )}
        </div>
      )}
    </section>
  );
}
