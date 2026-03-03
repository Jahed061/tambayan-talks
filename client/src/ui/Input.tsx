import React from 'react';
import { cn } from './primitives/cn';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn('tt-input', invalid ? 'tt-input-invalid' : undefined, className)}
      aria-invalid={invalid ? true : undefined}
      {...props}
    />
  );
});
