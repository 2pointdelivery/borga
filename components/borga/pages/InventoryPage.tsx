'use client';

import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { InventoryCatalogTab } from '../panels/InventoryCatalogTab';
import { InventoryStockTab } from '../panels/InventoryStockTab';
import { InventoryWarehousesTab } from '../panels/InventoryWarehousesTab';
import { PosTab } from '../panels/PosTab';
import { ProcurementTab } from '../panels/ProcurementTab';
import { useFeature } from '@/lib/borga/features-client';

export function InventoryPage({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState(initialTab ?? 'catalog');
  const procurement = useFeature('procurement');
  return (
    <Tabs value={tab} onValueChange={setTab} className="borga-fade-up">
      <TabsList>
        <TabsTrigger value="catalog">Catalog</TabsTrigger>
        <TabsTrigger value="stock">Stock & Costing</TabsTrigger>
        <TabsTrigger value="locations">Warehouses & Stores</TabsTrigger>
        <TabsTrigger value="pos">Point of Sale</TabsTrigger>
        {procurement && <TabsTrigger value="orders">Purchase Orders</TabsTrigger>}
      </TabsList>
      <TabsContent value="catalog"><InventoryCatalogTab /></TabsContent>
      <TabsContent value="stock"><InventoryStockTab /></TabsContent>
      <TabsContent value="locations"><InventoryWarehousesTab /></TabsContent>
      <TabsContent value="pos"><PosTab /></TabsContent>
      {procurement && <TabsContent value="orders"><ProcurementTab /></TabsContent>}
    </Tabs>
  );
}
