'use client';

import { Component, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface Props {
  children: ReactNode;
  pageName: string;
}

interface State {
  error: Error | null;
}

/**
 * Isolates a runtime error to the current page's content area instead of
 * taking down the whole dashboard shell (sidebar/nav stay usable, and
 * switching pages — which remounts this via a fresh `key` — recovers on its
 * own). Without this, any uncaught error in one panel bubbled up to
 * app/app/error.tsx and replaced the entire app, losing navigation.
 */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    fetch('/api/diag', {
      method: 'POST',
      body: `boundary(page:${this.props.pageName}): ${error?.stack || error?.message || 'unknown'}\n${info.componentStack ?? ''}`,
      keepalive: true,
    }).catch(() => {});
  }

  render() {
    if (this.state.error) {
      return (
        <Card className="mx-auto max-w-xl border-red-500/30 bg-red-500/5 p-6 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
          <h2 className="mt-3 text-base font-semibold">The {this.props.pageName} page hit an error</h2>
          <p className="mt-1 text-sm text-muted-foreground">{this.state.error.message || 'Something went wrong rendering this page.'}</p>
          <p className="mt-1 text-xs text-muted-foreground">The rest of Borga is unaffected — switch pages from the sidebar or retry below.</p>
          <Button className="mt-4 gap-1.5" onClick={() => this.setState({ error: null })}>
            <RotateCcw className="h-3.5 w-3.5" /> Try again
          </Button>
        </Card>
      );
    }
    return this.props.children;
  }
}
