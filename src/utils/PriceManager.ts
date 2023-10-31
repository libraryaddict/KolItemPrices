import { repriceDecay } from "../StorePricesManager";
import { BackOfficeEntry, InternalDataEntry } from "../Settings";
import { KoLClient } from "./KoLClient";
import { MafiaPrices } from "./MafiaPrices";
import { MallSales } from "./MallSales";
import { getRoundedNumber, now } from "./Utils";

class MafiaPriceFinder {
  backoffice: BackOfficeEntry[];
  mallSearch: BackOfficeEntry[];
  source: BackOfficeEntry[];
  account: KoLClient;
  item: InternalDataEntry;
  sourceType: "Back Office" | "Mall Search" = "Back Office";
  price: number = 999_999_999;

  constructor(
    item: InternalDataEntry,
    account: KoLClient,
    backoffice: BackOfficeEntry[]
  ) {
    this.account = account;
    this.item = item;
    this.backoffice = this.source = backoffice;
  }

  async useSearch() {
    this.mallSearch = await this.account.parseMallShops(this.item.itemName);
    this.source = this.mallSearch;
    this.sourceType = "Mall Search";
  }

  /**
   * Used to try get the same prices that mafia would see by using only backoffice
   */
  isPricingValid(): boolean {
    // False if we hit either 4 unlimited, or 3 limited. Without hitting the cap.
    // However we can continue to go beyond our cap ONLY if its the same price
    this.source.sort((i1, i2) => i1.price - i2.price);

    let timesSawLimitedStore = 0;
    let timesSawUnlimitedStore = 0;
    let purchasableItemsSeen = 0;
    let backofficeGaveEnoughData = true;

    for (const data of this.source) {
      if (
        this.price != data.price &&
        (timesSawLimitedStore >= 3 || timesSawUnlimitedStore >= 4)
      ) {
        // If the price changed and we can't trust back office to have given us a trusted price
        backofficeGaveEnoughData = false;
      }

      const viableCount = Math.min(
        data.amount,
        data.limit > 0 ? data.limit : 999
      );

      this.price = data.price;

      if (data.limit > 0) {
        timesSawLimitedStore++;
      } else {
        timesSawUnlimitedStore++;
      }

      purchasableItemsSeen += viableCount;

      if (purchasableItemsSeen >= 5) {
        break;
      }
    }

    if (this.sourceType == "Back Office") {
      return backofficeGaveEnoughData;
    }

    return true;
  }
}

export class PriceManager {
  hardcodedMeats: Map<number, number> = new Map();
  account: KoLClient;
  mafiaPrices: MafiaPrices;
  mallSales: MallSales;

  constructor(account: KoLClient, sales: MallSales, prices: MafiaPrices) {
    this.account = account;
    this.mallSales = sales;
    this.mafiaPrices = prices;

    this.hardcodedMeats.set(25, 10); // Meat Paste
    this.hardcodedMeats.set(88, 100); // Meat Stack
    this.hardcodedMeats.set(258, 1000); // Dense meat stack
  }

  updateOurPrices(data: InternalDataEntry[]) {
    let updatedPrices = 0;

    for (const item of data) {
      // If not ready to publically change the price
      if (
        item.nextPriceAdjustment < repriceDecay &&
        item.nextPriceAdjustment > now()
      ) {
        continue;
      }

      // The final price we will show off
      let finalPricePoint = item.realMallPrice;

      if (finalPricePoint > 100) {
        finalPricePoint = getRoundedNumber(item.realMallPrice);
      }

      // If the public price is the same price as mall
      if (item.publicPrice == finalPricePoint) {
        item.decayAmount = 0;
        continue;
      }

      // Next price adjustment will be in so and so time
      item.nextPriceAdjustment = repriceDecay;
      let newPrice = item.publicPrice;

      // If the old public price was mall max, or the new price is mall max
      if (
        newPrice < 0 ||
        finalPricePoint < 0 ||
        finalPricePoint >= 999_999_998 ||
        newPrice >= 999_999_998
      ) {
        newPrice = finalPricePoint;
      } else {
        // The decay amount will always be at least 100 meat, and 10% of the public price. If there's a decay amount already and its higher, that will be used.
        // The decay amount is reset when the repricing is finished.
        const decayChange = Math.max(
          item.decayAmount,
          Math.ceil(item.publicPrice * 0.1),
          100
        );
        item.decayAmount = decayChange;

        // Only price adjust if the item is not mall extinct, otherwise immediately flick it to mall extinct
        if (newPrice >= 0) {
          // If the previous public price is lower than what the real price is, add the decay
          if (newPrice < finalPricePoint) {
            newPrice = Math.min(newPrice + decayChange, finalPricePoint);
          } else {
            // Otherwise remove the decay, but we will always sink twice as fast in price than we add
            newPrice = Math.max(newPrice - decayChange * 2, finalPricePoint);
          }
        }
      }

      // Round the price we will present
      newPrice = getRoundedNumber(newPrice);
      item.publicPrice = newPrice;

      // If we've no more need to change the price, reset decay
      if (newPrice == finalPricePoint) {
        item.decayAmount = 0;
      }

      // If the price was changed, increment counter
      if (item.publicPrice != newPrice) {
        updatedPrices++;
      }
    }

    console.log("Now listing.. We have " + updatedPrices + " updated prices.");
  }

