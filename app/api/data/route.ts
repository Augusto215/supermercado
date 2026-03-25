import { NextResponse } from "next/server";
import { loadRhidReportData } from "@/lib/rhid-report";

export const dynamic = "force-dynamic";
const DEFAULT_API_ROUTE_TIMEOUT_MS = 45_000;

function getApiRouteTimeoutMs(): number {
  const raw = Number((process.env.RHID_API_ROUTE_TIMEOUT_MS ?? "").trim());

  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_API_ROUTE_TIMEOUT_MS;
  }

  return Math.max(5_000, Math.min(120_000, Math.floor(raw)));
}

function isTruthyParam(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timeout na rota /api/data apos ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const forceRefresh = isTruthyParam(url.searchParams.get("refresh")) || isTruthyParam(url.searchParams.get("force"));
  const timeoutMs = getApiRouteTimeoutMs();
  console.log("[RHiD][API] GET /api/data iniciado", { forceRefresh, timeoutMs });

  try {
    const report = await withTimeout(loadRhidReportData({ forceRefresh }), timeoutMs);
    console.log("[RHiD][API] GET /api/data sucesso", {
      tempoMs: Date.now() - startedAt,
      forceRefresh,
      sourceFile: report.sourceFile,
      totalColaboradores: report.processedRows.length,
      totalWarnings: report.warnings.length
    });
    console.log("[RHiD][API] Warnings retornados", report.warnings);

    return NextResponse.json(report, {
      headers: {
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = /timeout/i.test(message);
    console.error("[RHiD][API] GET /api/data falhou", {
      tempoMs: Date.now() - startedAt,
      error,
      isTimeout
    });

    return NextResponse.json(
      {
        error: isTimeout
          ? "Tempo limite excedido ao carregar dados da API RHiD."
          : "Falha ao carregar dados da API RHiD."
      },
      {
        status: isTimeout ? 504 : 500,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
