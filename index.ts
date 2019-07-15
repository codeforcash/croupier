import * as sourceMapSupport from "source-map-support";
import Croupier from "./croupier";
import * as Bot from "./keybase-bot";

sourceMapSupport.install({
  environment: "node",
});

let croupier: Croupier;

async function main(): Promise<any> {

  croupier = new Croupier("croupier",
    process.env.CROUPIER_PAPERKEY_1,
    process.env.CROUPIER_PAPERKEY_2,
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
