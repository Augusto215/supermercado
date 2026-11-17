import { NextResponse } from "next/server";
import { salvarPadraoVt } from "@/lib/vt-padroes-db";

export const dynamic = "force-dynamic";

interface SalvarPadraoBody {
  funcionarioId?: string;
  funcionarioNome?: string;
  /** R$ por dia; null limpa o campo. */
  padraoDia?: number | null;
}

/** Salva o padrão (R$/dia) de VT de um colaborador. O valor fica salvo para os próximos meses. */
export async function PUT(request: Request) {
  let body: SalvarPadraoBody;
  try {
    body = (await request.json()) as SalvarPadraoBody;
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const funcionarioId = String(body.funcionarioId ?? "").trim();
  const funcionarioNome = String(body.funcionarioNome ?? "").trim();
  const padraoDia = body.padraoDia ?? null;

  if (!funcionarioId || !funcionarioNome) {
    return NextResponse.json({ error: "Funcionário não informado." }, { status: 422 });
  }
  if (padraoDia !== null && (typeof padraoDia !== "number" || !Number.isFinite(padraoDia) || padraoDia < 0 || padraoDia > 1000)) {
    return NextResponse.json({ error: "Padrão inválido (informe o valor em R$ por dia)." }, { status: 422 });
  }

  try {
    const salvo = await salvarPadraoVt(funcionarioId, funcionarioNome, padraoDia);
    return NextResponse.json(salvo);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Falha ao salvar: ${message}` }, { status: 500 });
  }
}
