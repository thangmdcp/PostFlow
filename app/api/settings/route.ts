import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const ENV_PATH = path.join(process.cwd(), ".env.local");

function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^"(.*)"$/, "$1");
    result[key] = val;
  }
  return result;
}

function serializeEnv(vars: Record<string, string>): string {
  return (
    Object.entries(vars)
      .map(([k, v]) => `${k}="${v}"`)
      .join("\n") + "\n"
  );
}

export async function GET() {
  try {
    const content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";
    const vars = parseEnv(content);
    return NextResponse.json({ vars });
  } catch {
    return NextResponse.json({ vars: {} });
  }
}

export async function POST(req: Request) {
  try {
    const updates = (await req.json()) as Record<string, string>;

    // Read existing
    const content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";
    const existing = parseEnv(content);

    // Merge — skip empty values (don't overwrite with empty)
    for (const [k, v] of Object.entries(updates)) {
      if (v && v.trim()) {
        existing[k] = v.trim();
      }
    }

    fs.writeFileSync(ENV_PATH, serializeEnv(existing), "utf-8");
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Write failed" },
      { status: 500 }
    );
  }
}
