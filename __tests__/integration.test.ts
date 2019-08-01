import * as os from "os";
import Croupier from "../croupier";
import * as Bot from "../keybase-bot";
import { ChatChannel, MessageSummary, Transaction } from "../keybase-bot";

import {
  IBetData,
  IBetList,
  IParticipant,
  IPopularityContest,
  IPositionSize,
  IPowerup,
  IPowerupAward,
  IReactionContent,
} from "../types";

function timeout(time: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, time);
  });
}

describe("Betting Functionality", (): void => {

  const botUsername: string = "testcroupier";

  const ringo: Bot = new Bot();
  const paul: Bot = new Bot();
  const john: Bot = new Bot();
  const george: Bot = new Bot();

  let ringoBalance: number;
  let johnBalance: number;

  process.env.DEVELOPMENT = undefined;
  process.env.TEST = "true";
  const croupier: Croupier = new Croupier(botUsername,
    process.env.TEST_CROUPIER_PAPERKEY1,
    process.env.TEST_CROUPIER_PAPERKEY2,
    process.env.MONGODB_USERNAME,
    process.env.MONGODB_PASSWORD,
    process.env.MONGODB_HOST,
    true);

  const channel: ChatChannel = {
    membersType: "team",
    name: "codeforcash.croupiertest",
    public: false,
    topicName: "general",
    topicType: "chat",
  };

  const testStart: number = +new Date();
  const testStartRe: RegExp = new RegExp(testStart.toString());

  beforeAll(async (done): Promise<void> => {

    Promise.all([
      ringo.init(process.env.CROUPIER_RINGO_USERNAME, process.env.CROUPIER_RINGO_PAPERKEY),
      paul.init(process.env.CROUPIER_PAUL_USERNAME, process.env.CROUPIER_PAUL_PAPERKEY),
      john.init(process.env.CROUPIER_JOHN_USERNAME, process.env.CROUPIER_JOHN_PAPERKEY),
      george.init(process.env.CROUPIER_GEORGE_USERNAME, process.env.CROUPIER_GEORGE_PAPERKEY),
    ]).then(async (res) => {
      await croupier.run(false);
      console.log("croupier is running");
      await george.chat.send(channel, {
        body: `Test started at ${testStart}`,
      });
      ringoBalance = await croupier.checkWalletBalance(process.env.CROUPIER_RINGO_USERNAME);
      johnBalance = await croupier.checkWalletBalance(process.env.CROUPIER_JOHN_USERNAME);

      console.log(`ringo has ${ringoBalance} and john has ${johnBalance}`);
      done();
    });
  });

  afterAll(async (done): Promise<void> => {

    Promise.all([
      croupier.shutdown(),
      ringo.deinit(),
      paul.deinit(),
      john.deinit(),
      george.deinit(),
    ]).then(async (res) => {
      console.log("All bots shutdown");
      done();
    });

    process.env.TEST = undefined;
  });

  describe("Functional snipes", (): void => {

    it("starts a new snipe", async (): Promise<void> => {
      jest.setTimeout(60000);
      const exitCode: any = await ringo.chat.sendMoneyInChat(channel.topicName,
        channel.name, "0.01", botUsername, "countdown:30");
      console.log("exitCode", exitCode);
      await timeout(10000);
      const readResponse: any = await paul.chat.read(channel);
      let foundMongoIdRegex: boolean = false;
      let messageWithinTest: boolean = false;
      for (const msg of readResponse.messages.reverse()) {
        if (msg.content.type === "text") {
          const msgContent: string = msg.content.text.body;
          if (testStartRe.test(msgContent)) {
            messageWithinTest = true;
          }
          if (!messageWithinTest) {
            return;
          }
          if (/\(\*\*#[a-f\d]{24}\*\*\)/i.test(msgContent)) {
            foundMongoIdRegex = true;
          }
        }
      }
      expect(foundMongoIdRegex).toBe(true);
    });

    it("runs a snipe successfully", async () => {
      // jest.useFakeTimers()
      jest.setTimeout(300000);
      expect.assertions(1);
      const exitCode: any = await john.chat.sendMoneyInChat(channel.topicName, channel.name, "0.01", botUsername);

      const snipe: Snipe = Object.values(croupier.activeSnipes)[0];

      let winnerPaid: boolean = false;
      console.log("beforePromise");
      await new Promise((resolveRoundComplete) => {
        snipe.emitter.on("roundComplete", async () => {

          console.log("roundComplete event emitted");

          // wait 10s for the payout to settle
          await timeout(10000);

          const newRingoBalance: number = await croupier.checkWalletBalance(process.env.CROUPIER_RINGO_USERNAME);
          const newJohnBalance: number = await croupier.checkWalletBalance(process.env.CROUPIER_JOHN_USERNAME);
          console.log("check wallet balance event complete");

          console.log("Ringo", newRingoBalance, ringoBalance);
          console.log("John", newJohnBalance, johnBalance);

          if (newRingoBalance > ringoBalance || newJohnBalance > johnBalance) {
            winnerPaid = true;
          }

          resolveRoundComplete();

        });
      });
      console.log("afterPromise");
      expect(winnerPaid).toBe(true);

    });

    // TODO: refactor this and above test into just one test
    it("handles duplicate registrations just fine", async () => {

      jest.setTimeout(300000);
      expect.assertions(1);

      ringoBalance = await croupier.checkWalletBalance(process.env.CROUPIER_RINGO_USERNAME);
      johnBalance = await croupier.checkWalletBalance(process.env.CROUPIER_JOHN_USERNAME);

      const duplicateRegistrationJohn: Bot = new Bot();
      await duplicateRegistrationJohn.init(process.env.CROUPIER_JOHN_USERNAME, process.env.CROUPIER_JOHN_PAPERKEY);

      await ringo.chat.sendMoneyInChat(channel.topicName, channel.name, "0.01", botUsername, "countdown:30");
      await timeout(10000);
      const exitCode: any = await john.chat.sendMoneyInChat(channel.topicName, channel.name, "0.01", botUsername);
      const snipe: Snipe = Object.values(croupier.activeSnipes)[0];

      let winnerPaid: boolean = false;

      console.log("bp");
      await new Promise((resolveRoundComplete) => {
        console.log("wp");
        snipe.emitter.on("roundComplete", async () => {

          console.log("roundComplete event emitted");

          // wait 10s for the payout to settle
          await timeout(10000);

          const newRingoBalance: number = await croupier.checkWalletBalance(process.env.CROUPIER_RINGO_USERNAME);
          const newJohnBalance: number = await croupier.checkWalletBalance(process.env.CROUPIER_JOHN_USERNAME);
          console.log("check wallet balance event complete");

          console.log("Ringo", newRingoBalance, ringoBalance);
          console.log("John", newJohnBalance, johnBalance);

          if (newRingoBalance > ringoBalance || newJohnBalance > johnBalance) {
            winnerPaid = true;
          }

          resolveRoundComplete();

        });
      });
      console.log("afterPromise");
      expect(winnerPaid).toBe(true);

    });

  });

});
