"use client";

import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { usePayroll } from "@/components/payroll-provider";

interface EmployeeBirthday {
  id: string;
  funcionarioId: string;
  funcionarioNome: string;
  dataNascimento: string; // YYYY-MM-DD
}

interface DbRow {
  id: string;
  funcionario_id: string;
  funcionario_nome: string;
  data_nascimento: string;
}

function fromDb(row: DbRow): EmployeeBirthday {
  return {
    id: row.id,
    funcionarioId: row.funcionario_id,
    funcionarioNome: row.funcionario_nome,
    dataNascimento: row.data_nascimento,
  };
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthDay(isoDate: string): string {
  return isoDate.slice(5, 10); // "MM-DD"
}

function formatBirthDate(isoDate: string): string {
  if (!isoDate || isoDate.length < 10) return isoDate;
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

/** Dias até o próximo aniversário (0 = hoje), considerando apenas mês/dia. */
function daysUntilNextBirthday(dataNascimento: string, referenceIso: string): number {
  const [, monthStr, dayStr] = dataNascimento.split("-");
  const [refYear] = referenceIso.split("-");
  const month = Number(monthStr);
  const day = Number(dayStr);
  const reference = new Date(`${referenceIso}T00:00:00`);

  let next = new Date(Number(refYear), month - 1, day);
  if (next.getTime() < new Date(`${referenceIso}T00:00:00`).getTime()) {
    next = new Date(Number(refYear) + 1, month - 1, day);
  }

  const diffMs = next.getTime() - reference.getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

// ─── Importação de planilha ────────────────────────────────────────────────────

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function readSpreadsheetText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();

  const isXlsx = file.name.match(/\.(xlsx|xls|ods)$/i);
  if (isXlsx) {
    const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_csv(sheet, { FS: ";", blankrows: false });
  }

  let text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  if (text.includes("�")) text = new TextDecoder("latin1").decode(buffer);
  return text;
}

function detectDelimiter(text: string): string {
  const delimiters = [";", ",", "\t", "|"];
  const sample = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 8);
  if (sample.length === 0) return ";";

  let selected = ";";
  let bestScore = -1;
  for (const d of delimiters) {
    const score = sample.reduce((t, l) => t + Math.max(0, l.split(d).length - 1), 0);
    if (score > bestScore) { bestScore = score; selected = d; }
  }
  return selected;
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') { cell += '"'; i++; }
      else inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === delimiter) { row.push(cell.trim()); cell = ""; continue; }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some((v) => v.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    cell += char;
  }

  row.push(cell.trim());
  if (row.some((v) => v.length > 0)) rows.push(row);
  return rows;
}

function findColumn(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const i = headers.findIndex((h) => h === alias);
    if (i >= 0) return i;
  }
  for (const alias of aliases) {
    const i = headers.findIndex((h) => h.includes(alias));
    if (i >= 0) return i;
  }
  return -1;
}

/** Converte um valor de data de nascimento vindo da planilha para "YYYY-MM-DD".
 *  Aceita dd/mm/yyyy, yyyy-mm-dd, numero serial do Excel e dd/mm (sem ano —
 *  usa 1900 como marcador de "ano desconhecido", so o dia/mes importa aqui). */
