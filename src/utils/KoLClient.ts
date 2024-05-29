import axios from "axios";
import { Agent as httpsAgent } from "https";
import { Agent as httpAgent } from "http";
import { KOLCredentials, KoLUser, ShopItem } from "./Typings";

import { Mutex } from "async-mutex";
import { BackOfficeEntry } from "../Settings";

axios.defaults.timeout = 30000;
axios.defaults.httpAgent = new httpAgent({ keepAlive: true });
axios.defaults.httpsAgent = new httpsAgent({ keepAlive: true });

export class KoLClient {
  private _loginParameters;
  private _credentials?: KOLCredentials;
  private _player?: KoLUser;
  private _isRollover: boolean = false;
  private mutex = new Mutex();

  constructor(username: string, password: string) {
    this._player = { name: username, id: "" };

    this._loginParameters = new URLSearchParams();
    this._loginParameters.append("loggingin", "Yup.");
    this._loginParameters.append("loginname", username + "/q");
    this._loginParameters.append("password", password);
    this._loginParameters.append("secure", "0");
    this._loginParameters.append("submitbutton", "Log In");
  }

  getUsername() {
    return this._player?.name;
  }

  getUserID() {
    return this._player?.id;
  }

  async relog() {
    this._credentials = undefined;

    return this.logIn();
  }

  async loggedIn(): Promise<boolean> {
    if (!this._credentials || this._isRollover) {
      return false;
    }

    try {
      const apiResponse = await axios(
        "https://www.kingdomofloathing.com/api.php",
        {
          maxRedirects: 0,
          withCredentials: true,
          headers: {
            cookie: this._credentials?.sessionCookies || ""
          },
          params: {
            what: "status",
            for: "DiscordChat (Maintained by Irrat)"
          },
          validateStatus: (status) => status === 302 || status === 200
        }
      );

      if (apiResponse.status === 200) {
        return true;
      }

      return false;
    } catch (e) {
      console.log("Login check failed, returning false to be safe.", e);
      return false;
    }
  }

  async logIn(): Promise<boolean> {
    await this.mutex.acquire();

    try {
      if (await this.loggedIn()) {
        return true;
      }

      this._credentials = undefined;

      console.log(
        `Not logged in. Logging in as ${this._loginParameters.get("loginname")}`
      );

      try {
        const loginResponse = await axios(
          "https://www.kingdomofloathing.com/login.php",
          {
            method: "POST",
            data: this._loginParameters,
            maxRedirects: 0,
            validateStatus: (status) => status === 302
          }
        );

        if (!loginResponse.headers["set-cookie"]) {
          console.log("Login failed.. Headers missing");
          return false;
        }

        const sessionCookies = loginResponse.headers["set-cookie"]
          .map((cookie: string) => cookie.split(";")[0])
          .join("; ");
        const apiResponse = await axios(
          "https://www.kingdomofloathing.com/api.php",
          {
            withCredentials: true,
            headers: {
              cookie: sessionCookies
            },
            params: {
              what: "status",
              for: "DiscordChat (Maintained by Irrat)"
            }
          }
        );
        this._credentials = {
          sessionCookies: sessionCookies,
          pwdhash: apiResponse.data.pwd
        };
        this._player = {
          id: apiResponse.data.playerid,
          name: apiResponse.data.name
        };
        console.log("Login success.");
        return true;
      } catch (e) {
        console.log(
          "Login failed.. Got an error. Trying again in a minute.",
          e
        );
        this._isRollover = true;
        setTimeout(() => this.logIn(), 60000);
        return false;
      }
    } finally {
      this.mutex.release();
    }
  }

  async visitUrl(
    url: string,
    parameters: Record<string, unknown> = {},
    pwd: boolean = true,
    data?: unknown
  ): Promise<unknown> {
    try {
      const page = await axios(`https://www.kingdomofloathing.com/${url}`, {
        method: "POST",
        withCredentials: true,
        headers: {
          cookie: this._credentials?.sessionCookies || ""
        },
        params: {
          ...(pwd ? { pwd: this._credentials?.pwdhash } : {}),
          ...parameters
        },
        data: data,
        validateStatus: (status) => status === 200
      });

      if (page.headers["set-cookie"] && this._credentials != null) {
        const cookies: unknown = {};

        for (const [name, cookie] of this._credentials.sessionCookies
          .split("; ")
          .map((s) => s.split("="))) {
          if (!cookie) {
            continue;
          }

          cookies[name] = cookie;
        }

        const sessionCookies = page.headers["set-cookie"].map(
          (cookie: string) => cookie.split(";")[0].trim().split("=")
        );

        for (const [name, cookie] of sessionCookies) {
          cookies[name] = cookie;
        }

        this._credentials.sessionCookies = Object.entries(cookies)
          .map(([key, value]) => `${key}=${value}`)
          .join("; ");
      }

      return page.data;
    } catch {
      return null;
    }
  }

  isRollover(): boolean {
    return this._isRollover;
  }

  getMe(): KoLUser | undefined {
    return this._player;
  }

  async start() {
    console.log("Starting " + this.getUsername() + "...");

    await this.logIn();
  }

  async getBackoffice(item: number): Promise<BackOfficeEntry[]> {
    const page = (await this.visitUrl("backoffice.php", {
      iid: item.toString(),
      action: "prices",
      ajax: "1"
    })) as string;

    const prices: BackOfficeEntry[] = [];

    for (const match of page.matchAll(
      /<td><b>([\d,]+)<\/b>(?:\(([\d,]+)\/day\))? x(\d+)<\/td>/g
    )) {
      prices.push({
        price: parseInt(match[1].replaceAll(",", "")),
        amount: parseInt(match[3].replaceAll(",", "")),
        limit: match[2] != null ? parseInt(match[2]) : 0
      });
    }

    if (prices.length == 0 && !page.includes(">None in the mall<")) {
      throw "We seem to have failed to fetch the item prices";
    }

    return prices;
  }

  mallRegex =
    /<td class="small stock">([0-9,]+)<\/td><td class="small">(?:([0-9,]+)&nbsp;\/&nbsp;day)?(?:&nbsp;)*<\/td><td class="small price"><a class=nounder href="mallstore\.php\?whichstore=(\d+)&searchitem=(\d+)&searchprice=\d+">([0-9,]+)&nbsp;Meat<\/a>/;

  async parseMallShops(item: string): Promise<BackOfficeEntry[]> {
    let page: string = (
      await axios(
        `https://www.kingdomofloathing.com/mall.php?justitems=0&pudnuggler=${encodeURIComponent(
          `"${item}"`
        )}`,
        {
          withCredentials: true,
          headers: {
            cookie: this._credentials?.sessionCookies || ""
          }
        }
      )
    ).data;
    const items: BackOfficeEntry[] = [];

    let match: string[];

    while ((match = page.match(this.mallRegex)) != null) {
      page = page.replace(match[0], "");

      const i: ShopItem = {
        item: parseInt(match[4]),
        player: parseInt(match[3]),
        amount: parseInt(match[1].replaceAll(",", "")),
        price: parseInt(match[5].replaceAll(",", "")),
        limit: match[2] ? parseInt(match[2].replaceAll(",", "")) : 0
      };

      items.push(i);
    }

    return items;
  }
}
