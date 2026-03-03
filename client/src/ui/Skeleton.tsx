import React from 'react';
import { cn } from './primitives/cn';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('tt-skeleton', className)} {...props} />;
}
