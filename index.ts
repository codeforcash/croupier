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
