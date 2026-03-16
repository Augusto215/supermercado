import { NextResponse } from "next/server";
import { loadRhidReportData } from "@/lib/rhid-report";

export async function GET() {
  const report = await loadRhidReportData();
  return NextResponse.json(report);
}