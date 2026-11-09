import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  const isTabular = type === 'number' || type === 'date' || type === 'time' || type === 'tel';
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'file:text-foreground placeholder:text-muted-foreground/80 selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-border/85 bg-background h-8.5 w-full min-w-0 rounded-md border px-2.5 py-1 text-sm shadow-2xs transition-colors outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-xs file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-ring focus-visible:ring-ring/30 focus-visible:ring-2',
        'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
        isTabular && 'font-mono tabular-nums',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
