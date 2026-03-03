import React from 'react';
import { cn } from './primitives/cn';

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('tt-empty', className)}>
      <div className="tt-empty-title">{title}</div>
      {description ? <div className="tt-empty-desc">{description}</div> : null}
      {action ? <div className="tt-empty-action">{action}</div> : null}
    </div>
  );
}
