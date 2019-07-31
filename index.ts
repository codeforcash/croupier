import * as Honeybadger from "honeybadger";
import Croupier from "./croupier";
import * as Bot from "./keybase-bot";

let croupier: Croupier;

async function main(): Promise<any> {

  Honeybadger.configure({
    apiKey: process.env.HONEYBADGER_API_KEY,
  });

  process.env.DEVELOPMENT = "true";

  croupier = new Croupier(
    "devcroupier",
    process.env.DEV_CROUPIER_PAPERKEY1,
    process.env.DEV_CROUPIER_PAPERKEY2,
    process.env.MONGODB_USERNAME,
    process.env.MONGODB_PASSWORD,
    process.env.MONGODB_HOST,
    true,
  );
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
