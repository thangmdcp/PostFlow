import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <h2 className="text-lg font-semibold">Không tìm thấy trang</h2>
      <Link href="/" className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm">
        Về Dashboard
      </Link>
    </div>
  );
}
