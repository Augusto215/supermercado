"use client";

import { type ChangeEvent } from "react";

import { usePayroll } from "@/components/payroll-provider";
import { FIELD_DEFINITIONS } from "@/lib/fields";
import { type EditableBaseField, type PayrollRow } from "@/lib/types";

const DETAILS_COLUMNS: Array<{ key: EditableBaseField; label: string }> = [
  { key: "funcao", label: "Funcao" },
  { key: "tipoProcessamento", label: "Tipo" }
];

function toNumber(value: string): number {
  if (!value.trim()) {
    return 0;
  }

  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getKeyForDisplay(fieldKey: string): string {
  return FIELD_DEFINITIONS.find((field) => field.key === fieldKey)?.label ?? fieldKey;
}

interface RowProps {
  row: PayrollRow;
  onBaseChange: (rowId: string, field: EditableBaseField, value: string) => void;
  onValueChange: (rowId: string, field: string, value: number) => void;
}

function EditableRow({ row, onBaseChange, onValueChange }: RowProps): JSX.Element {
  return (
    <tr>
      <td className="sticky-cell employee-cell">
        <input
          aria-label={`Funcionario de ${row.codigo}`}
          className="table-input"
          value={row.funcionario}
          onChange={(event) => onBaseChange(row.id, "funcionario", event.target.value)}
        />
      </td>

      <td className="code-cell">
        <input
          aria-label={`Codigo de ${row.funcionario}`}
          className="table-input"
          value={row.codigo}
          onChange={(event) => onBaseChange(row.id, "codigo", event.target.value)}
        />
      </td>

      {DETAILS_COLUMNS.map((column) => (
        <td key={`${row.id}-${column.key}`}>
          <input
            aria-label={`${column.label} de ${row.codigo}`}
            className="table-input"
            value={row[column.key]}
            onChange={(event) => onBaseChange(row.id, column.key, event.target.value)}
          />
        </td>
      ))}

      {FIELD_DEFINITIONS.map((field) => (
        <td key={`${row.id}-${field.key}`}>
          <input
            aria-label={`${field.label} de ${row.codigo}`}
            className="table-input number"
            inputMode="decimal"
            value={row.valores[field.key] ?? 0}
            onChange={(event) => onValueChange(row.id, field.key, toNumber(event.target.value))}
          />
        </td>
      ))}
    </tr>
  );
}

export function PayrollTable(): JSX.Element {
  const {
    rows,
    visibleRows,
    search,
    roleFilter,
    roles,
    setSearch,
    setRoleFilter,
    updateBaseField,
    updateNumericField
  } = usePayroll();

  const handleSearch = (event: ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value);
  };

  const handleRole = (event: ChangeEvent<HTMLSelectElement>) => {
    setRoleFilter(event.target.value);
  };

  return (
    <section className="panel">
      <div className="panel-head split">
        <div>
          <p className="section-kicker">Operacao por colaborador</p>
          <h3>Colaboradores e Campos da Folha</h3>
          <p>Edite por linha com filtro rapido por nome, codigo ou funcao.</p>
          <div className="panel-badges">
            <span className="panel-badge">
              {visibleRows.length} de {rows.length} colaboradores
            </span>
            <span className="panel-badge">{FIELD_DEFINITIONS.length} campos variaveis</span>
          </div>
        </div>

        <div className="filter-line">
          <input
            className="filter-input"
            placeholder="Buscar por nome, codigo ou funcao"
            value={search}
            onChange={handleSearch}
          />

          <select className="filter-input" value={roleFilter} onChange={handleRole}>
            <option value="TODAS">Todas as funcoes</option>
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Funcionario</th>
              <th>Codigo</th>
              <th>Funcao</th>
              <th>Tipo</th>
              {FIELD_DEFINITIONS.map((field) => (
                <th key={field.key}>
                  <span>{field.codigo}</span>
                  <small>{getKeyForDisplay(field.key)}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <EditableRow
                key={row.id}
                row={row}
                onBaseChange={updateBaseField}
                onValueChange={updateNumericField}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
