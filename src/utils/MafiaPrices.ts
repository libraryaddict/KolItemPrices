import axios from "axios";
import { writeFileSync } from "fs";
import { BackOfficeEntry } from "../Settings";

interface UpdatedPrice {
  price: number;
  date: number;
}

export class MafiaPrices {
  internalPrices: string;
  updatedPrices: UpdatedPrice[] = [];
  loadedPrices: UpdatedPrice[];
  notes: string[] = [];
  dateUsed: string = Date.now().toString();
  outdated = false;

  async loadPrices(): Promise<string> {
    if (this.internalPrices == null) {
      this.internalPrices = (
        await axios(
          `https://kolmafia.us/scripts/updateprices.php?action=getmap`,
          {
            method: "GET",
            maxRedirects: 0,
            validateStatus: (status) => status === 200
          }
        )
      ).data;

      writeFileSync("./mafia/" + this.dateUsed + ".txt", this.internalPrices);
    }

    return this.internalPrices;
  }

  async updatePrices() {
    const split = (await this.loadPrices()).split(/[\r\n]+/);

    this.outdated = split[0] != "983253";

    const firstLoad = this.loadedPrices == null;

    if (firstLoad) {
      this.loadedPrices = [];
    }

    if (this.outdated) {
      console.log(
        "Outdated! Version is '" +
          split[0] +
          "' which is " +
          split[0].length +
          " long"
      );
      return;
    }

    for (let i = 0; i < split.length; i++) {
      const priceMatch = split[i].match(/^(\d+)\t(\d+)\t(\d+)$/);

      if (priceMatch == null) {
        continue;
      }

      const num = parseInt(priceMatch[1]);

      if (firstLoad) {
        this.loadedPrices[num] = {
          date: parseInt(priceMatch[2]),
          price: parseInt(priceMatch[3])
        };
      }

      const update = this.updatedPrices[num];

      if (update == null) {
        continue;
      }

      split[i] = `${num}\t${update.date}\t${update.price}`;
    }

    this.internalPrices = split.join("\n");
  }

  async uploadPrices() {
    await this.updatePrices();

    if (this.outdated) {
      return;
    }

    writeFileSync(
      "./mafia/" + this.dateUsed + "_updated.txt",
      this.internalPrices
    );

    let noteString = "";

    for (let i = 0; i <= this.notes.length; i++) {
      if (this.notes[i] == null) {
        continue;
      }

      noteString += i + "\t" + this.notes[i];
      noteString += "\n";
    }

    writeFileSync("./mafia/" + this.dateUsed + "_notes.txt", noteString);

    const data = this.getPostData(this.internalPrices + "\n");

    /* await axios(`https://kolmafia.us/scripts/updateprices.php`, {
      method: "POST",
      data: Buffer.from(data),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/118.0 Irrat (#3469406) Price Updater",
        "Content-Type": "multipart/form-data; boundary=--blahblahfishcakes"
      },
      maxRedirects: 0,
      validateStatus: (status) => status === 200
    });*/
  }

  getPostData(data: string): string {
    let builder = "";
    builder += "----blahblahfishcakes\r\n";
    builder +=
      'Content-Disposition: form-data; name="upload"; filename="mallprices.txt"\r\n\r\n';
    builder += data;

    builder += "\r\n----blahblahfishcakes--\r\n";
    return builder;
  }

  updatePrice(
    item: number,
    date: number,
    price: number,
    data: BackOfficeEntry[]
  ) {
    this.updatedPrices[item] = { price, date };
    this.notes[item] = JSON.stringify(data);
  }

  getPrice(item: number): UpdatedPrice {
    return this.loadedPrices[item];
  }
}
