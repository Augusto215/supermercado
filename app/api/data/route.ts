import { loadRhidReportData } from "@/lib/rhid-report";

export const dynamic = "force-dynamic";

function isTruthyParam(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function toDateString(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}

function toCompanyIds(value: string | null): number[] | undefined {
  if (!value) return undefined;
  const ids = value.split(",").map((v) => parseInt(v.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
  return ids.length > 0 ? ids : undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const forceRefresh = isTruthyParam(url.searchParams.get("refresh")) || isTruthyParam(url.searchParams.get("force"));
  const dataIni    = toDateString(url.searchParams.get("dataIni"));
  const dataFinal  = toDateString(url.searchParams.get("dataFinal"));
  const companyIds = toCompanyIds(url.searchParams.get("companyIds"));

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        const report = await loadRhidReportData({
          forceRefresh,
          dataIni,
          dataFinal,
          companyIds,
          onProgress: (current, total) => send({ type: "progress", current, total }),
        });

        send({ type: "done", report });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isTimeout = /timeout/i.test(message);
        send({
          type: "error",
          status: isTimeout ? 504 : 500,
          message: isTimeout
            ? "Tempo limite excedido ao carregar dados da API RHiD."
            : "Falha ao carregar dados da API RHiD.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "Connection":    "keep-alive",
    },
  });
}
