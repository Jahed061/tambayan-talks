import React from 'react';
import { cn } from './primitives/cn';

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('tt-badge', className)} {...props} />;
}