  async updateFromMall(toCheck: InternalDataEntry[]) {
    let lastPrinted = 0;
    let checked = 0;

    for (const check of toCheck) {
      checked++;
      // Every 20s
      if (Date.now() - lastPrinted > 20 * 1000) {
        lastPrinted = Date.now();
        console.log("Checked " + checked + "/" + toCheck.length);
      }

      let backofficeData: BackOfficeEntry[];

      // If using hardcoded, then ignore mall
      if (this.hardcodedMeats.get(check.item) != null) {
        backofficeData = [
          {
            amount: 999_999_999,
            price: this.hardcodedMeats.get(check.item),
            limit: 0
          }
        ];
      } else {
        // If its an npc purchased item, dont bother fetching from mall. We're assuming this item is still obtainable
        const npcPrice = this.mallSales.mafiaItems.getNpcPrice(check);

        if (npcPrice != null) {
          backofficeData = [
            {
              amount: 999_999_999,
              price: npcPrice,
              limit: 0
            }
          ];
        } else {
          // Get the prices from back office
          backofficeData = await this.account.getBackoffice(check.item);
        }
      }

      let amountPurchasedInPeriod = 0;
      let totalMeatSpentInPeriod = 0;
      // This isn't very good tbh, need to look at this again
      let purchaseCountInPeriod = 0;

      for (const s of this.mallSales.sales) {
        if (s.item != check.item) {
          continue;
        }

        amountPurchasedInPeriod += s.volume;
        totalMeatSpentInPeriod += s.cost;
        purchaseCountInPeriod++;
      }

      const atMostPrice = Math.floor(
        totalMeatSpentInPeriod / purchaseCountInPeriod
      );
      let atLeastCount = Math.floor(amountPurchasedInPeriod / 14);

      // Sort prices from lowest to highest
      backofficeData.sort((d1, d2) => {
        return d1.price - d2.price;
      });

      // Save the lowest price we've last seen in mall
      check.lastSeenMallLowest =
        backofficeData.length > 0 ? backofficeData[0].price : -1;

      // Move to another function?
      // If this has no hardcoded value, then go ahead
      // This block of code was intended for use to update mafia's historical prices
      if (this.hardcodedMeats.get(check.item) == null) {
        const priceCheck = new MafiaPriceFinder(
          check,
          this.account,
          backofficeData
        );
        const priceData = this.mafiaPrices.getPrice(check.item);

        if (
          priceData != null &&
          priceData.price >= Math.max(100, check.autosellPrice * 2)
        ) {
          if (!priceCheck.isPricingValid()) {
            await priceCheck.useSearch();
          }

          if (!priceCheck.isPricingValid()) {
            console.log("Failed to find price for " + check.itemName);
          } else {
            // check.autosellPrice * 2 < fifthLowestPrice

            if (priceData == null) {
              console.log("Uh, null on " + check.item + " - " + check.itemName);
            } else {
              const fifthLowest = priceCheck.price;

              if (priceData.price != fifthLowest) {
                this.mafiaPrices.updatePrice(
                  check.item,
                  now(),
                  fifthLowest,
                  backofficeData
                );
              }
            }
          }
        }
      }

      // The price we will be telling everyone
      let newPrice = -1;

      for (const data of backofficeData) {
        // If we've seen at least one price, and this entry has a pricepoint too high
        if (newPrice > 0 && data.price > atMostPrice) {
          break;
        }

        // Change the price we present
        newPrice = data.price;

        // Decay the count
        atLeastCount -= data.amount;

        if (atLeastCount <= 0) {
          break;
        }

        // Not sure what's the point of this given the first function but hey!
        if (atMostPrice <= data.price) {
          break;
        }
      }

      // Log that the price has changed
      if (newPrice != check.realMallPrice) {
        check.lastPriceChange = now();
      }

      // What the price we want to present will be
      check.realMallPrice = newPrice;
      // When we last invoked this functions
      check.lastSeenMall = now();

      // Find all entries that are at most, 120% of our new price point
      const similarPrices = backofficeData.filter(
        (d) => newPrice / d.price >= 0.8
      );

      // Sort them by counts
      similarPrices.sort((d1, d2) => d2.amount - d1.amount);

      // The total amount that are at this similar price point
      const totalAmount = similarPrices
        .map((d) => d.amount)
        .reduce((d1, d2) => d1 + d2, 0);

      // Check after that many have sold, if there's only one store in mall then it's concerning and we'll need to check again for sure
      // TODO Probably need to change this
      check.checkAfterSales =
        similarPrices.length < 2 ? 1 : totalAmount - similarPrices[0].amount;
    }

    console.log("Finished checking..");
  }

  createMafiaPrices() {
    // TODO Create prices for mafia's historical data
  }
}
