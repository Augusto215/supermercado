import { contarDiasUteisMes } from "@/lib/fields";
import padroesJson from "@/lib/vt-padroes.json";

/**
 * Vale transporte (VT)
 *
 * VT = (dias úteis do mês atual - faltas do mês anterior) x padrão (R$ por dia = passagem x qtde)
 *
 * Os padrões ficam salvos no banco (tabela employee_vt_padroes, ver lib/vt-padroes-db.ts) e são
 * editados na página "Vale Transporte". Este arquivo só lê o BACKUP INICIAL (lib/vt-padroes.json),
 * extraído das planilhas de transporte, usado para pré-preencher quem ainda não está no banco.
 * Para regerar o backup: node scripts/gerar-padroes-vt.cjs "<MATRIZ>.xlsx" "<LL>.xlsx" "<RL>.xlsx"
 */

export interface PadraoVt {
  nome: string;
  /** Loja da planilha (RCRUZ, LL, RL). */
  loja?: string;
  valorPassagem: number;
  quantidade: number;
}

export function normalizeNomeVt(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // remove acentos
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const padroesPorNome = new Map<string, PadraoVt>(
  (padroesJson as PadraoVt[]).map((p) => [normalizeNomeVt(p.nome), p])
);

const CONECTIVOS = new Set(["DA", "DE", "DO", "DAS", "DOS", "E"]);

function tokens(nomeNormalizado: string): string[] {
  return nomeNormalizado.split(" ").filter((t) => t && !CONECTIVOS.has(t));
}

/** Distância de edição (com transposição de letras vizinhas contando 1). */
function distancia(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + custo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** Abreviação ("V" = "VASCONCELOS") ou erro de digitação de 1 letra ("ARUJO" = "ARAUJO"). */
function tokenParecido(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === 1 || b.length === 1) return a[0] === b[0];
  return Math.min(a.length, b.length) >= 4 && distancia(a, b) <= 1;
}

/**
 * true quando os dois nomes parecem a mesma pessoa:
 * - todos os nomes do mais curto (mín. 2) aparecem no mais longo;
 * - primeiro nome igual; se o primeiro nome tiver diferença de grafia
 *   (MILLENA/MILENA), os dois nomes precisam ter a mesma quantidade de partes.
 */
function mesmoNome(a: string[], b: string[]): boolean {
  if (a.length < 2 || b.length < 2) return false;
  if (a[0] !== b[0] && !(tokenParecido(a[0], b[0]) && a.length === b.length)) return false;
  const [curto, longo] = a.length <= b.length ? [a, b] : [b, a];
  const usados = new Set<number>();
  return curto.every((t) => {
    const idx = longo.findIndex((l, i) => !usados.has(i) && tokenParecido(t, l));
    if (idx < 0) return false;
    usados.add(idx);
    return true;
  });
}

/**
 * Variações do nome para letras perdidas no RHiD (ex.: "GON ALVES" no lugar de "GONÇALVES"):
 * o original + cada par de partes vizinhas juntas.
 */
function variacoes(t: string[]): string[][] {
  const lista = [t];
  for (let i = 0; i < t.length - 1; i++) {
    if (t[i].length <= 4 || t[i + 1].length <= 4) {
      lista.push([...t.slice(0, i), t[i] + t[i + 1], ...t.slice(i + 2)]);
    }
  }
  return lista;
}

const padroesTokens = [...padroesPorNome.entries()].map(([chave, padrao]) => ({
  tokens: tokens(chave),
  padrao,
}));

const cacheBusca = new Map<string, PadraoVt | null>();

/**
 * Busca o padrão de VT pelo nome do RHiD.
 * 1) nome idêntico (sem acentos/pontuação); 2) nome parecido: mesmo primeiro nome e
 * todos os demais nomes do mais curto presentes no mais longo (aceita abreviação e 1 letra trocada),
 * desde que só um funcionário da planilha bata.
 */
export function findPadraoVt(nome: string): PadraoVt | null {
  const chave = normalizeNomeVt(nome);
  const exato = padroesPorNome.get(chave);
  if (exato) return exato;
  if (cacheBusca.has(chave)) return cacheBusca.get(chave)!;

  const alvos = variacoes(tokens(chave));
  const candidatos = padroesTokens.filter((p) => alvos.some((alvo) => mesmoNome(alvo, p.tokens)));
  const encontrado = candidatos.length === 1 ? candidatos[0].padrao : null;
  cacheBusca.set(chave, encontrado);
  return encontrado;
}

/** Padrão (R$ por dia) do backup das planilhas para esse nome, ou null. */
export function padraoDiaBackup(nome: string): number | null {
  const p = findPadraoVt(nome);
  return p ? Math.round(p.valorPassagem * p.quantidade * 100) / 100 : null;
}

/** Dias úteis (segunda a sábado) do mês. Pode ser sobrescrito por VT_DIAS_UTEIS (ex.: meses com feriado). */
export function diasUteisMesVt(ano: number, mesIndex: number): number {
  const configurado = Number((process.env.VT_DIAS_UTEIS ?? "").trim());
  if (Number.isFinite(configurado) && configurado > 0) return configurado;
  return contarDiasUteisMes(ano, mesIndex);
}
