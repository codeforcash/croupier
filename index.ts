import * as dotenv from "dotenv";
dotenv.config();

import * as Honeybadger from "honeybadger";
import Croupier from "./croupier";

let croupier: Croupier;

async function main(): Promise<any> {

  Honeybadger.configure({
    apiKey: process.env.HONEYBADGER_API_KEY,
  });

  process.env.DEVELOPMENT = "true";

  croupier = new Croupier({
    botUsername: "devcroupier",
    paperKey1: process.env.DEV_CROUPIER_PAPERKEY1,
    paperKey2: process.env.DEV_CROUPIER_PAPERKEY2,
  }, {
    mongoDbHost: process.env.MONGODB_HOST,
    mongoDbIsCluster: true,
    mongoDbPassword: process.env.MONGODB_PASSWORD,
    mongoDbUsername: process.env.MONGODB_USERNAME,
  });

  croupier.copyRulesToKeybase().catch((e) => {
    console.log("Could not copy latest RULES.md to Keybase because ", e);
  });

  let giveaway: any;

  setTimeout(() => {

    console.log("Timeout called...");
    croupier.bot1.chat.sendMoneyInChat("cryptosnipe", "mkbot", "2.01",
                                             "@here", undefined, false);
    giveaway = setInterval(() => {

      console.log("Interval called");
      croupier.bot1.chat.sendMoneyInChat("cryptosnipe", "mkbot", "2.01",
                                             "@here", undefined, false);

    }, 1000 * 60 * 60 * 2.5);
  }, 1000 * 10);
  await croupier.run(true);

}

async function shutDown(): Promise<any> {
  await croupier.shutdown();
  process.exit();
}

process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);
process.on("uncaughtException", (exception) => {
  Honeybadger.notify(exception);
});

main();
