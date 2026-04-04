"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { type RhidAnalyticalSummary, type RhidProcessedRow, type RhidReportData } from "@/lib/types";

const TOP_LIST_SIZE = 10;

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatMinutes(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? "-" : "";
  const absolute = Math.abs(totalMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `${sign}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatFaltas(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2
  }).format(value);
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

function parseTimeInput(str: string): number | null {
  const trimmed = str.trim();
  const negative = trimmed.startsWith("-");
  const clean = negative ? trimmed.slice(1) : trimmed;
  const parts = clean.split(":");
  if (parts.length !== 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m) || m < 0 || m > 59) return null;
  return (h * 60 + m) * (negative ? -1 : 1);
}

function parseNumberInput(str: string): number | null {
  const n = parseFloat(str.replace(",", "."));
  return isNaN(n) ? null : n;
}

// ─── Summary recomputation ────────────────────────────────────────────────────

function recomputeSummary(
  rows: RhidProcessedRow[],
  original: RhidAnalyticalSummary
): RhidAnalyticalSummary {
  const active = rows.filter((r) => !r.semEscala);
  const findMax = (key: "atrasoTotalMin" | "faltas" | "horasExtrasTotaisMin") =>
    active.reduce<RhidProcessedRow | null>(
      (max, r) => (!max || r[key] > max[key] ? r : max),
      null
    );
  return {
    totalColaboradores: rows.length,
    totalFaltas: active.reduce((s, r) => s + r.faltas, 0),
    totalAtrasoMin: active.reduce((s, r) => s + r.atrasoTotalMin, 0),
    totalHorasExtrasMin: active.reduce((s, r) => s + r.horasExtrasTotaisMin, 0),
    totalValeRefeicao: active.reduce((s, r) => s + r.valorValeRefeicao, 0),
    totalValorDesconto: active.reduce((s, r) => s + r.valorDesconto, 0),
    totalBancoHorasMin: active.reduce((s, r) => s + r.bancoHorasMin, 0),
    colaboradoresComFaltas: active.filter((r) => r.faltas > 0).length,
    colaboradoresComDesconto: active.filter((r) => r.statusFaltas === "DESCONTAR").length,
    colaboradoresComValorDesconto: active.filter((r) => r.valorDesconto > 0).length,
    colaboradoresComAlertaAtraso: active.filter((r) => r.alertaAtraso === "ALERTA").length,
    maiorAtraso: findMax("atrasoTotalMin"),
    maiorFaltas: findMax("faltas"),
    maiorHorasExtras: findMax("horasExtrasTotaisMin"),
    diasUteisConsiderados: original.diasUteisConsiderados,
    regraValeRefeicao: original.regraValeRefeicao,
  };
}

// ─── Editable cell types ──────────────────────────────────────────────────────

type EditableField =
  | "faltas"
  | "quantidadeAtrasos"
  | "atrasoTotalMin"
  | "horasExtrasTotaisMin"
  | "horasExtrasPagarMin"
  | "horasExtrasBancoMin"
  | "bancoHorasMin"
  | "statusFaltas"
  | "alertaAtraso"
  | "motivoDesconto"
  | "valorDesconto"
  | "valorValeRefeicao";

interface EditingCell {
  rowId: string;
  field: EditableField;
}

// ─── Inline editable cell ─────────────────────────────────────────────────────

interface EditableCellProps {
  displayValue: string;
  editInitial: string;
  type: "text" | "time" | "number" | "select-status" | "select-alerta";
  isEditing: boolean;
  modified: boolean;
  onStartEdit: () => void;
  onCommit: (raw: string) => void;
  onCancel: () => void;
}

function EditableCell({
  displayValue,
  editInitial,
  type,
  isEditing,
  modified,
  onStartEdit,
  onCommit,
  onCancel,
}: EditableCellProps): JSX.Element {
  const [draft, setDraft] = useState(editInitial);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (isEditing) {
      setDraft(editInitial);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
        selectRef.current?.focus();
      }, 0);
    }
  }, [isEditing, editInitial]);

  if (!isEditing) {
    return (
      <span
        className={`editable-val${modified ? " editable-modified" : ""}`}
        onClick={onStartEdit}
        title="Clique para editar"
      >
        {displayValue}
      </span>
    );
  }

  if (type === "select-status") {
    return (
      <select
        ref={selectRef}
        className="table-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit(draft);
          if (e.key === "Escape") onCancel();
        }}
      >
        <option value="DESCONTAR">DESCONTAR</option>
        <option value="OK">OK</option>
      </select>
    );
  }

  if (type === "select-alerta") {
    return (
      <select
        ref={selectRef}
        className="table-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit(draft);
          if (e.key === "Escape") onCancel();
        }}
      >
        <option value="ALERTA">ALERTA</option>
        <option value="OK">OK</option>
      </select>
    );
  }

  return (
    <input
      ref={inputRef}
      className="table-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onCommit(draft);
        if (e.key === "Escape") onCancel();
      }}
      placeholder={type === "time" ? "HH:MM" : ""}
    />
  );
}

// ─── Ranking list ─────────────────────────────────────────────────────────────

function metricValue(row: RhidProcessedRow, key: "atraso" | "faltas" | "extras"): string {
  if (row.semEscala) return "--";
  if (key === "faltas") return formatFaltas(row.faltas);
  if (key === "extras") return formatMinutes(row.horasExtrasTotaisMin);
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

// ─── Main panel ───────────────────────────────────────────────────────────────

interface RhidAnalysisPanelProps {
  report: RhidReportData;
  onReportUpdate: (report: RhidReportData) => void;
}

export function RhidAnalysisPanel({ report, onReportUpdate }: RhidAnalysisPanelProps): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<"TODOS" | "DESCONTAR" | "ALERTA_ATRASO">("TODOS");
  const [selectedDepts, setSelectedDepts] = useState<Set<string>>(new Set());
  const [deptDropdownOpen, setDeptDropdownOpen] = useState(false);
  const deptDropdownRef = useRef<HTMLDivElement>(null);
  const [selectedCargos, setSelectedCargos] = useState<Set<string>>(new Set());
  const [cargoDropdownOpen, setCargoDropdownOpen] = useState(false);
  const cargoDropdownRef = useRef<HTMLDivElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Partial<RhidProcessedRow>>>({});
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);

  const { processedRows, summary, sourceFile, warnings } = report;

  // Apply overrides to produce effective rows
  const effectiveRows = useMemo<RhidProcessedRow[]>(
    () =>
      processedRows.map((row) =>
        overrides[row.id] ? { ...row, ...overrides[row.id] } : row
      ),
    [processedRows, overrides]
  );

  // Recompute summary from effective rows
  const effectiveSummary = useMemo(
    () => recomputeSummary(effectiveRows, summary),
    [effectiveRows, summary]
  );

  // Recompute ranking lists from effective rows
  const effectiveLists = useMemo(() => {
    const active = effectiveRows.filter((r) => !r.semEscala);
    return {
      maisAtrasos: [...active].sort((a, b) => b.atrasoTotalMin - a.atrasoTotalMin).filter((r) => r.atrasoTotalMin > 0),
      comFaltas: [...active].sort((a, b) => b.faltas - a.faltas).filter((r) => r.faltas > 0),
      maisHorasExtras: [...active].sort((a, b) => b.horasExtrasTotaisMin - a.horasExtrasTotaisMin).filter((r) => r.horasExtrasTotaisMin > 0),
    };
  }, [effectiveRows]);

  // Departamentos e cargos disponíveis (enriquecidos no servidor via API RHID)
  const availableDepts = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const row of effectiveRows) {
      if (row.departamento) set.add(row.departamento);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [effectiveRows]);

  const availableCargos = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const row of effectiveRows) {
      if (row.cargo) set.add(row.cargo);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [effectiveRows]);

  const filteredRows = useMemo(() => {
    let rows = effectiveRows;
    if (statusFilter === "DESCONTAR") {
      rows = rows.filter((row) => row.statusFaltas === "DESCONTAR");
    } else if (statusFilter === "ALERTA_ATRASO") {
      rows = rows.filter((row) => row.alertaAtraso === "ALERTA");
    }
    if (selectedDepts.size > 0) {
      rows = rows.filter((row) => selectedDepts.has(row.departamento));
    }
    if (selectedCargos.size > 0) {
      rows = rows.filter((row) => selectedCargos.has(row.cargo));
    }
    return rows;
  }, [effectiveRows, statusFilter, selectedDepts, selectedCargos]);

  // Fecha dropdowns ao clicar fora
  useEffect(() => {
    if (!deptDropdownOpen && !cargoDropdownOpen) return;
    const handle = (e: MouseEvent) => {
      if (deptDropdownRef.current && !deptDropdownRef.current.contains(e.target as Node)) {
        setDeptDropdownOpen(false);
      }
      if (cargoDropdownRef.current && !cargoDropdownRef.current.contains(e.target as Node)) {
        setCargoDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [deptDropdownOpen, cargoDropdownOpen]);

  const toggleDept = (dept: string) => {
    setSelectedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept); else next.add(dept);
      return next;
    });
  };

  const toggleCargo = (cargo: string) => {
    setSelectedCargos((prev) => {
      const next = new Set(prev);
      if (next.has(cargo)) next.delete(cargo); else next.add(cargo);
      return next;
    });
  };

  const deptFilterLabel = selectedDepts.size === 0
    ? "Todos os departamentos"
    : selectedDepts.size === 1 ? [...selectedDepts][0] : `${selectedDepts.size} departamentos`;

  const cargoFilterLabel = selectedCargos.size === 0
    ? "Todos os cargos"
    : selectedCargos.size === 1 ? [...selectedCargos][0] : `${selectedCargos.size} cargos`;

  const hasActiveFilter = statusFilter !== "TODOS" || selectedDepts.size > 0 || selectedCargos.size > 0;

  // Propagate effective rows + summary back to parent (for export)
  const commitToParent = (newRows: RhidProcessedRow[]) => {
    const newSummary = recomputeSummary(newRows, summary);
    const newLists = (() => {
      const active = newRows.filter((r) => !r.semEscala);
      return {
        maisAtrasos: [...active].sort((a, b) => b.atrasoTotalMin - a.atrasoTotalMin).filter((r) => r.atrasoTotalMin > 0),
        comFaltas: [...active].sort((a, b) => b.faltas - a.faltas).filter((r) => r.faltas > 0),
        maisHorasExtras: [...active].sort((a, b) => b.horasExtrasTotaisMin - a.horasExtrasTotaisMin).filter((r) => r.horasExtrasTotaisMin > 0),
      };
    })();
    onReportUpdate({ ...report, processedRows: newRows, summary: newSummary, lists: newLists });
  };

  const applyOverride = (rowId: string, field: EditableField, rawValue: string) => {
    const original = processedRows.find((r) => r.id === rowId);
    if (!original) return;

    let parsed: Partial<RhidProcessedRow> | null = null;

    if (
      field === "atrasoTotalMin" ||
      field === "horasExtrasTotaisMin" ||
      field === "horasExtrasPagarMin" ||
      field === "horasExtrasBancoMin" ||
      field === "bancoHorasMin"
    ) {
      const minutes = parseTimeInput(rawValue);
      if (minutes === null) return;
      parsed = { [field]: minutes };
    } else if (field === "faltas" || field === "quantidadeAtrasos") {
      const n = parseNumberInput(rawValue);
      if (n === null) return;
      parsed = { [field]: n };
    } else if (field === "valorDesconto" || field === "valorValeRefeicao") {
      const n = parseNumberInput(rawValue);
      if (n === null) return;
      parsed = { [field]: n };
    } else if (field === "statusFaltas") {
      if (rawValue !== "DESCONTAR" && rawValue !== "OK") return;
      parsed = { statusFaltas: rawValue };
    } else if (field === "alertaAtraso") {
      if (rawValue !== "ALERTA" && rawValue !== "OK") return;
      parsed = { alertaAtraso: rawValue };
    } else if (field === "motivoDesconto") {
      parsed = { motivoDesconto: rawValue };
    }

    if (!parsed) return;

    const newOverrides = {
      ...overrides,
      [rowId]: { ...(overrides[rowId] ?? {}), ...parsed },
    };
    setOverrides(newOverrides);

    // Compute new rows immediately for parent commit
    const newRows = processedRows.map((row) =>
      newOverrides[row.id] ? { ...row, ...newOverrides[row.id] } : row
    );
    commitToParent(newRows);
  };

  const startEdit = (rowId: string, field: EditableField) => {
    setEditingCell({ rowId, field });
  };

  const cancelEdit = () => setEditingCell(null);

  const commitEdit = (rowId: string, field: EditableField, raw: string) => {
    setEditingCell(null);
    applyOverride(rowId, field, raw);
  };

  const isEditing = (rowId: string, field: EditableField) =>
    editingCell?.rowId === rowId && editingCell?.field === field;

  const isModified = (rowId: string, field: EditableField) =>
    overrides[rowId] !== undefined && field in (overrides[rowId] ?? {});

  const getEffectiveRow = (rowId: string): RhidProcessedRow =>
    effectiveRows.find((r) => r.id === rowId)!;

  const editInitialFor = (row: RhidProcessedRow, field: EditableField): string => {
    const eff = getEffectiveRow(row.id);
    switch (field) {
      case "faltas":              return String(eff.faltas);
      case "quantidadeAtrasos":   return String(eff.quantidadeAtrasos);
      case "atrasoTotalMin":      return formatMinutes(eff.atrasoTotalMin);
      case "horasExtrasTotaisMin":return formatMinutes(eff.horasExtrasTotaisMin);
      case "horasExtrasPagarMin": return formatMinutes(eff.horasExtrasPagarMin);
      case "horasExtrasBancoMin": return formatMinutes(eff.horasExtrasBancoMin);
      case "bancoHorasMin":       return formatMinutes(eff.bancoHorasMin);
      case "statusFaltas":        return eff.statusFaltas;
      case "alertaAtraso":        return eff.alertaAtraso;
      case "motivoDesconto":      return eff.motivoDesconto;
      case "valorDesconto":       return eff.valorDesconto.toFixed(2);
      case "valorValeRefeicao":   return eff.valorValeRefeicao.toFixed(2);
    }
  };

  const modifiedCount = Object.values(overrides).reduce(
    (sum, ov) => sum + Object.keys(ov ?? {}).length,
    0
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/data?refresh=true", { cache: "no-store" });
      if (!response.body) throw new Error("Resposta sem corpo.");

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(trimmed.slice(5).trim()) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (event.type === "done") {
            setOverrides({});
            onReportUpdate(event.report as RhidReportData);
          } else if (event.type === "error") {
            throw new Error(event.message as string);
          }
        }
      }
    } catch (error) {
      console.error("Erro ao atualizar dados RHiD:", error);
      alert("Erro ao atualizar dados da API RHiD.");
    } finally {
      setRefreshing(false);
    }
  };

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
          {modifiedCount > 0 && (
            <span className="editable-badge">
              {modifiedCount} campo{modifiedCount !== 1 ? "s" : ""} editado{modifiedCount !== 1 ? "s" : ""}
            </span>
          )}
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
          <strong>{formatFaltas(effectiveSummary.totalFaltas)}</strong>
        </article>

        <article className="metric-card ocean">
          <span>Total de Atrasos</span>
          <strong>{formatMinutes(effectiveSummary.totalAtrasoMin)}</strong>
        </article>

        <article className="metric-card lime">
          <span>Total Horas Extras</span>
          <strong>{formatMinutes(effectiveSummary.totalHorasExtrasMin)}</strong>
        </article>

        <article className="metric-card slate">
          <span>Vale Refeicao Estimado</span>
          <strong>{formatCurrency(effectiveSummary.totalValeRefeicao)}</strong>
          <small>{effectiveSummary.regraValeRefeicao}</small>
        </article>

        <article className="metric-card sunset">
          <span>Total a descontar</span>
          <strong>{formatCurrency(effectiveSummary.totalValorDesconto)}</strong>
          <small>{effectiveSummary.colaboradoresComValorDesconto} colaboradores com desconto</small>
        </article>
      </div>

      <div className="table-wrapper rhid-table-wrap">
        <div className="table-tools">
          <div className="table-filters-row">
            {/* Filtro de status */}
            <label className="table-filter">
              <span>Filtro de status</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              >
                <option value="TODOS">Mostrar todos</option>
                <option value="DESCONTAR">Somente quem desconta</option>
                <option value="ALERTA_ATRASO">Somente com alerta de atraso</option>
              </select>
            </label>

            {/* Filtro de departamento */}
            {availableDepts.length > 0 && (
              <div className="table-filter prof-filter-wrap" ref={deptDropdownRef}>
                <span>Departamento</span>
                <button
                  className={`prof-filter-btn${deptDropdownOpen ? " open" : ""}${selectedDepts.size > 0 ? " active" : ""}`}
                  onClick={() => setDeptDropdownOpen((v) => !v)}
                  type="button"
                >
                  {deptFilterLabel}
                  <span className="prof-filter-arrow">▾</span>
                </button>
                {deptDropdownOpen && (
                  <div className="prof-dropdown">
                    <button className="prof-dropdown-clear" onClick={() => setSelectedDepts(new Set())} type="button">
                      Limpar filtro
                    </button>
                    <div className="prof-dropdown-list">
                      {availableDepts.map((dept) => (
                        <label key={dept} className={`prof-dropdown-item${selectedDepts.has(dept) ? " checked" : ""}`}>
                          <input type="checkbox" checked={selectedDepts.has(dept)} onChange={() => toggleDept(dept)} />
                          <span>{dept}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Filtro de cargo */}
            {availableCargos.length > 0 && (
              <div className="table-filter prof-filter-wrap" ref={cargoDropdownRef}>
                <span>Cargo</span>
                <button
                  className={`prof-filter-btn${cargoDropdownOpen ? " open" : ""}${selectedCargos.size > 0 ? " active" : ""}`}
                  onClick={() => setCargoDropdownOpen((v) => !v)}
                  type="button"
                >
                  {cargoFilterLabel}
                  <span className="prof-filter-arrow">▾</span>
                </button>
                {cargoDropdownOpen && (
                  <div className="prof-dropdown">
                    <button className="prof-dropdown-clear" onClick={() => setSelectedCargos(new Set())} type="button">
                      Limpar filtro
                    </button>
                    <div className="prof-dropdown-list">
                      {availableCargos.map((cargo) => (
                        <label key={cargo} className={`prof-dropdown-item${selectedCargos.has(cargo) ? " checked" : ""}`}>
                          <input type="checkbox" checked={selectedCargos.has(cargo)} onChange={() => toggleCargo(cargo)} />
                          <span>{cargo}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <span className="table-count">
            {filteredRows.length} de {processedRows.length} colaboradores
            {hasActiveFilter && (
              <button
                className="filter-clear-all"
                onClick={() => { setStatusFilter("TODOS"); setSelectedDepts(new Set()); setSelectedCargos(new Set()); }}
                type="button"
              >
                Limpar filtros
              </button>
            )}
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

                {/* Faltas */}
                <td className={row.semEscala ? "" : "editable-cell"}>
                  {row.semEscala ? "--" : (
                    <EditableCell
                      displayValue={formatFaltas(row.faltas)}
                      editInitial={editInitialFor(row, "faltas")}
                      type="number"
                      isEditing={isEditing(row.id, "faltas")}
                      modified={isModified(row.id, "faltas")}
                      onStartEdit={() => startEdit(row.id, "faltas")}
                      onCommit={(v) => commitEdit(row.id, "faltas", v)}
                      onCancel={cancelEdit}
                    />
                  )}
                </td>

                {/* Qtd atrasos */}
                <td className={row.semEscala ? "" : "editable-cell"}>
                  {row.semEscala ? "--" : (
                    <EditableCell
                      displayValue={String(row.quantidadeAtrasos)}
                      editInitial={editInitialFor(row, "quantidadeAtrasos")}
                      type="number"
                      isEditing={isEditing(row.id, "quantidadeAtrasos")}
                      modified={isModified(row.id, "quantidadeAtrasos")}
                      onStartEdit={() => startEdit(row.id, "quantidadeAtrasos")}
                      onCommit={(v) => commitEdit(row.id, "quantidadeAtrasos", v)}
                      onCancel={cancelEdit}
                    />
                  )}
                </td>

                {/* Atraso total */}
                <td className={row.semEscala ? "" : "editable-cell"}>
                  {row.semEscala ? "--" : (
                    <EditableCell
                      displayValue={formatMinutes(row.atrasoTotalMin)}
                      editInitial={editInitialFor(row, "atrasoTotalMin")}
                      type="time"
                      isEditing={isEditing(row.id, "atrasoTotalMin")}
                      modified={isModified(row.id, "atrasoTotalMin")}
                      onStartEdit={() => startEdit(row.id, "atrasoTotalMin")}
                      onCommit={(v) => commitEdit(row.id, "atrasoTotalMin", v)}
                      onCancel={cancelEdit}
                    />
                  )}
                </td>

                {/* Extras totais */}
                <td className={row.semEscala ? "" : "editable-cell"}>
                  {row.semEscala ? "--" : (
                    <EditableCell
                      displayValue={formatMinutes(row.horasExtrasTotaisMin)}
                      editInitial={editInitialFor(row, "horasExtrasTotaisMin")}
                      type="time"
                      isEditing={isEditing(row.id, "horasExtrasTotaisMin")}
                      modified={isModified(row.id, "horasExtrasTotaisMin")}
                      onStartEdit={() => startEdit(row.id, "horasExtrasTotaisMin")}
                      onCommit={(v) => commitEdit(row.id, "horasExtrasTotaisMin", v)}
                      onCancel={cancelEdit}
                    />
                  )}
                </td>

                {/* Extras a pagar */}
                <td className={row.semEscala ? "" : "editable-cell"}>
                  {row.semEscala ? "--" : (
                    <EditableCell
                      displayValue={formatMinutes(row.horasExtrasPagarMin)}
                      editInitial={editInitialFor(row, "horasExtrasPagarMin")}
                      type="time"
                      isEditing={isEditing(row.id, "horasExtrasPagarMin")}
                      modified={isModified(row.id, "horasExtrasPagarMin")}
                      onStartEdit={() => startEdit(row.id, "horasExtrasPagarMin")}
                      onCommit={(v) => commitEdit(row.id, "horasExtrasPagarMin", v)}
                      onCancel={cancelEdit}
                    />
                  )}
                </td>

                {/* Extras p/ banco */}
                <td className={row.semEscala ? "" : "editable-cell"}>
                  {row.semEscala ? "--" : (
                    <EditableCell
                      displayValue={formatMinutes(row.horasExtrasBancoMin)}
                      editInitial={editInitialFor(row, "horasExtrasBancoMin")}
                      type="time"
                      isEditing={isEditing(row.id, "horasExtrasBancoMin")}
                      modified={isModified(row.id, "horasExtrasBancoMin")}
                      onStartEdit={() => startEdit(row.id, "horasExtrasBancoMin")}
                      onCommit={(v) => commitEdit(row.id, "horasExtrasBancoMin", v)}
                      onCancel={cancelEdit}
                    />
                  )}
                </td>

                {/* Banco de horas */}
                <td className={row.semEscala ? "" : "editable-cell"}>
                  {row.semEscala ? "--" : (
                    <EditableCell
                      displayValue={formatMinutes(row.bancoHorasMin)}
                      editInitial={editInitialFor(row, "bancoHorasMin")}
                      type="time"
                      isEditing={isEditing(row.id, "bancoHorasMin")}
                      modified={isModified(row.id, "bancoHorasMin")}
                      onStartEdit={() => startEdit(row.id, "bancoHorasMin")}
                      onCommit={(v) => commitEdit(row.id, "bancoHorasMin", v)}
                      onCancel={cancelEdit}
                    />
                  )}
                </td>

                {/* Status faltas */}
                <td className="editable-cell">
                  {isEditing(row.id, "statusFaltas") ? (
                    <EditableCell
                      displayValue={row.statusFaltas}
                      editInitial={editInitialFor(row, "statusFaltas")}
                      type="select-status"
                      isEditing={true}
                      modified={isModified(row.id, "statusFaltas")}
                      onStartEdit={() => startEdit(row.id, "statusFaltas")}
                      onCommit={(v) => commitEdit(row.id, "statusFaltas", v)}
                      onCancel={cancelEdit}
                    />
                  ) : (
                    <span
                      className={`status-pill ${row.statusFaltas === "DESCONTAR" ? "danger" : "ok"}${isModified(row.id, "statusFaltas") ? " editable-modified-pill" : ""}`}
                      onClick={() => startEdit(row.id, "statusFaltas")}
                      title="Clique para editar"
                    >
                      {row.statusFaltas}
                    </span>
                  )}
                </td>

                {/* Alerta atraso */}
                <td className="editable-cell">
                  {isEditing(row.id, "alertaAtraso") ? (
                    <EditableCell
                      displayValue={row.alertaAtraso}
                      editInitial={editInitialFor(row, "alertaAtraso")}
                      type="select-alerta"
                      isEditing={true}
                      modified={isModified(row.id, "alertaAtraso")}
                      onStartEdit={() => startEdit(row.id, "alertaAtraso")}
                      onCommit={(v) => commitEdit(row.id, "alertaAtraso", v)}
                      onCancel={cancelEdit}
                    />
                  ) : (
                    <span
                      className={`status-pill ${row.alertaAtraso === "ALERTA" ? "danger" : "ok"}${isModified(row.id, "alertaAtraso") ? " editable-modified-pill" : ""}`}
                      onClick={() => startEdit(row.id, "alertaAtraso")}
                      title="Clique para editar"
                    >
                      {row.alertaAtraso}
                    </span>
                  )}
                </td>

                {/* Motivo desconto */}
                <td className="editable-cell">
                  <EditableCell
                    displayValue={row.motivoDesconto || "—"}
                    editInitial={editInitialFor(row, "motivoDesconto")}
                    type="text"
                    isEditing={isEditing(row.id, "motivoDesconto")}
                    modified={isModified(row.id, "motivoDesconto")}
                    onStartEdit={() => startEdit(row.id, "motivoDesconto")}
                    onCommit={(v) => commitEdit(row.id, "motivoDesconto", v)}
                    onCancel={cancelEdit}
                  />
                </td>

                {/* Valor a descontar */}
                <td className="editable-cell">
                  <EditableCell
                    displayValue={formatCurrency(row.valorDesconto)}
                    editInitial={editInitialFor(row, "valorDesconto")}
                    type="number"
                    isEditing={isEditing(row.id, "valorDesconto")}
                    modified={isModified(row.id, "valorDesconto")}
                    onStartEdit={() => startEdit(row.id, "valorDesconto")}
                    onCommit={(v) => commitEdit(row.id, "valorDesconto", v)}
                    onCancel={cancelEdit}
                  />
                </td>

                {/* Vale refeicao */}
                <td className="editable-cell">
                  <EditableCell
                    displayValue={formatCurrency(row.valorValeRefeicao)}
                    editInitial={editInitialFor(row, "valorValeRefeicao")}
                    type="number"
                    isEditing={isEditing(row.id, "valorValeRefeicao")}
                    modified={isModified(row.id, "valorValeRefeicao")}
                    onStartEdit={() => startEdit(row.id, "valorValeRefeicao")}
                    onCommit={(v) => commitEdit(row.id, "valorValeRefeicao", v)}
                    onCancel={cancelEdit}
                  />
                </td>
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
          rows={effectiveLists.maisAtrasos}
          metric="atraso"
          emptyLabel="Nenhum atraso registrado no periodo."
        />

        <RankingList
          title="Colaboradores com faltas"
          rows={effectiveLists.comFaltas}
          metric="faltas"
          emptyLabel="Nenhuma falta registrada no periodo."
        />

        <RankingList
          title="Colaboradores com mais horas extras"
          rows={effectiveLists.maisHorasExtras}
          metric="extras"
          emptyLabel="Nenhuma hora extra registrada no periodo."
        />
      </div>

      <div className="analysis-summary">
        <h4>Resumo analitico</h4>
        <p>
          Foram avaliados {effectiveSummary.totalColaboradores} colaboradores.{" "}
          {effectiveSummary.colaboradoresComFaltas} tem faltas registradas e{" "}
          {effectiveSummary.colaboradoresComDesconto} ultrapassam o limite de 2 faltas, portanto
          entram com status DESCONTAR. {effectiveSummary.colaboradoresComAlertaAtraso} colaboradores
          ultrapassam 5 horas de atraso acumulado. O total a descontar nesses cenarios e{" "}
          {formatCurrency(effectiveSummary.totalValorDesconto)}. O saldo total de banco de horas e{" "}
          {formatMinutes(effectiveSummary.totalBancoHorasMin)} e o valor estimado total de vale
          refeicao e {formatCurrency(effectiveSummary.totalValeRefeicao)} considerando{" "}
          {effectiveSummary.diasUteisConsiderados} dias uteis.
        </p>
      </div>
    </section>
  );
}
