import { promises as fs } from "node:fs";
import path from "node:path";

import { type RhidReportData } from "@/lib/types";

const DEFAULT_DB_RELATIVE_PATH = "data/rhid-report-db.json";
const MAX_RECORDS = 20;

interface RhidReportDatabaseRecord {
  cacheKey: string;
  report: RhidReportData;
  expiresAtMs: number;
  updatedAtMs: number;
}

interface RhidReportDatabaseFile {
  version: 1;
  records: RhidReportDatabaseRecord[];
}

export interface PersistedRhidReport {
  data: RhidReportData;
  expiresAtMs: number;
  updatedAtMs: number;
}

function isPersistenceEnabled(): boolean {
  const raw = (process.env.RHID_REPORT_DB_ENABLED ?? "true").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no";
}

function resolveDatabasePath(): string {
  const configured = (process.env.RHID_REPORT_DB_PATH ?? "").trim();

  if (!configured) {
    return path.join(process.cwd(), DEFAULT_DB_RELATIVE_PATH);
  }

  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

function emptyDatabase(): RhidReportDatabaseFile {
  return {
    version: 1,
    records: []
  };
}

function normalizeDatabase(content: unknown): RhidReportDatabaseFile {
  if (!content || typeof content !== "object") {
    return emptyDatabase();
  }

  const recordsInput = (content as { records?: unknown }).records;

  if (!Array.isArray(recordsInput)) {
    return emptyDatabase();
  }

  const records = recordsInput.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const candidate = entry as {
      cacheKey?: unknown;
      report?: unknown;
      expiresAtMs?: unknown;
      updatedAtMs?: unknown;
    };

    if (
      typeof candidate.cacheKey !== "string" ||
      typeof candidate.expiresAtMs !== "number" ||
      !Number.isFinite(candidate.expiresAtMs) ||
      typeof candidate.updatedAtMs !== "number" ||
      !Number.isFinite(candidate.updatedAtMs) ||
      !candidate.report ||
      typeof candidate.report !== "object"
    ) {
      return [];
    }

    return [
      {
        cacheKey: candidate.cacheKey,
        report: candidate.report as RhidReportData,
        expiresAtMs: Math.floor(candidate.expiresAtMs),
        updatedAtMs: Math.floor(candidate.updatedAtMs)
      }
    ];
  });

  return {
    version: 1,
    records
  };
}

async function readDatabase(filePath: string): Promise<RhidReportDatabaseFile> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeDatabase(parsed);
  } catch {
    return emptyDatabase();
  }
}

async function writeDatabase(filePath: string, database: RhidReportDatabaseFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(database, null, 2), "utf-8");
  await fs.rename(tempPath, filePath);
}

export async function readPersistedRhidReport(cacheKey: string): Promise<PersistedRhidReport | null> {
  if (!isPersistenceEnabled()) {
    return null;
  }

  const database = await readDatabase(resolveDatabasePath());
  const record = database.records.find((item) => item.cacheKey === cacheKey);

  if (!record) {
    return null;
  }

  return {
    data: record.report,
    expiresAtMs: record.expiresAtMs,
    updatedAtMs: record.updatedAtMs
  };
}

export async function persistRhidReport(
  cacheKey: string,
  report: RhidReportData,
  expiresAtMs: number
): Promise<void> {
  if (!isPersistenceEnabled()) {
    return;
  }

  const filePath = resolveDatabasePath();
  const database = await readDatabase(filePath);
  const updatedAtMs = Date.now();

  const nextRecords = database.records.filter((item) => item.cacheKey !== cacheKey);
  nextRecords.unshift({
    cacheKey,
    report,
    expiresAtMs: Math.floor(expiresAtMs),
    updatedAtMs
  });

  await writeDatabase(filePath, {
    version: 1,
    records: nextRecords.slice(0, MAX_RECORDS)
  });
}
