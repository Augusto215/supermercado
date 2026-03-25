"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";

import { DEFAULT_AUTOMATION_RULES, FIELD_ORDER } from "@/lib/fields";
import {
  type AutomationRuleConfig,
  type AutomationRunSummary,
  type EditableBaseField,
  type PayrollRow
} from "@/lib/types";

interface PayrollProviderProps {
  children: ReactNode;
  initialRows: PayrollRow[];
}

interface PayrollContextValue {
  rows: PayrollRow[];
  visibleRows: PayrollRow[];
  rules: AutomationRuleConfig[];
  summary: AutomationRunSummary | null;
  search: string;
  roleFilter: string;
  roles: string[];
  setSearch: (value: string) => void;
  setRoleFilter: (value: string) => void;
  updateBaseField: (rowId: string, field: EditableBaseField, value: string) => void;
  updateNumericField: (rowId: string, fieldKey: string, value: number) => void;
  bulkSetField: (fieldKey: string, value: number) => void;
  toggleRule: (ruleId: string) => void;
  runAutomations: () => void;
}

const PayrollContext = createContext<PayrollContextValue | null>(null);

function updateRow(rows: PayrollRow[], rowId: string, updater: (row: PayrollRow) => PayrollRow): PayrollRow[] {
  return rows.map((row) => (row.id === rowId ? updater(row) : row));
}

function roundTwo(value: number): number {
  return Number(value.toFixed(2));
}

const CAIXA_DESCONTO_LIMITE = 1.05;

function sanitizeNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return value;
}

function calcularDescontoDiferencaCaixa(diferencaCaixa: number): number {
  if (!Number.isFinite(diferencaCaixa) || diferencaCaixa <= CAIXA_DESCONTO_LIMITE) {
    return 0;
  }

  return roundTwo(diferencaCaixa);
}

export function PayrollProvider({ children, initialRows }: PayrollProviderProps): JSX.Element {
  const [rows, setRows] = useState<PayrollRow[]>(initialRows);
  const [rules, setRules] = useState<AutomationRuleConfig[]>(DEFAULT_AUTOMATION_RULES);
  const [summary, setSummary] = useState<AutomationRunSummary | null>(null);
  const [search, setSearch] = useState<string>("");
  const [roleFilter, setRoleFilter] = useState<string>("TODAS");

  const updateBaseField = useCallback((rowId: string, field: EditableBaseField, value: string) => {
    setRows((currentRows) =>
      updateRow(currentRows, rowId, (row) => ({
        ...row,
        [field]: value
      }))
    );
  }, []);

  const updateNumericField = useCallback((rowId: string, fieldKey: string, value: number) => {
    setRows((currentRows) =>
      updateRow(currentRows, rowId, (row) => ({
        ...row,
        valores: {
          ...row.valores,
          [fieldKey]: sanitizeNumber(value)
        }
      }))
    );
  }, []);

  const bulkSetField = useCallback((fieldKey: string, value: number) => {
    setRows((currentRows) =>
      currentRows.map((row) => ({
        ...row,
        valores: {
          ...row.valores,
          [fieldKey]: sanitizeNumber(value)
        }
      }))
    );
  }, []);

  const toggleRule = useCallback((ruleId: string) => {
    setRules((currentRules) =>
      currentRules.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              ativo: !rule.ativo
            }
          : rule
      )
    );
  }, []);

  const runAutomations = useCallback(() => {
    setRows((currentRows) => {
      let linhasAfetadas = 0;
      let camposAlterados = 0;

      const updatedRows = currentRows.map((row) => {
        const original = row.valores;
        const nextValues = { ...row.valores };

        for (const rule of rules) {
          if (!rule.ativo) {
            continue;
          }

          if (rule.id === "faltas-para-atraso") {
            const faltas = nextValues["43"] ?? 0;
            nextValues["3490"] = roundTwo(faltas * 7.33);
          }

          if (rule.id === "compras-vale-refeicao") {
            const compras = nextValues["208"] ?? 0;

            if (compras > 800) {
              nextValues["325"] = roundTwo(compras * 0.06);
            }
          }

          if (rule.id === "caixa-dsr") {
            const diferencaCaixa = nextValues["226"] ?? 0;
            nextValues["44"] = calcularDescontoDiferencaCaixa(diferencaCaixa);
          }

          if (rule.id === "meta-extra") {
            const totalExtras = (nextValues["150"] ?? 0) + (nextValues["200"] ?? 0);

            if (totalExtras > 20) {
              nextValues["206"] = Math.max(nextValues["206"] ?? 0, 120);
            }
          }
        }

        let rowChanged = false;

        for (const key of FIELD_ORDER) {
          if ((original[key] ?? 0) !== (nextValues[key] ?? 0)) {
            camposAlterados += 1;
            rowChanged = true;
          }
        }

        if (rowChanged) {
          linhasAfetadas += 1;
          return {
            ...row,
            valores: nextValues
          };
        }

        return row;
      });

      setSummary({
        linhasAfetadas,
        camposAlterados,
        ultimaExecucao: new Date().toISOString()
      });

      return updatedRows;
    });
  }, [rules]);

  const roles = useMemo(() => {
    const uniqueRoles = new Set<string>();

    for (const row of rows) {
      if (row.funcao) {
        uniqueRoles.add(row.funcao);
      }
    }

    return Array.from(uniqueRoles).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const visibleRows = useMemo(() => {
    return rows.filter((row) => {
      const term = search.trim().toLowerCase();
      const matchesSearch =
        term.length === 0 ||
        row.funcionario.toLowerCase().includes(term) ||
        row.codigo.toLowerCase().includes(term) ||
        row.funcao.toLowerCase().includes(term);

      const matchesRole = roleFilter === "TODAS" || row.funcao === roleFilter;

      return matchesSearch && matchesRole;
    });
  }, [rows, search, roleFilter]);

  const value = useMemo<PayrollContextValue>(
    () => ({
      rows,
      visibleRows,
      rules,
      summary,
      search,
      roleFilter,
      roles,
      setSearch,
      setRoleFilter,
      updateBaseField,
      updateNumericField,
      bulkSetField,
      toggleRule,
      runAutomations
    }),
    [
      rows,
      visibleRows,
      rules,
      summary,
      search,
      roleFilter,
      roles,
      updateBaseField,
      updateNumericField,
      bulkSetField,
      toggleRule,
      runAutomations
    ]
  );

  return <PayrollContext.Provider value={value}>{children}</PayrollContext.Provider>;
}

export function usePayroll(): PayrollContextValue {
  const context = useContext(PayrollContext);

  if (!context) {
    throw new Error("usePayroll must be used within PayrollProvider");
  }

  return context;
}
