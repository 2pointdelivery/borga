'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBorga } from '@/lib/borga/store';
import { SectionTitle } from '../bits';
import type { ValuationMethod } from '@/lib/borga/data';

export function ValuationConfigEditor() {
  const { valuation, setValuation } = useBorga();
  const config = valuation ?? { baseline: undefined as any, methods: [] };

  const updateBaseline = (patch: Partial<typeof config.baseline>) =>
    setValuation({ ...config, baseline: { ...config.baseline, ...patch } });

  const updateMethod = (name: string, patch: Partial<ValuationMethod>) => {
    setValuation({
      ...config,
      methods: config.methods.map((m) => (m.name === name ? { ...m, ...patch } : m)),
    });
  };

  const addMethod = () => {
    setValuation({
      ...config,
      methods: [...config.methods, { name: 'New Method', weight: 10, value: 1, note: '' }],
    });
  };

  const removeMethod = (name: string) =>
    setValuation({ ...config, methods: config.methods.filter((m) => m.name !== name) });

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Valuation Configuration"
        sub="Edit baseline assumptions, method weights and market inputs. Changes affect all valuation calculations."
      />

      <Card className="p-4">
        <h4 className="text-sm font-medium mb-3">Baseline Facts (Fallback)</h4>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label>FMV ($M CAD)</Label>
            <Input
              type="number"
              step=".01"
              value={config.baseline?.fmv ?? 2.68}
              onChange={(e) => updateBaseline({ fmv: parseFloat(e.target.value) })}
            />
          </div>
          <div>
            <Label>Revenue ($M CAD)</Label>
            <Input
              type="number"
              step=".01"
              value={config.baseline?.revenue ?? 1.91}
              onChange={(e) => updateBaseline({ revenue: parseFloat(e.target.value) })}
            />
          </div>
          <div>
            <Label>Multiple (x)</Label>
            <Input
              type="number"
              step=".1"
              value={config.baseline?.multiple ?? 1.4}
              onChange={(e) => updateBaseline({ multiple: parseFloat(e.target.value) })}
            />
          </div>
          <div>
            <Label>EV ($M CAD)</Label>
            <Input
              type="number"
              step=".01"
              value={config.baseline?.ev ?? 2.84}
              onChange={(e) => updateBaseline({ ev: parseFloat(e.target.value) })}
            />
          </div>
          <div>
            <Label>Growth Pct</Label>
            <Input
              type="number"
              step="0.1"
              value={config.baseline?.growthPct ?? 40.7}
              onChange={(e) => updateBaseline({ growthPct: parseFloat(e.target.value) })}
            />
          </div>
          <div>
            <Label>Shares (M)</Label>
            <Input
              type="number"
              step="0.1"
              value={config.baseline?.sharesM ?? 9.9}
              onChange={(e) => updateBaseline({ sharesM: parseFloat(e.target.value) })}
            />
          </div>
          <div>
            <Label>Net Debt ($M)</Label>
            <Input
              type="number"
              step=".01"
              value={config.baseline?.netDebt ?? 0.16}
              onChange={(e) => updateBaseline({ netDebt: parseFloat(e.target.value) })}
            />
          </div>
          <div>
            <Label>Floor ($M)</Label>
            <Input
              type="number"
              step=".01"
              value={config.baseline?.floor ?? 1.2}
              onChange={(e) => updateBaseline({ floor: parseFloat(e.target.value) })}
            />
          </div>
          <div>
            <Label>Ceiling ($M)</Label>
            <Input
              type="number"
              step=".01"
              value={config.baseline?.ceiling ?? 6.1}
              onChange={(e) => updateBaseline({ ceiling: parseFloat(e.target.value) })}
            />
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium">Valuation Methods</h4>
          <Button onClick={addMethod} size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-1" /> Add
          </Button>
        </div>
        <div className="space-y-2">
          {config.methods?.map((m) => (
            <div key={m.name} className="grid gap-2 items-start sm:grid-cols-5">
              <Input
                value={m.name}
                onChange={(e) => updateMethod(m.name, { name: e.target.value })}
                className="sm:col-span-2"
                placeholder="Method name"
              />
              <Input
                type="number"
                step="1"
                value={m.weight}
                onChange={(e) => updateMethod(m.name, { weight: parseInt(e.target.value) })}
                className="w-16"
                placeholder="Weight %"
              />
              <Input
                type="number"
                step=".01"
                value={m.value}
                onChange={(e) => updateMethod(m.name, { value: parseFloat(e.target.value) })}
                className="w-20"
                placeholder="Value $M"
              />
              <Input
                value={m.note}
                onChange={(e) => updateMethod(m.name, { note: e.target.value })}
                className="sm:col-span-2"
                placeholder="Note"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => removeMethod(m.name)}
              >
                <Trash2 className="h-4 w-4 text-rose-500" />
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <h4 className="text-sm font-medium mb-1">Market Assumptions</h4>
        <p className="text-xs text-muted-foreground">
          No longer manually edited here — the Valuation page now derives sector, industry multiple band, growth
          proxy and peer margin live from the company&apos;s own Industry field (Companies tab) and its real
          valuation numbers, so they can&apos;t drift out of date. Change the industry there to update these.
        </p>
      </Card>
    </div>
  );
}