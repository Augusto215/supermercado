import { type AutomationRuleConfig, type FieldDefinition } from "@/lib/types";

export const FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    key: "37",
    codigo: 37,
    label: "Comissao",
    category: "Ganhos",
    description: "Valor de comissao individual do colaborador"
  },
  {
    key: "43",
    codigo: 43,
    label: "Faltas",
    category: "Controle",
    description: "Quantidade de faltas registradas no periodo"
  },
  {
    key: "44",
    codigo: 44,
    label: "Desconto DSR (D)",
    category: "Descontos",
    description: "Desconto de descanso semanal remunerado"
  },
  {
    key: "108",
    codigo: 108,
    label: "Contribuicao Sindical",
    category: "Descontos",
    description: "Desconto sindical aplicado em folha"
  },
  {
    key: "150",
    codigo: 150,
    label: "Horas Extras 50%",
    category: "Ganhos",
    description: "Horas extras com adicional de 50%"
  },
  {
    key: "200",
    codigo: 200,
    label: "Horas Extras 100%",
    category: "Ganhos",
    description: "Horas extras com adicional de 100%"
  },
  {
    key: "206",
    codigo: 206,
    label: "Premio Metas",
    category: "Ganhos",
    description: "Premiacao por performance/meta"
  },
  {
    key: "208",
    codigo: 208,
    label: "Compras",
    category: "Controle",
    description: "Compras no supermercado vinculadas ao colaborador"
  },
  {
    key: "226",
    codigo: 226,
    label: "Diferenca de Caixa",
    category: "Controle",
    description: "Diferencas positivas ou negativas de caixa"
  },
  {
    key: "325",
    codigo: 325,
    label: "Vale Refeicao",
    category: "Descontos",
    description: "Desconto de vale refeicao"
  },
  {
    key: "460",
    codigo: 460,
    label: "Vale",
    category: "Descontos",
    description: "Desconto de adiantamentos/vales"
  },
  {
    key: "3490",
    codigo: 3490,
    label: "Faltas Atraso Horas",
    category: "Controle",
    description: "Horas acumuladas de faltas e atrasos"
  }
];

export const FIELD_ORDER = FIELD_DEFINITIONS.map((field) => field.key);

export const DEFAULT_AUTOMATION_RULES: AutomationRuleConfig[] = [
  {
    id: "contagem-atrasos",
    nome: "Contagem de atrasos por dia",
    descricao: "Conta cada dia em que o colaborador teve atraso na entrada ou saída antecipada. Se o dia tiver minutos de atraso/saída antecipada/falta parcial (e não for falta integral), soma +1 na QTD ATRASOS.",
    campoImpacto: ["3490"],
    ativo: true
  },
  {
    id: "faltas-para-atraso",
    nome: "Faltas para horas de atraso",
    descricao: "Converte faltas em horas de atraso automaticamente (1 falta = 7.33h).",
    campoImpacto: ["43", "3490"],
    ativo: true
  },
  {
    id: "compras-vale-refeicao",
    nome: "Compras acima do limite",
    descricao: "Quando compras ultrapassam R$ 800, aplica 6% em Vale Refeicao.",
    campoImpacto: ["208", "325"],
    ativo: true
  },
  {
    id: "caixa-dsr",
    nome: "Desconto por diferenca de caixa",
    descricao: "Quando Diferenca de Caixa (226) passa de R$ 1,05, desconta o valor no campo DSR (44).",
    campoImpacto: ["226", "44"],
    ativo: true
  },
  {
    id: "meta-extra",
    nome: "Bonus por horas extras",
    descricao: "Horas extras totais acima de 20h geram bonus de R$ 120 em Premio Metas.",
    campoImpacto: ["150", "200", "206"],
    ativo: false
  }
];
