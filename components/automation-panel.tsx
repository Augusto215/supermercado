"use client";

import { usePayroll } from "@/components/payroll-provider";
import { FIELD_DEFINITIONS } from "@/lib/fields";

function fieldLabel(code: string): string {
  const f = FIELD_DEFINITIONS.find((d) => d.key === code);
  return f ? `${f.codigo} · ${f.label}` : code;
}

// Regras fixas hardcoded no motor de apuração (rhid-report.ts).
// Sempre ativas — não podem ser desativadas pela interface.
const FIXED_RULES = [
  {
    nome: "Status de faltas",
    descricao: "Colaboradores com mais de 1 falta no período recebem status DESCONTAR.",
    campos: ["43"]
  },
  {
    nome: "Alerta de atraso",
    descricao: "Atraso acumulado acima de 5h no período gera alerta ALERTA na apuração.",
    campos: ["3490"]
  },
  {
    nome: "Cálculo do Vale Refeição",
    descricao: "Vale = (dias úteis − faltas) × R$15,82 × 20%. Faltas reduzem o valor proporcionalmente.",
    campos: ["325", "43"]
  },
  {
    nome: "Desconto por falta (DSR)",
    descricao: "Se status = DESCONTAR: desconto = faltas × R$15,82 × 20%, lançado no campo DSR.",
    campos: ["44", "43"]
  },
  {
    nome: "Horas extras → banco ou pagamento",
    descricao: "< 40h extras: tudo vai pro banco de horas. ≥ 40h: paga 10h. ≥ 50h: paga 20h.",
    campos: ["150"]
  },
  {
    nome: "Banco de horas com débito de atraso",
    descricao: "Saldo do banco = saldo API + extras no banco. Se atraso > 10h, o atraso é debitado do banco.",
    campos: ["3490"]
  }
];

export function AutomationPanel(): JSX.Element {
  const { rules } = usePayroll();

  const active   = rules.filter((r) => r.ativo);
  const inactive = rules.filter((r) => !r.ativo);
  const ordered  = [...active, ...inactive];

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Regras</h3>
        <p>
          Todas as regras aplicadas na apuração de ponto e no cálculo da folha.
        </p>
      </div>

      {/* Regras fixas do motor */}
      <p className="rules-section-label">Motor de apuração — sempre ativas</p>
      <ul className="rules-list" style={{ marginBottom: 24 }}>
        {FIXED_RULES.map((rule) => (
          <li key={rule.nome} className="rule-item active">
            <div className="rule-info">
              <div className="rule-name">{rule.nome}</div>
              <div className="rule-desc">{rule.descricao}</div>
              <div className="rule-fields">
                {rule.campos.map((code) => (
                  <span key={`${rule.nome}-${code}`} className="rule-field-chip">
                    {fieldLabel(code)}
                  </span>
                ))}
              </div>
            </div>
            <span className="rule-status-badge fixed">Fixa</span>
          </li>
        ))}
      </ul>

      {/* Regras configuráveis */}
      <p className="rules-section-label">Automações configuráveis — {active.length} de {rules.length} ativas</p>
      <ul className="rules-list">
        {ordered.map((rule) => (
          <li key={rule.id} className={`rule-item ${rule.ativo ? "active" : "inactive"}`}>
            <div className="rule-info">
              <div className="rule-name">{rule.nome}</div>
              <div className="rule-desc">{rule.descricao}</div>
              <div className="rule-fields">
                {rule.campoImpacto.map((code) => (
                  <span key={`${rule.id}-${code}`} className="rule-field-chip">
                    {fieldLabel(code)}
                  </span>
                ))}
              </div>
            </div>
            <span className={`rule-status-badge ${rule.ativo ? "on" : "off"}`}>
              {rule.ativo ? "Ativa" : "Inativa"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
