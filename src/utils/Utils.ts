import { decode, encode } from "html-entities";
import { KOLMessage, PublicMessageType } from "./Typings";
import {
  KolItem,
  NpcStoreItem,
  PublicDataEntry,
  SalesDataEntry
} from "../Settings";
import axios from "axios";
import { spawn } from "child_process";
import { readFileSync, writeFileSync } from "fs";

/**
 * Start KoL's special encoding
 */
const SAFECHARS =
  "0123456789" + // Numeric
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ" + // Alphabetic
  "abcdefghijklmnopqrstuvwxyz" +
  "-_.!~*'()"; // RFC2396 Mark characters
const HEX = "0123456789ABCDEF";
export function encodeToKolEncoding(x: string): string {
  // The Javascript escape and unescape functions do not correspond
  // with what browsers actually do...

  const plaintext = x;
  let encoded = "";
  for (let i = 0; i < plaintext.length; i++) {
    const ch = plaintext.charAt(i);
    if (ch == "+") {
      encoded += "%2B";
    } else if (ch == " ") {
      encoded += "+"; // x-www-urlencoded, rather than %20
    } else if (SAFECHARS.indexOf(ch) != -1) {
      encoded += ch;
    } else {
      const charCode = ch.charCodeAt(0);
      if (charCode > 255) {
        /*  console.log(
          "Unicode Character '" +
            ch +
            "' cannot be encoded using standard URL encoding.\n" +
            "(URL encoding only supports 8-bit characters.)\n" +
            "A space will be substituted."
        );*/
        // Replace invalid chars with a question mark
        encoded += "%3F";
      } else {
        encoded += "%";
        encoded += HEX.charAt((charCode >> 4) & 0xf);
        encoded += HEX.charAt(charCode & 0xf);
      }
    }
  } // for

  return encoded;
}

export function humanReadableTime(seconds: number): string {
  return `${Math.floor(seconds / 3600)}:${Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

export function stripHtml(message: string): string {
  let match: string[] | null;

  while (
    (match = message.match(
      /(?:<[^>]+? title="([^">]*)">.+?<\/[^>]*>)|(?:<(.|\n)*?>)/
    )) != null
  ) {
    message = message.replace(match[0], match[1] || "");
  }

  return message;
}

/**
 * Used to split a message to fit into KOL's message limits
 *
 * 260 is the rough limit, but given it injects spaces in 20+ long words. Lower that to 245
 */
export function splitMessage(message: string, limit: number = 245): string[] {
  // TODO Try to honor spaces
  let encodedRemainder = encode(message);
  const messages: string[] = [];

  if (encodedRemainder.length > limit) {
    let end = limit;
    let toSnip: string;

    // Make sure we don't leave html entities out
    while (
      !message.includes(
        (toSnip = decode(encodedRemainder.substring(0, end)))
      ) ||
      !message.includes(decode(encodedRemainder.substring(end)))
    ) {
      end--;
    }

    encodedRemainder = encodedRemainder.substring(end);
    messages.push(toSnip);
  }

  messages.push(decode(encodedRemainder));

  return messages;
}

export function isModMessage(message: KOLMessage): boolean {
  return (
    message.who != null &&
    (message.who.name === "Mod Announcement" ||
      message.who?.name === "Mod Warning")
  );
}

export function isEventMessage(message: KOLMessage): boolean {
  return message.type === "event";
}

export function isPrivateMessage(message: KOLMessage): boolean {
  return message.type === "private";
}

export function isSystemMessage(message: KOLMessage): boolean {
  return message.type === "system";
}

export function isPublicMessage(message: KOLMessage): boolean {
  return message.type === "public";
}

export function getPublicMessageType(
  message: KOLMessage
): PublicMessageType | undefined {
  if (message.type != "public") {
    return undefined;
  }

  if (message.format == "0") {
    return "normal";
  } else if (message.format == "1") {
    return "emote";
  } else if (message.format == "2") {
    return "system";
  } else if (message.format == "3") {
    return "mod warning";
  } else if (message.format == "4") {
    return "mod announcement";
  } else if (message.format == "98") {
    return "event";
  } else if (message.format == "99") {
    return "welcome";
  }

  return undefined;
}

export function getNpcStores(): NpcStoreItem[] {
  const data = readFileSync("./data/npc_stores.txt").toString();
  const items: NpcStoreItem[] = [];

  for (const line of data.split(/[\n\r]+/)) {
    const spl = line.split("\t");

    if (spl.length != 5 || line.trim().startsWith("#")) {
      continue;
    }

    const store = spl[0];
    const storeId = spl[1];
    const item = spl[2];
    const price = parseInt(spl[3]);
    const row = spl[4];

    items.push({
      store,
      storeId,
      item,
      price,
      row
    });
  }

  return items;
}

async function updateNpcStores(): Promise<void> {
  const page = (
    await axios(
      `https://raw.githubusercontent.com/kolmafia/kolmafia/main/src/data/npcstores.txt`,
      {
        method: "GET",
        maxRedirects: 0,
        validateStatus: (status) => status === 200
      }
    )
  ).data as string;

  writeFileSync("./data/npc_stores.txt", page);
}

