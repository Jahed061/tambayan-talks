import React from 'react';
import { cn } from './primitives/cn';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?: boolean;
};

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, invalid, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn('tt-textarea', invalid ? 'tt-input-invalid' : undefined, className)}
      aria-invalid={invalid ? true : undefined}
      {...props}
    />
  );
});
