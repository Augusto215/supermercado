import { loadRhidDirectoryData } from "@/lib/rhid-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { companies, people } = await loadRhidDirectoryData();

    // Se a API retornou empresas com nome, usa direto
    if (companies.length > 0) {
      return Response.json(
        companies
          .filter((c) => c.id !== undefined)
          .map((c) => ({ id: c.id!, name: c.name ?? `Empresa ${c.id}`, cnpj: c.cnpj ?? null }))
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      );
    }

    // Fallback: deriva empresas únicas a partir dos ids dos colaboradores
    const seen = new Map<number, number>();
    for (const p of people) {
      if (p.idCompany !== undefined && !seen.has(p.idCompany)) {
        seen.set(p.idCompany, 0);
      }
      if (p.idCompany !== undefined) {
        seen.set(p.idCompany, (seen.get(p.idCompany) ?? 0) + 1);
      }
    }

    const derived = Array.from(seen.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([id, count]) => ({ id, name: `Empresa ${id}`, cnpj: null, count }));

    return Response.json(derived);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
