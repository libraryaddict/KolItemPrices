import {
  InternalDataEntry,
  KolItem,
  NpcStoreItem,
  SalesDataEntry
} from "../Settings";
import { getItems, getNpcStores } from "./Utils";

export class MafiaItems {
  mafiaItems: KolItem[] = [];
  internal: InternalDataEntry[];
  stores: NpcStoreItem[];

  constructor(items: InternalDataEntry[]) {
    this.internal = items;
  }

  async getItem(itemId: number) {
    if (this.mafiaItems.length == 0) {
      this.mafiaItems.push(...(await getItems()));
      console.log(
        "Loaded and found " + this.mafiaItems.length + " mafia items"
      );
    }

    const kolItem = this.mafiaItems.find((i) => i.id == itemId);

    if (kolItem == null) {
      console.log("Failed to find the item: " + itemId);
      return null;
    }

    return kolItem;
  }

  getNpcPrice(item: InternalDataEntry): number | null {
    if (this.stores == null) {
      this.stores = getNpcStores();
    }

    const items = this.stores.filter(
      (i) => i.item == item.itemName && !this.isIgnoredStore(i.store)
    );

    if (items.length == 0) {
      return null;
    }

    const lowest = items
      .map((i) => i.price)
      .reduce((l, r) => Math.min(l, r), items[0].price);

    return Math.ceil(lowest * 0.9);
  }

  isIgnoredStore(storeName: string) {
    storeName = storeName.toLowerCase();

    return (
      storeName.includes("fdkol") ||
      storeName.includes("crimbo") ||
      storeName.includes("the black and white and red") ||
      storeName.includes("ornament stan")
    );
  }

  async createItem(sale: SalesDataEntry) {
    const kolItem = await this.getItem(sale.item);

    if (kolItem == null) {
      return null;
    }

    const item = {
      itemName: kolItem.name,
      item: kolItem.id,
      autosellPrice: kolItem.autosell,
      realMallPrice: sale.cost,
      realMafiaPrice: 0,
      publicPrice: sale.cost,
      lastTransactionPrice: sale.cost,
      lastSalesTransactionId: sale.transaction,
      lastSeenMall: 0,
      lastSeenMafia: 0,
      lastPriceChange: sale.date,
      nextPriceAdjustment: 0,
      checkAfterSales: 0,
      decayAmount: 0,
      lastSeenMallLowest: 0,
      checkThis: true
    };

    return item;
  }
}
