import { existsSync, readFileSync, writeFileSync } from "fs";

export class Settings {
  getAccountLogins(): AccountLogins {
    return JSON.parse(readFileSync("./data/Settings.json", "utf-8") || "{}");
  }

  getSalesEntries(): InternalDataEntry[] {
    const file = "./data/sales-data.json";

    // No file found
    if (!existsSync(file)) {
      return [];
    }

    const entries = JSON.parse(
      readFileSync(file, "utf-8")
    ) as InternalDataEntry[];

    for (const entry of entries) {
      // console.log(entry.itemName);
      entry.item = parseInt(entry.item.toString());
      entry.realMallPrice = parseInt((entry.realMallPrice ?? 0).toString());
      entry.realMafiaPrice = parseInt((entry.realMafiaPrice ?? 0).toString());
      entry.autosellPrice = parseInt((entry.autosellPrice ?? -1).toString());
      entry.lastTransactionPrice = parseInt(
        entry.lastTransactionPrice.toString()
      );
      entry.publicPrice = parseInt((entry.publicPrice ?? 0).toString());
      entry.lastSeenMall = parseInt(entry.lastSeenMall.toString());
      entry.lastSeenMafia = parseInt((entry.lastSeenMafia ?? 0).toString());
      entry.lastPriceChange = parseInt(entry.lastPriceChange.toString());
      entry.lastSalesTransactionId = parseInt(
        entry.lastSalesTransactionId.toString()
      );
      entry.nextPriceAdjustment = parseInt(
        entry.nextPriceAdjustment.toString()
      );
      entry.checkAfterSales = parseInt(
        (entry.checkAfterSales ?? "0").toString()
      );
      entry.decayAmount = parseInt((entry.decayAmount ?? "0").toString());
      entry.lastSeenMallLowest = parseInt(
        (entry.lastSeenMallLowest ?? "-2").toString()
      );
      entry.checkThis =
        entry.checkThis == null || entry.checkThis.toString() != "false";
    }

    return entries;
  }

  saveSalesEntries(entries: InternalDataEntry[]) {
    entries.sort((i1, i2) => i1.item - i2.item);

    writeFileSync("./data/sales-data.json", JSON.stringify(entries, null, 2));
  }
}

export type AccountLogins = {
  username: string;
  password: string;
};

export type InternalDataEntry = {
  itemName: string;
  item: number;
  autosellPrice: number; // What it autosells for
  realMallPrice: number; // Price it really is
  realMafiaPrice: number;
  lastTransactionPrice: number; // Price it really is
  publicPrice: number; // Price we publically claim this is
  lastSeenMall: number; // When we last checked this on kol itself
  lastSeenMafia: number; // When we last checked this on mafia itself
  lastSeenMallLowest: number; // The lowest price we saw in mall, debug purposes
  lastPriceChange: number; // Used to check how often we should check this item for price changes, this is only reset when the mall price changes or there's a sold item
  lastSalesTransactionId: number; // Used to prevent duplicate handling of sales data. This is always the most recent sales for this item
  nextPriceAdjustment: number; // Used to prevent publicPrice changing everytime the script is run
  checkAfterSales: number; // When this hits 0 or lower, we check
  decayAmount: number; // How much this decays by
  checkThis: boolean;
};

export type SalesDataEntry = {
  transaction: number;
  item: number;
  volume: number;
  cost: number;
  date: number;
};

export type PublicDataEntry = {
  item: number;
  price: number;
  age: number;
  volume: number;
};

export type KolItem = {
  id: number;
  name: string;
  descId: number;
  autosell: number;
};

export type BackOfficeEntry = {
  price: number;
  amount: number;
  limit: number;
};

export type NpcStoreItem = {
  store: string;
  storeId: string;
  item: string;
  price: number;
  row: string;
};
