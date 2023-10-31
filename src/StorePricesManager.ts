import { InternalDataEntry, PublicDataEntry, Settings } from "./Settings";
import { ItemCheckups } from "./utils/ItemCheckups";

import { KoLClient } from "./utils/KoLClient";
import { MafiaItems } from "./utils/MafiaItems";
import { MafiaPrices } from "./utils/MafiaPrices";
import { MallSales } from "./utils/MallSales";
import { PriceManager } from "./utils/PriceManager";
import { now, savePublicFile } from "./utils/Utils";

export const repriceDecay = now() + 10 * 60 * 60;

export class StorePricesManager {
  account: KoLClient;
  settings: Settings;
  mafiaItems: MafiaItems;
  mafiaPrices: MafiaPrices = new MafiaPrices();
  mallSales: MallSales;

  async runProgram() {
    this.settings = new Settings();

    const login = this.settings.getAccountLogins();
    this.account = new KoLClient(login.username, login.password);

    await this.account.start();

    const internal = this.settings.getSalesEntries();
    this.mafiaItems = new MafiaItems(internal);
    this.mallSales = new MallSales(this.mafiaItems);
    this.mallSales.addNewSales();

    await this.mafiaPrices.updatePrices();

    const check = new ItemCheckups(
      this.mafiaPrices,
      this.mafiaItems,
      this.mallSales
    );
    const toCheck: InternalDataEntry[] = await check.doCheckups(internal);

    // TODO Sort the items by a score that weighs different factors so that "rare" items are barely looked up, and the same applies to items that are stupidly cheap
    // TODO Skip over items that are a waste of cpu to check

    console.log("Need to check " + toCheck.length + " items");

    const prices = new PriceManager(
      this.account,
      this.mallSales,
      this.mafiaPrices
    );

    await prices.updateFromMall(toCheck);
    prices.updateOurPrices(internal);

    const exportedPrices: PublicDataEntry[] = [];

    for (const item of internal) {
      const sales = this.mallSales
        .getItemSales(item.item, 7)
        .map((s) => s.volume);

      const volume = sales.reduce((l, r) => l + r, 0);

      exportedPrices.push({
        item: item.item,
        age: item.lastSeenMall,
        price: item.publicPrice,
        volume: volume
      });
    }

    this.settings.saveSalesEntries(internal);

    // Push updated prices to mafia, currently defunct as the risk of uploading bad prices was deemed too high
    // Atm, it just creates debugging files
    await this.mafiaPrices.uploadPrices();

    await savePublicFile(exportedPrices);
  }
}
