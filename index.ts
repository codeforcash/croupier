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
    process.env.MYSQL_USER,
    process.env.MYSQL_PASSWORD,
    process.env.MYSQL_DB,
    process.env.MYSQL_HOST);
  await croupier.run();
}

async function shutDown(): Promise<any> {
  await croupier.shutdown();
  process.exit();
}

process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);

main();
