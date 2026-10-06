'use client';

import { useState } from 'react';
import { LogOut, ShieldOff } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/lib/toast-bus';
import { useBorga } from '@/lib/borga/store';

/** The signed-in person's menu: end this session, or every session (a lost laptop, a shared computer). */
export function UserMenu() {
  const userName = useBorga((s) => s.userName);
  const [busy, setBusy] = useState(false);
  const initials = (userName || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  const signOut = async (everywhere: boolean) => {
    setBusy(true);
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ everywhere }),
      });
      if (!res.ok) throw new Error('failed');
      window.location.href = '/login';
    } catch {
      setBusy(false);
      toast({ title: 'Could not sign out', description: 'Check your connection and try again.', variant: 'error' });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label="Account menu" className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary transition-colors hover:bg-primary/20">
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{userName || 'Signed in'}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={busy} onSelect={() => void signOut(false)}>
          <LogOut className="h-4 w-4" /> Sign out
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy} onSelect={() => void signOut(true)}>
          <ShieldOff className="h-4 w-4" /> Sign out on all devices
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
