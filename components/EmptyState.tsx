"use client";

import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  message?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, message, action, className = "" }: EmptyStateProps) {
  return (
    <div className={`rounded-xl border bg-card py-16 text-center text-muted-foreground ${className}`}>
      <p className="text-lg mb-3">{title}</p>
      {message && <p className="text-sm mb-3">{message}</p>}
      {action}
    </div>
  );
}
