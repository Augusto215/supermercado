export type FieldCategory = "Ganhos" | "Descontos" | "Controle";

export interface FieldDefinition {
  key: string;
  codigo: number;
  label: string;
  category: FieldCategory;
  description: string;
}

export interface AutomationRuleConfig {
  id: string;
  nome: string;
  descricao: string;
  campoImpacto: string[];
  ativo: boolean;
}

export interface AutomationRunSummary {
  linhasAfetadas: number;
  camposAlterados: number;
  ultimaExecucao: string;
}

export type EditableBaseField = "funcionario" | "codigo" | "funcao" | "tipoProcessamento";

export interface PayrollRow {
  id: string;
  codigo: string;
  funcionario: string;
  funcao: string;
  tipoProcessamento: string;
  valores: Record<string, number>;
}

export interface RhidRawRow {
  id: string;
  nome: string;
  totalNormaisMin: number;
  totalNoturnoMin: number;
  diaFalta: number;
  faltaEAtrasoMin: number;
  abonoMin: number;
  extra100DMin: number;
  extraDiurnaMin: number;
  extraNoturnaMin: number;
  bancoTotalMin: number;
  bancoSaldoMin: number;
  semEscala: boolean;
  quantidadeAtrasos: number;
}

export interface RhidProcessedRow {
  id: string;
  nome: string;
  departamento: string;
  cargo: string;
  faltas: number;
  atrasoTotalMin: number;
  quantidadeAtrasos: number;
  horasExtrasTotaisMin: number;
  horasExtrasPagarMin: number;
  horasExtrasBancoMin: number;
  bancoHorasMin: number;
  statusFaltas: "DESCONTAR" | "OK";
  alertaAtraso: "ALERTA" | "OK";
  motivoDesconto: string;
  valorDesconto: number;
  valorValeRefeicao: number;
  semEscala: boolean;
}

export interface RhidLists {
  maisAtrasos: RhidProcessedRow[];
  comFaltas: RhidProcessedRow[];
  maisHorasExtras: RhidProcessedRow[];
}

export interface RhidAnalyticalSummary {
  totalColaboradores: number;
  totalFaltas: number;
  totalAtrasoMin: number;
  totalHorasExtrasMin: number;
  totalValeRefeicao: number;
  totalValorDesconto: number;
  totalBancoHorasMin: number;
  colaboradoresComFaltas: number;
  colaboradoresComDesconto: number;
  colaboradoresComValorDesconto: number;
  colaboradoresComAlertaAtraso: number;
  maiorAtraso: RhidProcessedRow | null;
  maiorFaltas: RhidProcessedRow | null;
  maiorHorasExtras: RhidProcessedRow | null;
  diasUteisConsiderados: number;
  regraValeRefeicao: string;
}

export interface RhidReportData {
  sourceFile: string | null;
  processedRows: RhidProcessedRow[];
  lists: RhidLists;
  summary: RhidAnalyticalSummary;
  warnings: string[];
}
