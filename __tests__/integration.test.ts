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
  return new Promise(resolve => {
    setTimeout(() => {
      resolve()
    }, time)
  })
}

describe('Betting Functionality', (): void => {

  const botUsername = "testcroupier";

  const ringo = new Bot()
  const paul = new Bot()
  const john = new Bot()
  const george = new Bot()

  let ringoBalance;
  let johnBalance;

  const croupier = new Croupier(botUsername,
    process.env.TEST_CROUPIER_PAPERKEY1,
    process.env.TEST_CROUPIER_PAPERKEY2,
    process.env.MONGODB_USERNAME,
    process.env.MONGODB_PASSWORD,
    process.env.MONGODB_HOST,
    true);

  const channel: ChatChannel = {
    name: "codeforcash.croupiertest",
    public: false,
    topicType: "chat",
    membersType: "team",
    topicName: "general",
  }

  const testStart = +new Date();
  const testStartRe = new RegExp(testStart.toString());

  beforeAll(async (done): Promise<void> => {
    process.env.DEVELOPMENT = undefined;
    process.env.TEST = "true";
    Promise.all([
      ringo.init(process.env.CROUPIER_RINGO_USERNAME, process.env.CROUPIER_RINGO_PAPERKEY),
      paul.init(process.env.CROUPIER_PAUL_USERNAME, process.env.CROUPIER_PAUL_PAPERKEY),
      john.init(process.env.CROUPIER_JOHN_USERNAME, process.env.CROUPIER_JOHN_PAPERKEY),
      george.init(process.env.CROUPIER_GEORGE_USERNAME, process.env.CROUPIER_GEORGE_PAPERKEY),
    ]).then(async (res) => {
      await croupier.run(false);
      console.log('croupier is running');
      await george.chat.send(channel, {
        body: `Test started at ${testStart}`
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
      george.deinit()
    ]).then(async (res) => {
      console.log('All bots shutdown');
      done();
    });
  })

  describe('Functional snipes', (): void => {
    it('starts a new snipe', async (): Promise<void> => {
      const exitCode = await ringo.chat.sendMoneyInChat(channel.topicName, channel.name, "0.01", botUsername, "countdown:5");
      console.log('exitCode', exitCode);
      const readResponse = await paul.chat.read(channel);
      await timeout(2000)
      let foundMongoIdRegex = false;
      let messageWithinTest = false;
      for(const msg of readResponse.messages.reverse()) {
        if(msg.content.type === 'text') {
          const msgContent = msg.content.text.body;
          if(testStartRe.test(msgContent)) {
            messageWithinTest = true;
          }
          if(!messageWithinTest) {
            return;
          }
          if(/\(\*\*#[a-f\d]{24}\*\*\)/i.test(msgContent)) {
            foundMongoIdRegex = true;
          }
        }
      }
      expect(foundMongoIdRegex).toBe(true);
    })

    it('runs a snipe successfully', async () => {
      jest.useFakeTimers()
      const exitCode = await john.chat.sendMoneyInChat(channel.topicName, channel.name, "0.01", botUsername);
      console.log('timeout?')
      jest.advanceTimersByTime(20000)
      console.log('timeout.');
      console.log('running bal check')
      let values;
      const nbl = await croupier.checkWalletBalance(process.env.CROUPIER_RINGO_USERNAME);
      expect(nbl).toEqual(123);
      // const newRingoBalance = await ;
      // console.log(newRingoBalance);


      // return Promise.all([
      //   ,
      //   croupier.checkWalletBalance(process.env.CROUPIER_JOHN_USERNAME)
      // ]).then(async (values) => {

      //   console.log('bal check complete', values)
      //   await timeout(1000 * 10);
      //   const newRingoBalance = values[0];
      //   const newJohnBalance = values[1];
      //   let winnerPaid = false;
      //   if(newRingoBalance > ringoBalance || newJohnBalance > johnBalance) {
      //     winnerPaid = true;
      //   }
      //   expect(winnerPaid).toBe(true);
      //   console.log('clearly we aint wait for the promise to complete');

      // });

    });

  })

});
