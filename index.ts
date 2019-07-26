import * as dotenv from "dotenv";
dotenv.config();

import Croupier from "./croupier";

let croupier: Croupier;

async function main(): Promise<any> {
  croupier = new Croupier(
    process.env.DEV_CROUPIER_USERNAME1,
    process.env.DEV_CROUPIER_USERNAME2,
    process.env.DEV_CROUPIER_PAPERKEY1,
    process.env.DEV_CROUPIER_PAPERKEY2,
    process.env.MONGODB_USERNAME,
    process.env.MONGODB_PASSWORD,
    process.env.MONGODB_HOST,
    JSON.parse(process.env.IS_CLUSTER),
  );
  await croupier.run(true);
}

async function shutDown(): Promise<any> {
  await croupier.shutdown();
  process.exit();
}

process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);

main();
