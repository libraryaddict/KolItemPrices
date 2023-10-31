import { existsSync, readFileSync, writeFileSync } from "fs";
import { SalesDataEntry } from "../Settings";
import { MafiaItems } from "./MafiaItems";
import { getSales, now } from "./Utils";

const salesFile = "./data/sales-history.json";

export class MallSales {
  mafiaItems: MafiaItems;
  sales: SalesDataEntry[];
  savedSales: SalesDataEntry[] = [];

  constructor(mafiaItems: MafiaItems) {
    this.mafiaItems = mafiaItems;

    this.loadSales();
    this.sortSales();
  }

  sortSales() {
    this.savedSales.sort((s1, s2) => {
      return s1.transaction - s2.transaction;
    });
  }

  async addNewSales() {
    const oldestSale = this.savedSales[this.savedSales.length - 1];
    let oldestKnownSale = now() - 31 * 24 * 60 * 60;

    if (oldestSale != null && oldestSale.date > oldestKnownSale) {
      oldestKnownSale = oldestSale.date;
    }

    const days = Math.ceil(oldestKnownSale / (24 * 60 * 60));

    const sales = await getSales(days);
    this.addSales(sales);
  }

  addSales(sales: SalesDataEntry[]) {
    for (const sale of sales) {
      if (this.savedSales.some((s) => s.transaction == sale.transaction)) {
        continue;
      }

      this.savedSales.push(sale);
    }

    this.savedSales.sort((s1, s2) => {
      return s1.transaction - s2.transaction;
    });

    this.sortSales();
    this.saveSales();
  }

  loadSales() {
    if (!existsSync(salesFile)) {
      return;
    }

    const data = JSON.parse(
      readFileSync(salesFile, "utf-8")
    ) as SalesDataEntry[];

    for (const sale of data) {
      this.savedSales.push({
        transaction: parseInt(sale.transaction.toString()),
        item: parseInt(sale.item.toString()),
        volume: parseInt(sale.volume.toString()),
        cost: parseInt(sale.cost.toString()),
        date: parseInt(sale.date.toString())
      });
    }
  }

  saveSales() {
    writeFileSync(salesFile, JSON.stringify(this.savedSales, null), "utf-8");
  }

  trimSales(days: number) {
    const recent = this.savedSales[this.savedSales.length - 1].date;
    const cutoff = recent - days * 24 * 60 * 60;

    while (this.savedSales.length > 0 && this.savedSales[0].date < cutoff) {
      this.savedSales.shift();
    }
  }

  getItemSales(item: number, days: number): SalesDataEntry[] {
    const cutoff = now() - days * 24 * 60 * 60;
    return this.savedSales.filter((s) => s.item == item && s.date >= cutoff);
  }
}
