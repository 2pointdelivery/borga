'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

type SwitchProps = Omit<React.ComponentProps<'button'>, 'onChange' | 'value'> & {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

/**
 * A plain toggle button. (It replaces the Radix Switch, which keeps each switch's button in React state through a ref callback:
 * a page with dozens of switches, such as Settings, then scheduled dozens of state updates in one commit when it unmounted, and React
 * stopped it with "Maximum update depth exceeded".)
 */
function Switch({ className, checked, defaultChecked, onCheckedChange, disabled, onClick, ...props }: SwitchProps) {
  const [inner, setInner] = React.useState(!!defaultChecked)
  const on = checked ?? inner
  const state = on ? 'checked' : 'unchecked'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      data-state={state}
      data-disabled={disabled ? '' : undefined}
      data-slot="switch"
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e)
        if (e.defaultPrevented || disabled) return
        if (checked === undefined) setInner(!on)
        onCheckedChange?.(!on)
      }}
      className={cn(
        'peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[state=unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span
        data-slot="switch-thumb"
        data-state={state}
        className="bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0"
      />
    </button>
  )
}

export { Switch }
