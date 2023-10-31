import { repriceDecay } from "../StorePricesManager";
import { InternalDataEntry } from "../Settings";
import { MafiaItems } from "./MafiaItems";
import { MafiaPrices } from "./MafiaPrices";
import { MallSales } from "./MallSales";
import { getRoundedNumber, now } from "./Utils";

export class ItemCheckups {
  mafiaPrices: MafiaPrices;
  mafiaItems: MafiaItems;
  mallSales: MallSales;
  reasons: Map<string, number> = new Map();

  constructor(prices: MafiaPrices, items: MafiaItems, sales: MallSales) {
    this.mafiaItems = items;
    this.mafiaPrices = prices;
    this.mallSales = sales;
  }

  addReason(reason: string) {
    this.reasons.set(reason, (this.reasons.get(reason) ?? 0) + 1);
  }

  async doCheckups(data: InternalDataEntry[]): Promise<InternalDataEntry[]> {
    // Update data
    for (const i of data) {
      if (i.itemName == null) {
        const item = await this.mafiaItems.getItem(i.item);

        if (item == null) {
          console.log("Unable to find item " + i.item);
        } else {
          i.itemName = item.name;
        }
      }

      if (i.autosellPrice < 0) {
        const item = await this.mafiaItems.getItem(i.item);

        if (item == null) {
          console.log("Unable to find item " + i.item);
        } else {
          i.autosellPrice = item.autosell;
        }
      }

      if ((i.lastSeenMafia ?? 0) == 0) {
        const mafiaPrice = this.mafiaPrices.getPrice(i.item);

        if (mafiaPrice != null) {
          i.realMafiaPrice = mafiaPrice.price;
          i.lastSeenMafia = mafiaPrice.date;
        }
      }
    }

    const toCheck: InternalDataEntry[] = [];

    for (const sale of this.mallSales.sales) {
      let item = data.find((i) => i.item == sale.item);

      // If its a new item
      if (item == null) {
        item = await this.mafiaItems.createItem(sale);

        if (item == null) {
          continue;
        }

        data.push(item);
        toCheck.push(item);
        this.addReason("New Item");
        continue;
      }

      if (item.itemName == null) {
        // Legacy code for updating
        item.itemName = (await this.mafiaItems.createItem(sale))?.itemName;
      }

      // If we've seen this transaction
      if (item.lastSalesTransactionId >= sale.transaction) {
        continue;
      }

      // Update last seen transaction
      item.lastSalesTransactionId = sale.transaction;
      item.lastTransactionPrice = sale.cost;
      // Decrement the check
      item.checkAfterSales -= sale.volume;

      // If there's a major sink in price
      if (
        !toCheck.includes(item) &&
        sale.cost * 10 <
          (item.realMallPrice < 0 ? 999_999_999 : item.realMallPrice)
      ) {
        toCheck.push(item);
        this.addReason("Major Sale Difference");
        continue;
      }

      // If the next price adjustment isn't here yet
      if (item.nextPriceAdjustment > now()) {
        continue;
      }

      // If there's only a minor price difference between mall and what it sold for
      if (
        getRoundedNumber(item.realMallPrice) == getRoundedNumber(sale.cost) ||
        Math.abs(item.realMallPrice - sale.cost) < 400
      ) {
        continue;
      }

      this.addReason("Major Cost Difference");
      toCheck.push(item);
    }

    const monthAgo = now() - 60 * 60 * 24 * 30;

    // Sort to show the older prices first
    data.sort((i1, i2) => i1.lastSeenMall - i2.lastSeenMall);

    // If public price is weird, there was an issue in our data. Redo.
    data.forEach((i) => {
      if (toCheck.includes(i)) {
        return;
      }

      if (i.publicPrice != 0) {
        return;
      }

      toCheck.push(i);
      this.addReason("Public price was wrong");
    });

    data.forEach(async (i) => {
      // Get the rounded public price even if we don't update, incase of an issue
      i.publicPrice = getRoundedNumber(i.publicPrice);

      // If we're already checking this, or it isn't ready to be adjusted
      if (toCheck.includes(i) || i.nextPriceAdjustment > now()) {
        return;
      }

      // How many days since we last checked this
      const daysOld = (now() - i.lastSeenMall) / (24 * 60 * 60);

      // if its been 2 days and sales hit 0
      if (i.checkAfterSales <= 0 && daysOld >= 2 && toCheck.length < 1500) {
        this.addReason("Sales Hit Zero in Check 2");
        toCheck.push(i);
        return;
      }

      // If the item is mall extinct, check only every 30 days
      // Otherwise check every 15 days
      if (
        i.lastSeenMall + (i.realMallPrice > 0 ? monthAgo / 2 : 0) < monthAgo &&
        toCheck.length < 1500
      ) {
        this.addReason("Outdated Entry");
        toCheck.push(i);
        return;
      }
    });

    // We do this seperately so it doesn't contribute to the 1.5k cap
    data.forEach((i) => {
      if (toCheck.includes(i)) {
        return;
      }

      // This is another error catch where if a price adjustment time is far out of whack, it'll be ignored
      if (
        i.nextPriceAdjustment < repriceDecay &&
        i.nextPriceAdjustment > now()
      ) {
        return;
      }

      // How much meat the decay amount is worth
      // If the decay amount is more than 0, then it has a price adjustment due
      if (i.decayAmount > 0) {
        this.addReason("Is Repricing");
        toCheck.push(i);
        return;
      }
    });

    data.forEach((i) => {
      // ignore items that are not ready to public price
      if (toCheck.includes(i) || i.nextPriceAdjustment > now()) {
        return;
      }

      // Get the prices from mafia
      const price = this.mafiaPrices.getPrice(i.item);

      // If price wasn't used, or its not as good as ours, or its the same price as ours, or if its at lowest
      if (
        price == null ||
        price.date < i.lastSeenMall ||
        price.price == i.realMafiaPrice ||
        i.autosellPrice * 2 >= price.price // Autosell price
      ) {
        return;
      }

      this.addReason("Mafia says cheaper");
      toCheck.push(i);
    });

    // For when I manually flagged it
    data.forEach((i) => {
      if (toCheck.includes(i)) {
        return;
      }

      if (i.checkThis != null && i.checkThis == false) {
        return;
      }

      toCheck.push(i);
      this.addReason("Flag of 'Check This' was set");
    });

    // Update what mafia said it was
    data.forEach((i) => {
      const mafiaPrice = this.mafiaPrices.getPrice(i.item);

      if (mafiaPrice != null) {
        i.realMafiaPrice = mafiaPrice.price;
        i.lastSeenMafia = mafiaPrice.date;
      }
    });

    // Reset all 'Check This' flags, including if field is missing
    toCheck.forEach((i) => {
      i.checkThis = false;
    });

    console.log();
    console.log("Reasons..");

    for (const [reason, count] of this.reasons) {
      console.log(`> Reason: ${reason}, ${count} times`);
    }

    console.log();

    return toCheck;
  }
}
