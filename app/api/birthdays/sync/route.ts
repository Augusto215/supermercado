import { NextResponse } from "next/server";
import { ensureBirthdaysFresh, refreshEmployeeBirthdays } from "@/lib/birthday-sync";

export const dynamic = "force-dynamic";

/**
 * POST /api/birthdays/sync           → só lê o RHiD se os dados estiverem velhos
 *                                      (usado automaticamente ao abrir o painel)
 * POST /api/birthdays/sync?force=1   → força a leitura agora (botão manual)
 */
export async function POST(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";

  try {
    if (force) {
      const resultado = await refreshEmployeeBirthdays();
      return NextResponse.json({ sincronizou: true, ...resultado });
    }

    const { sincronizou, resultado } = await ensureBirthdaysFresh();
    return NextResponse.json({ sincronizou, ...(resultado ?? {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
