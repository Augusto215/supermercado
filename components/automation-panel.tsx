"use client";

import { useMemo } from "react";

import { usePayroll } from "@/components/payroll-provider";
import { FIELD_DEFINITIONS } from "@/lib/fields";

function fieldLabel(code: string): string {
  const field = FIELD_DEFINITIONS.find((item) => item.key === code);
  return field ? `${field.codigo} - ${field.label}` : code;
}

export function AutomationPanel(): JSX.Element {
  const { rules, summary, toggleRule, runAutomations } = usePayroll();

  const activeCount = useMemo(() => rules.filter((rule) => rule.ativo).length, [rules]);

  return (
    <section className="panel">
      <div className="panel-head split">
        <div>
          <h3>Regras de Automacao</h3>
          <p>Ative ou desative os fluxos automaticos por campo da folha.</p>
        </div>
        <button className="primary-btn" onClick={runAutomations}>
          Executar agora
        </button>
      </div>

      <div className="automation-grid">
        {rules.map((rule) => (
          <article key={rule.id} className="automation-card">
            <div className="automation-title">
              <div>
                <h4>{rule.nome}</h4>
                <p>{rule.descricao}</p>
              </div>
              <button
                className={`status-toggle${rule.ativo ? " on" : ""}`}
                onClick={() => toggleRule(rule.id)}
                aria-pressed={rule.ativo}
              >
                {rule.ativo ? "Ativa" : "Inativa"}
              </button>
            </div>

            <div className="chips-row">
              {rule.campoImpacto.map((code) => (
                <span key={`${rule.id}-${code}`} className="chip">
                  {fieldLabel(code)}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="execution-card">
        <div>
          <span>Regras ativas</span>
          <strong>{activeCount}</strong>
        </div>

        <div>
          <span>Linhas afetadas</span>
          <strong>{summary?.linhasAfetadas ?? 0}</strong>
        </div>

        <div>
          <span>Campos alterados</span>
          <strong>{summary?.camposAlterados ?? 0}</strong>
        </div>

        <div>
          <span>Ultima execucao</span>
          <strong>
            {summary?.ultimaExecucao
              ? new Date(summary.ultimaExecucao).toLocaleString("pt-BR")
              : "Ainda nao executado"}
          </strong>
        </div>
      </div>
    </section>
  );
}
