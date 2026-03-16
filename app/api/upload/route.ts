import { NextRequest, NextResponse } from "next/server";
import { decodeCsv } from "@/lib/rhid-report";

// Import the internal functions. Since they are not exported, I need to make them available or duplicate logic.
// To avoid duplication, let's export them or create a helper.

import {
  parseRawRows,
  processRows,
  buildLists,
  buildSummary,
  emptyReport
} from "@/lib/rhid-report";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const content = decodeCsv(buffer);
    const warnings: string[] = [];
    const { rawRows, diasUteis } = parseRawRows(content, warnings);
    const processedRows = processRows(rawRows, diasUteis);
    const lists = buildLists(processedRows);

    const report = {
      sourceFile: file.name,
      processedRows,
      lists,
      summary: buildSummary(processedRows, lists, diasUteis),
      warnings
    };

    return NextResponse.json(report);
  } catch (error) {
    console.error("Error processing upload:", error);
    return NextResponse.json({ error: "Failed to process file" }, { status: 500 });
  }
}