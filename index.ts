import Croupier from "./croupier";
import * as Bot from "./keybase-bot";

let croupier: Croupier;

async function main(): Promise<any> {

  croupier = new Croupier("devcroupier",
    process.env.DEV_CROUPIER_PAPERKEY1,
    process.env.DEV_CROUPIER_PAPERKEY2,
    process.env.MONGODB_USERNAME,
    process.env.MONGODB_PASSWORD,
    process.env.MONGODB_HOST,
    true);
  await croupier.run();
}

async function shutDown(): Promise<any> {
  await croupier.shutdown();
  process.exit();
}

process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);

main();
