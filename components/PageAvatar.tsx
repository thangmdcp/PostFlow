"use client";

import { useEffect, useState } from "react";

type PageIdentity = { id: string; pageName: string };

export function pageAvatarUrl(page: Pick<PageIdentity, "id">) {
  return `/api/connections/${encodeURIComponent(page.id)}/avatar`;
}

interface PageAvatarProps {
  page: PageIdentity;
  className?: string;
}

export function PageAvatar({ page, className = "h-7 w-7" }: PageAvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [page.id]);

  if (failed) {
    return (
      <span aria-hidden="true" className={`${className} inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-[10px] font-bold text-white`}>
        {page.pageName.trim().charAt(0).toLocaleUpperCase("vi") || "P"}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={pageAvatarUrl(page)}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${className} shrink-0 rounded-full border border-slate-200 bg-slate-100 object-cover dark:border-slate-700 dark:bg-slate-800`}
    />
  );
}
