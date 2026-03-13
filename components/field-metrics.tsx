"use client";

import { useMemo, useState } from "react";

import { usePayroll } from "@/components/payroll-provider";
import { FIELD_DEFINITIONS } from "@/lib/fields";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value);
}

export function FieldMetrics(): JSX.Element {
  const { rows, bulkSetField } = usePayroll();
  const [bulkValues, setBulkValues] = useState<Record<string, string>>({});

  const stats = useMemo(() => {
    return FIELD_DEFINITIONS.map((field) => {
      const values = rows.map((row) => row.valores[field.key] ?? 0);
      const total = values.reduce((sum, value) => sum + value, 0);
      const average = values.length > 0 ? total / values.length : 0;
      const max = values.reduce((greater, value) => Math.max(greater, value), 0);

      return {
        ...field,
        total,
        average,
        max
      };
    });
  }, [rows]);

  const totalCampos = stats.length;
  const categoriasAtivas = new Set(stats.map((field) => field.category)).size;

  return (
    <section className="panel">
      <div className="panel-head">
        <p className="section-kicker">Visao por campo</p>
        <h3>Campos da Folha por Categoria</h3>
        <p>Monitore total, media e pico de cada evento e ajuste em massa quando necessario.</p>
        <div className="panel-badges">
          <span className="panel-badge">{totalCampos} campos monitorados</span>
          <span className="panel-badge">{categoriasAtivas} categorias ativas</span>
          <span className="panel-badge">{rows.length} colaboradores na base</span>
        </div>
      </div>

      <div className="field-grid">
        {stats.map((field) => (
          <article key={field.key} className="field-card">
            <div className="field-head">
              <span>{field.codigo}</span>
              <strong>{field.label}</strong>
              <small>{field.category}</small>
            </div>

            <div className="field-stats">
              <div>
                <span>Total</span>
                <strong>{formatNumber(field.total)}</strong>
              </div>
              <div>
                <span>Media</span>
                <strong>{formatNumber(field.average)}</strong>
              </div>
              <div>
                <span>Pico</span>
                <strong>{formatNumber(field.max)}</strong>
              </div>
            </div>

            <p>{field.description}</p>

            <div className="bulk-edit">
              <input
                className="filter-input"
                placeholder="Novo valor"
                value={bulkValues[field.key] ?? ""}
                onChange={(event) =>
                  setBulkValues((current) => ({
                    ...current,
                    [field.key]: event.target.value
                  }))
                }
              />
              <button
                className="secondary-btn"
                onClick={() => {
                  const parsed = Number((bulkValues[field.key] ?? "0").replace(",", "."));
                  bulkSetField(field.key, Number.isFinite(parsed) ? parsed : 0);
                }}
              >
                Aplicar em todos
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