export async function getItems(): Promise<KolItem[]> {
  await updateNpcStores();

  const page = (
    await axios(
      `https://raw.githubusercontent.com/kolmafia/kolmafia/main/src/data/items.txt`,
      {
        method: "GET",
        maxRedirects: 0,
        validateStatus: (status) => status === 200
      }
    )
  ).data as string;

  const items: KolItem[] = [];

  for (const match of page.matchAll(
    /^(\d+)\t(.*?)\t(\d+)\t.*?\t.*?\t(.*?)\t(\d+)/gm
  )) {
    const itemId = parseInt(match[1]);
    const itemName = match[2];
    const itemDesc = parseInt(match[3]);
    const itemFlags: string[] = match[4].split(",").filter((s) => s.length > 0);
    const autosell = parseInt(match[5]);

    // If not tradeable
    if (itemFlags.includes("q") || !itemFlags.includes("t")) {
      continue;
    }

    items.push({
      id: itemId,
      descId: itemDesc,
      name: itemName,
      autosell: autosell
    });
  }

  return items;
}

export async function getSales(days: number = 3): Promise<SalesDataEntry[]> {
  const upTo = Math.round(Date.now() / 1000);
  const from = upTo - days * 60 * 60 * 24;

  const csv = (
    await axios(
      `https://kol.coldfront.net/newmarket/export_csv.php?start=${from}&end=${upTo}&itemid=`,
      {
        method: "GET",
        maxRedirects: 0,
        validateStatus: (status) => status === 200
      }
    )
  ).data;

  const matches = csv.matchAll(/^(\d+),(\d+),(\d+),([\d.]+),(\d+)$/gm);
  const sales: SalesDataEntry[] = [];

  for (const match of matches) {
    const transId = parseInt(match[1]);
    const itemId = parseInt(match[2]);
    const volume = parseInt(match[3]);
    const cost = Math.round(parseFloat(match[4])); // Cost each I believe, not total
    const timestamp = parseInt(match[5]);

    sales.push({
      transaction: transId,
      item: itemId,
      volume: volume,
      cost: cost,
      date: timestamp
    });
  }

  return sales;
}

export async function savePublicFile(data: PublicDataEntry[]) {
  data.sort((d1, d2) => d1.item - d2.item);

  let time = Date.now() / 1000;
  time = time / (60 * 60);
  time = Math.floor(time) * 60 * 60;

  const file = "./git-repo/data/irrats_item_prices.txt";
  const dataString = data
    .map((d) => `${d.item}\t${d.age}\t${d.price}\t${d.volume}`)
    .join("\n");
  const prefixes = [
    `Last Updated:\t${time}`,
    "",
    "# This is a list of item prices maintained by Irrat and updated via github",
    "# The prices contained in this are not identical to the ones in game, but are roughly equal. This is meant to tell you what items are worth, not what you can sell them for",
    "# The difference can be said as, if you sold using the prices in here, you shouldn't expect to be making a profit vs selling them by hand.",
    "# The prices provided in here do not respect well_stocked, do not respect limits and do not understand when someone is selling at a loss.",
    "# The prices listed are meant for informational purposes with the `accountval` script. It isn't intended to be usable for maximizing profits",
    "",
    "# Item ID\tLast Checked\tPrice\tSold in last week",
    ""
  ];
  writeFileSync(file, prefixes.join("\n") + dataString);
  const commands = [
    "cd git-repo",
    "git add --all",
    'git commit -m "Update Prices"',
    "git push"
  ].join(" && ");

  const sp = spawn(commands, [], {
    shell: true
  });
  sp.stdout.on("data", (data) => {
    console.log(`spawn stdout: "${data}"`);
  });

  sp.stderr.on("data", (data) => {
    console.log(`spawn stderr: "${data}"`);
  });

  sp.on("error", (code) => {
    console.log(`spawn error: "${code}"`);
  });

  sp.on("close", (code) => {
    console.log(`spawn child process closed with code ${code}`);
  });

  sp.on("exit", (code) => {
    console.log(`spawn child process exited with code ${code}`);
  });
}

export function getRoundedNumber(
  num: number,
  keepFirstDigits: number = 2
): number {
  if (num <= 0) {
    return num;
  }

  num = Math.round(num);
  const str = num.toString().split("");

  if (str.length <= keepFirstDigits) {
    return num;
  }

  let firstPart = num.toString().substring(0, keepFirstDigits);

  // We encourage lower numbers
  if (parseInt(str[keepFirstDigits]) > 6) {
    firstPart = (parseInt(firstPart) + 1).toString();
  }

  for (let i = keepFirstDigits; i < str.length; i++) {
    firstPart += "0";
  }

  return Math.min(parseInt(firstPart), 999_999_999);
}

export function now() {
  return Math.round(Date.now() / 1000);
}
