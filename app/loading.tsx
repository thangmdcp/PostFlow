export default function Loading() {
  return (
    <div className="space-y-5 animate-pulse" aria-label="Đang chuyển trang">
      <div className="h-7 w-44 rounded-lg bg-slate-200 dark:bg-slate-800" />
      <div className="h-4 w-72 rounded bg-slate-100 dark:bg-slate-800/70" />
      <div className="rounded-2xl border bg-white p-5 shadow-sm dark:bg-slate-900">
        <div className="h-10 w-full rounded-xl bg-slate-100 dark:bg-slate-800" />
        <div className="mt-4 space-y-3">
          <div className="h-14 rounded-xl bg-slate-50 dark:bg-slate-800/60" />
          <div className="h-14 rounded-xl bg-slate-50 dark:bg-slate-800/60" />
          <div className="h-14 rounded-xl bg-slate-50 dark:bg-slate-800/60" />
        </div>
      </div>
    </div>
  );
}
