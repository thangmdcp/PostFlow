import { Skeleton } from "@/components/ui/skeleton";

// Shown instantly by Next.js (loading.tsx convention) while a route's server
// component fetches data — without this, navigation looks frozen until the
// DB round trip finishes.
export function PageLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-9 w-full max-w-md" />
      <div className="space-y-2 pt-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    </div>
  );
}
