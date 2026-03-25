import { NextResponse } from "next/server";

export function POST() {
  return NextResponse.json(
    {
      error: "Upload de planilha desativado. A base agora vem direto da API do RHiD."
    },
    { status: 410 }
  );
}
