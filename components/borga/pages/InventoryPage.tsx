'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { InventoryCatalogTab } from '../panels/InventoryCatalogTab';
import { InventoryStockTab } from '../panels/InventoryStockTab';
import { InventoryWarehousesTab } from '../panels/InventoryWarehousesTab';
import { PosTab } from '../panels/PosTab';

export function InventoryPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab ?? 'catalog');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        <TabsTrigger value="catalog">Catalog</TabsTrigger>
        <TabsTrigger value="stock">Stock & Costing</TabsTrigger>
        <TabsTrigger value="locations">Warehouses & Stores</TabsTrigger>
        <TabsTrigger value="pos">Point of Sale</TabsTrigger>
      </TabsList>
      <TabsContent value="catalog"><InventoryCatalogTab /></TabsContent>
      <TabsContent value="stock"><InventoryStockTab /></TabsContent>
      <TabsContent value="locations"><InventoryWarehousesTab /></TabsContent>
      <TabsContent value="pos"><PosTab /></TabsContent>
    </Tabs>
  );
}
