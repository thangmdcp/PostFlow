import { NextResponse } from "next/server";
import { uploadBuffer } from "@/lib/cloudinary";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Thiếu file" }, { status: 400 });
    }
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Chỉ nhận file ảnh" }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "Ảnh tối đa 10 MB" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const { secureUrl } = await uploadBuffer(buffer);
    return NextResponse.json({ url: secureUrl });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload thất bại" },
      { status: 500 }
    );
  }
}
