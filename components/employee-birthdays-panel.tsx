"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
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
  if (next.getTime() < reference.getTime()) {
    next = new Date(Number(refYear) + 1, month - 1, day);
  }

  const diffMs = next.getTime() - reference.getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Id estável para aniversariantes cadastrados à mão (fora da lista do RHiD). */
function manualEmployeeId(nome: string): string {
  return `manual-${normalizeName(nome).replace(/\s+/g, "-")}`;
}

type EntryMode = "lista" | "manual";

interface EmployeeBirthdaysPanelProps {
  /** Aniversários já lidos no servidor, para a página abrir preenchida. */
  initialBirthdays: DbRow[];
}

export function EmployeeBirthdaysPanel({ initialBirthdays }: EmployeeBirthdaysPanelProps): JSX.Element {
  const { rows } = usePayroll();
  const [birthdays, setBirthdays] = useState<EmployeeBirthday[]>(() => initialBirthdays.map(fromDb));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [showList, setShowList] = useState(false);

  const [entryMode, setEntryMode] = useState<EntryMode>("lista");
  const [funcionarioId, setFuncionarioId] = useState("");
  const [manualNome, setManualNome] = useState("");
  const [dataNascimento, setDataNascimento] = useState("");

  const [busca, setBusca] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState("");

  const [syncing, setSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState<{ persistidos: number; processados: number } | null>(null);

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

  // Ao abrir o painel, revalida os dados em segundo plano: o servidor só lê o
  // RHiD se a última sincronização estiver velha, então normalmente isso é um
  // no-op instantâneo e a tela nem pisca.
  useEffect(() => {
    let cancelado = false;

    void (async () => {
      try {
        const res = await fetch("/api/birthdays/sync", { method: "POST" });
        if (!res.ok) return;
        const { sincronizou } = (await res.json()) as { sincronizou?: boolean };
        if (!sincronizou || cancelado) return;

        const atualizados = (await fetch("/api/birthdays").then((r) => r.json())) as DbRow[];
        if (!cancelado && Array.isArray(atualizados)) setBirthdays(atualizados.map(fromDb));
      } catch {
        // Painel continua exibindo o que veio do servidor.
      }
    })();

    return () => { cancelado = true; };
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

  const listaFiltrada = useMemo(() => {
    const termo = normalizeName(busca);
    const ordenada = [...birthdays].sort((a, b) => a.funcionarioNome.localeCompare(b.funcionarioNome, "pt-BR"));
    if (!termo) return ordenada;
    return ordenada.filter((b) => normalizeName(b.funcionarioNome).includes(termo));
  }, [birthdays, busca]);

  const handleSyncRhid = async () => {
    setSyncing(true);
    setError(null);
    setSyncSummary(null);
    try {
      const res = await fetch("/api/birthdays/sync?force=1", { method: "POST" });
      const data = (await res.json()) as { persistidos?: number; processados?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Falha ao sincronizar aniversários com o RHiD.");

      const refreshed = (await fetch("/api/birthdays").then((r) => r.json())) as DbRow[];
      if (Array.isArray(refreshed)) setBirthdays(refreshed.map(fromDb));

      setSyncSummary({ persistidos: data.persistidos ?? 0, processados: data.processados ?? 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao sincronizar aniversários com o RHiD.");
    } finally {
      setSyncing(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    let payload: { funcionarioId: string; funcionarioNome: string };

    if (entryMode === "manual") {
      const nome = manualNome.trim();
      if (!nome) { setError("Informe o nome do aniversariante."); return; }
      payload = { funcionarioId: manualEmployeeId(nome), funcionarioNome: nome };
    } else {
      if (!funcionarioId) { setError("Selecione o funcionário."); return; }
      const selecionado = employeeOptions.find((e) => e.id === funcionarioId);
      if (!selecionado) { setError("Funcionário selecionado não foi encontrado."); return; }
      payload = { funcionarioId: selecionado.id, funcionarioNome: selecionado.nome };
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
        throw new Error(err.error ?? "Erro ao salvar aniversário.");
      }

      const created = fromDb((await res.json()) as DbRow);
      setBirthdays((prev) => [created, ...prev.filter((b) => b.funcionarioId !== created.funcionarioId)]);
      setDataNascimento("");
      setManualNome("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar aniversário.");
    } finally {
      setSaving(false);
    }
  };

  const handleStartEdit = (row: EmployeeBirthday) => {
    setEditingId(row.id);
    setEditData(row.dataNascimento);
    setError(null);
  };

  const handleSaveEdit = async (id: string) => {
    if (!editData) { setError("Informe uma data válida."); return; }
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
      setError(e instanceof Error ? e.message : "Erro ao editar aniversário.");
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await fetch(`/api/birthdays/${id}`, { method: "DELETE" });
      setBirthdays((prev) => prev.filter((r) => r.id !== id));
    } catch {
      setError("Erro ao excluir aniversário. Tente novamente.");
    }
  };

  return (
    <section className="panel">
      <div className="panel-head split">
        <div>
          <p className="section-kicker">Equipe</p>
          <h3>Aniversariantes</h3>
          <p>
            Sincronizado automaticamente com os dados pessoais do cadastro do RHiD, duas vezes ao dia.
            Colaboradores sem data preenchida no RHiD podem ser adicionados manualmente.
          </p>
          <div className="panel-badges">
            <span className="panel-badge">{birthdays.length} com data cadastrada</span>
            <span className="panel-badge">{aniversariantesDoDia.length} fazendo aniversário hoje</span>
          </div>
        </div>
        <button className="btn btn-primary" type="button" disabled={syncing} onClick={() => void handleSyncRhid()}>
          {syncing ? "Sincronizando..." : "Sincronizar do RHiD"}
        </button>
      </div>

      {error && (
        <div className="warning-box">
          <p>{error}</p>
        </div>
      )}

      {syncSummary && (
        <p className="period-hint">
          Sincronização concluída: <strong>{syncSummary.persistidos}</strong> aniversário(s) atualizados a
          partir de <strong>{syncSummary.processados}</strong> cadastros lidos no RHiD.
        </p>
      )}

      <div className="birthdays-grid">
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

      <div className="panel-toolbar">
        <button
          className={`secondary-btn${showForm ? " active" : ""}`}
          type="button"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "Fechar cadastro" : "Adicionar manualmente"}
        </button>
        <button
          className={`secondary-btn${showList ? " active" : ""}`}
          type="button"
          onClick={() => setShowList((v) => !v)}
        >
          {showList ? "Ocultar lista completa" : `Exibir lista completa (${birthdays.length})`}
        </button>
      </div>

      {showForm && (
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
                <span>Funcionário</span>
                <select
                  className="filter-input"
                  value={funcionarioId}
                  onChange={(e) => setFuncionarioId(e.target.value)}
                  disabled={employeeOptions.length === 0}
                >
                  {employeeOptions.length === 0 && <option value="">Sem funcionários disponíveis</option>}
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
                  placeholder="Ex.: Maria da Silva (não precisa estar no RHiD)"
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
              {saving ? "Salvando..." : "Salvar aniversário"}
            </button>
          </div>
        </form>
      )}

      {showList && (
        <div className="birthdays-list">
          <input
            className="filter-input"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar colaborador..."
          />

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Funcionário</th>
                  <th>Data de nascimento</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {listaFiltrada.map((row) =>
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
                        <button className="secondary-btn" type="button" onClick={() => setEditingId(null)}>
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
                {listaFiltrada.length === 0 && (
                  <tr>
                    <td colSpan={3} className="empty-row">
                      {busca ? "Nenhum colaborador encontrado para essa busca." : "Nenhum aniversário cadastrado ainda."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
