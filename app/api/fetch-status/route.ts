import { NextResponse } from "next/server";
import { poolStatus } from "@/lib/downloadPool";
export const dynamic = "force-dynamic";

export async function GET() { return NextResponse.json(await poolStatus()); }