function parseBirthDateCell(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const serial = Number(trimmed.replace(",", "."));
  if (Number.isFinite(serial) && serial > 20_000 && serial < 80_000) {
    const date = new Date(Math.round((serial - 25_569) * 86_400_000));
    if (!Number.isNaN(date.getTime())) {
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    }
  }

  const dmy = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = dmy[3] ? Number(dmy[3]) : 1900;
    if (year < 100) year += year < 50 ? 2000 : 1900;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

interface ParsedBirthdayRow {
  nome: string;
  dataNascimento: string;
}

function parseBirthdayRows(text: string): ParsedBirthdayRow[] {
  const delimiter = detectDelimiter(text);
  const matrix = parseDelimited(text, delimiter);
  if (matrix.length < 2) throw new Error("Planilha sem dados suficientes.");

  const headers = matrix[0].map((h) => normalizeName(h));
  const nomeIdx = findColumn(headers, ["nome", "funcionario", "colaborador", "empregado"]);
  const dataIdx = findColumn(headers, [
    "data de nascimento", "data nascimento", "nascimento", "aniversario", "dt nascimento", "birthday",
  ]);

  if (nomeIdx === -1 || dataIdx === -1) {
    throw new Error(
      "Nao foi possivel identificar as colunas 'Nome' e 'Data de nascimento' na planilha."
    );
  }

  const result: ParsedBirthdayRow[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const line = matrix[i];
    const nome = (line[nomeIdx] ?? "").trim();
    const dataNascimento = parseBirthDateCell(line[dataIdx] ?? "");
    if (!nome || !dataNascimento) continue;
    result.push({ nome, dataNascimento });
  }
  return result;
}

interface ImportSummary {
  importadas: number;
  naoEncontradas: string[];
}

/** Gera um id estável para aniversariantes cadastrados manualmente (fora da lista do RHiD). */
function manualEmployeeId(nome: string): string {
  return `manual-${normalizeName(nome).replace(/\s+/g, "-")}`;
}

type EntryMode = "lista" | "manual";

interface EmployeeBirthdaysPanelProps {
  /** Quando true, mostra apenas o cadastro (sem o resumo "de hoje" duplicado — usado na página dedicada). */
  showManagement?: boolean;
}

export function EmployeeBirthdaysPanel({ showManagement = true }: EmployeeBirthdaysPanelProps): JSX.Element {
  const { rows } = usePayroll();
  const [birthdays, setBirthdays] = useState<EmployeeBirthday[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [funcionarioId, setFuncionarioId] = useState("");
  const [dataNascimento, setDataNascimento] = useState("");
  const [entryMode, setEntryMode] = useState<EntryMode>("lista");
  const [manualNome, setManualNome] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState("");
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

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
    fetch("/api/birthdays")
      .then((res) => res.json())
      .then((data: DbRow[]) => {
        if (Array.isArray(data)) setBirthdays(data.map(fromDb));
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const hoje = todayIso();

  const aniversariantesDoDia = useMemo(
    () => birthdays.filter((b) => monthDay(b.dataNascimento) === monthDay(hoje)),
    [birthdays, hoje]
  );

  const proximosAniversariantes = useMemo(
    () =>
      [...birthdays]
        .map((b) => ({ ...b, diasRestantes: daysUntilNextBirthday(b.dataNascimento, hoje) }))
        .sort((a, b) => a.diasRestantes - b.diasRestantes)
        .slice(0, 8),
    [birthdays, hoje]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    let payload: { funcionarioId: string; funcionarioNome: string };

    if (entryMode === "manual") {
      const nome = manualNome.trim();
      if (!nome) { setError("Informe o nome do aniversariante."); return; }
      payload = { funcionarioId: manualEmployeeId(nome), funcionarioNome: nome };
    } else {
      if (!funcionarioId) { setError("Selecione o funcionario."); return; }
      const selectedEmployee = employeeOptions.find((e) => e.id === funcionarioId);
      if (!selectedEmployee) { setError("Funcionario selecionado nao foi encontrado."); return; }
      payload = { funcionarioId: selectedEmployee.id, funcionarioNome: selectedEmployee.nome };
    }

    if (!dataNascimento) { setError("Informe a data de nascimento."); return; }

    setSaving(true);
    try {
      const res = await fetch("/api/birthdays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, dataNascimento }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Erro ao salvar aniversario.");
      }

      const created = fromDb((await res.json()) as DbRow);
      setBirthdays((prev) => [created, ...prev.filter((b) => b.funcionarioId !== created.funcionarioId)]);
      setDataNascimento("");
      setManualNome("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar aniversario.");
    } finally {
      setSaving(false);
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError(null);
    setImportSummary(null);

    try {
      const text = await readSpreadsheetText(file);
      const parsedRows = parseBirthdayRows(text);

      if (parsedRows.length === 0) {
        throw new Error("Nenhuma linha valida foi encontrada na planilha (verifique nome e data de nascimento).");
      }

      const employeeByName = new Map(employeeOptions.map((e) => [normalizeName(e.nome), e]));
      const matched: { funcionarioId: string; funcionarioNome: string; dataNascimento: string }[] = [];
      const naoEncontradas: string[] = [];

      for (const row of parsedRows) {
        const employee = employeeByName.get(normalizeName(row.nome));
        if (employee) {
          matched.push({ funcionarioId: employee.id, funcionarioNome: employee.nome, dataNascimento: row.dataNascimento });
        } else {
          naoEncontradas.push(row.nome);
        }
      }

      if (matched.length === 0) {
        throw new Error("Nenhum nome da planilha corresponde a um colaborador cadastrado no RHiD.");
      }

      const res = await fetch("/api/birthdays/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: matched }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Erro ao importar planilha.");
      }

      const refreshed = await fetch("/api/birthdays").then((r) => r.json()) as DbRow[];
      if (Array.isArray(refreshed)) setBirthdays(refreshed.map(fromDb));

      setImportSummary({ importadas: matched.length, naoEncontradas });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao importar planilha.");
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  };

  const handleStartEdit = (row: EmployeeBirthday) => {
    setEditingId(row.id);
    setEditData(row.dataNascimento);
    setError(null);
  };

  const handleCancelEdit = () => setEditingId(null);

  const handleSaveEdit = async (id: string) => {
    if (!editData) { setError("Informe uma data valida."); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/birthdays/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataNascimento: editData }),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Erro ao salvar.");
      }

      const updated = fromDb((await res.json()) as DbRow);
      setBirthdays((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao editar aniversario.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await fetch(`/api/birthdays/${id}`, { method: "DELETE" });
      setBirthdays((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setError("Erro ao excluir aniversario. Tente novamente.");
    }
  };

  const sortedBirthdays = useMemo(
    () => [...birthdays].sort((a, b) => a.funcionarioNome.localeCompare(b.funcionarioNome, "pt-BR")),
    [birthdays]
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <p className="section-kicker">Cadastro manual</p>
        <h3>Aniversariantes</h3>
        <p>
          A API do RHiD não informa data de nascimento — cadastre aqui uma vez por colaborador para acompanhar
          os aniversariantes do dia e os próximos aniversários.
        </p>
        <div className="panel-badges">
          <span className="panel-badge">{birthdays.length} colaboradores cadastrados</span>
          <span className="panel-badge">{aniversariantesDoDia.length} fazendo aniversário hoje</span>
        </div>
      </div>

      <div className="rhid-list-grid">
        <article className="ranking-card">
          <h4>Aniversariantes de hoje</h4>
          {aniversariantesDoDia.length === 0 ? (
            <p className="empty-text">Nenhum colaborador faz aniversário hoje.</p>
          ) : (
            <ul>
              {aniversariantesDoDia.map((b) => (
                <li key={b.id}>
                  <div>
                    <strong>{b.funcionarioNome}</strong>
                    <span>🎂 {formatBirthDate(b.dataNascimento)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="ranking-card">
          <h4>Próximos aniversários</h4>
          {proximosAniversariantes.length === 0 ? (
            <p className="empty-text">Nenhum aniversário cadastrado ainda.</p>
          ) : (
            <ul>
              {proximosAniversariantes.map((b) => (
                <li key={b.id}>
                  <div>
                    <strong>{b.funcionarioNome}</strong>
                    <span>{formatBirthDate(b.dataNascimento)}</span>
                  </div>
                  <b>{b.diasRestantes === 0 ? "Hoje" : `em ${b.diasRestantes}d`}</b>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>

      {showManagement && (
        <>
          <div className="upload-section">
            <label className="upload-button" htmlFor="birthdays-upload" aria-disabled={importing}>
              {importing ? "Importando..." : "Importar planilha (nome + data de nascimento)"}
            </label>
            <input
              id="birthdays-upload"
              className="hidden-input"
              type="file"
              accept=".csv,.txt,.xls,.xlsx"
              onChange={(e) => void handleImportFile(e)}
              disabled={importing}
            />
            <span className="empty-text">
              Planilha com colunas "Nome" e "Data de nascimento" (dd/mm/aaaa). Os nomes são
              casados automaticamente com os colaboradores do RHiD.
            </span>
          </div>

          {importSummary && (
            <div className="warning-box">
              <p>
                <strong>{importSummary.importadas}</strong> aniversário(s) importado(s) com sucesso.
                {importSummary.naoEncontradas.length > 0 && (
                  <>
                    {" "}
                    <strong>{importSummary.naoEncontradas.length}</strong> nome(s) não encontrados entre os
                    colaboradores do RHiD (verifique a grafia ou cadastre manualmente): {importSummary.naoEncontradas.join(", ")}.
                  </>
                )}
              </p>
            </div>
          )}

          <form className="manual-form" onSubmit={(e) => void handleSubmit(e)}>
            <div className="mode-tabs" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={`mode-tab${entryMode === "lista" ? " active" : ""}`}
                onClick={() => setEntryMode("lista")}
              >
                Selecionar da lista RHiD
              </button>
              <button
                type="button"
                className={`mode-tab${entryMode === "manual" ? " active" : ""}`}
                onClick={() => setEntryMode("manual")}
              >
                Digitar nome manualmente
              </button>
            </div>

            <div className="manual-form-grid">
              {entryMode === "lista" ? (
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
              ) : (
                <label className="manual-field">
                  <span>Nome do aniversariante</span>
                  <input
                    className="filter-input"
                    value={manualNome}
                    onChange={(e) => setManualNome(e.target.value)}
                    placeholder="Ex.: Maria da Silva (nao precisa estar no RHiD)"
                  />
                </label>
              )}

              <label className="manual-field">
                <span>Data de nascimento</span>
                <input
                  className="filter-input"
                  type="date"
                  value={dataNascimento}
                  onChange={(e) => setDataNascimento(e.target.value)}
                />
              </label>
            </div>

            <div className="manual-actions">
              <button className="primary-btn" type="submit" disabled={saving}>
                {saving ? "Salvando..." : "Salvar aniversario"}
              </button>
            </div>
          </form>

          {error && (
            <div className="warning-box">
              <p>{error}</p>
            </div>
          )}

          <div className="table-wrapper">
            <table className="purchases-table">
              <thead>
                <tr>
                  <th>Funcionario</th>
                  <th>Data de nascimento</th>
                  <th>Acao</th>
                </tr>
              </thead>
              <tbody>
                {sortedBirthdays.map((row) =>
                  editingId === row.id ? (
                    <tr key={row.id}>
                      <td>{row.funcionarioNome}</td>
                      <td>
                        <input className="filter-input" type="date" value={editData} onChange={(e) => setEditData(e.target.value)} />
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
                      <td><strong>{row.funcionarioNome}</strong></td>
                      <td>{formatBirthDate(row.dataNascimento)}</td>
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
                {loaded && sortedBirthdays.length === 0 && (
                  <tr>
                    <td colSpan={3} className="empty-row">
                      Nenhum aniversario cadastrado ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
