#!/usr/bin/env node
/**
 * Gera lib/vt-padroes.json a partir das planilhas de transporte (uma por loja).
 *
 * Uso (todo mês, com as planilhas novas):
 *   node scripts/gerar-padroes-vt.cjs "10 OUTUBRO TRANSPORTE MATRIZ.xlsx" "10 - OUTUBRO TRANSPORTE LL.xlsx" "10 OUTUBRO TRANSPORTE - RL.xlsx"
 *
 * Em cada arquivo lê a aba geral do VT ("VT RCRUZ - GERAL", " VT LL - GERAL", "VT RCRUZ"...),
 * que tem todos os nomes; as abas "PADRÃO X,XX" são só esses mesmos nomes separados por padrão.
 * Colunas: B = FUNCIONÁRIO, E = VLR PASS, F = QTDE (G = CUSTO DIA = padrão = E x F)
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const arquivos = process.argv.slice(2);
if (!arquivos.length) {
  console.error('Uso: node scripts/gerar-padroes-vt.cjs "<planilha1.xlsx>" ["<planilha2.xlsx>" ...]');
  process.exit(1);
}

function acharAbaGeral(wb) {
  const nomes = wb.SheetNames;
  return (
    nomes.find((s) => /^VT\b.*GERAL/i.test(s.trim())) ??
    nomes.find((s) => /^VT\s+\S+$/i.test(s.trim()))
  );
}

const padroes = [];
const vistos = new Map();

for (const arquivo of arquivos) {
  const wb = XLSX.readFile(arquivo);
  const aba = acharAbaGeral(wb);
  if (!aba) {
    console.error(`[${arquivo}] aba geral de VT não encontrada. Abas: ${wb.SheetNames.join(", ")}`);
    process.exit(1);
  }
  const loja = aba.trim().replace(/^VT\s+/i, "").replace(/\s*-\s*GERAL\s*$/i, "").trim();

  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1 });
  let lidos = 0;
  for (const linha of linhas.slice(1)) {
    const nome = typeof linha[1] === "string" ? linha[1].replace(/\s+/g, " ").trim() : "";
    const valorPassagem = Number(linha[4]);
    const quantidade = Number(linha[5]);
    if (!nome || !Number.isFinite(valorPassagem) || valorPassagem <= 0) continue;
    const chave = nome.toUpperCase();
    if (vistos.has(chave)) {
      console.warn(`  aviso: "${nome}" já veio de ${vistos.get(chave)}; ignorado em ${loja}`);
      continue;
    }
    vistos.set(chave, loja);
    padroes.push({
      nome,
      loja,
      valorPassagem: Math.round(valorPassagem * 100) / 100,
      quantidade: Number.isFinite(quantidade) && quantidade > 0 ? quantidade : 2,
    });
    lidos += 1;
  }
  console.log(`[${loja}] ${lidos} funcionários (aba "${aba.trim()}" de ${path.basename(arquivo)})`);
}

padroes.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

const destino = path.join(__dirname, "..", "lib", "vt-padroes.json");
fs.writeFileSync(destino, JSON.stringify(padroes, null, 2) + "\n", "utf8");
console.log(`${padroes.length} padrões de VT gravados em ${path.relative(process.cwd(), destino)}`);
