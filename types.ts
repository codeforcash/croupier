import { ChatChannel, MessageSummary, Transaction } from "./keybase-bot";

export interface IReactionContent {
  type: "reaction";
  reaction: {
      m: any;
      b: any;
  };
}

export interface IBetData {
  fees: Array<Promise<number>>;
  wagers: Array<number>;
}

export interface IBetList {
  [key: string]: IBetData;
}

export interface IParticipant {
  username: string;
  transaction: Transaction;
  onBehalfOf?: string;
  powerup?: IPowerup;
  freeBet?: boolean;
}

export interface IPowerup {
  award: IPowerupAward;
  awardedAt: number;
  usedAt: number;
  participantIndex: number;
  reactionId: string;
}

export interface IPowerupAward {
  name: string;
  description: string;
  reaction: string;
  emoji: string;
}

export interface IPopularityContest {
  challenger: string;
  leader: string;
  pollMessageId: string;
  votesForChallenger: Array<string>;
  votesForLeader: Array<string>;
}

export interface ISnipe {
  participants: Array<IParticipant>;
  betting_open: boolean;
  clock: string;
  timeout: NodeJS.Timeout;
  countdown: number;
  snipeId: number;
  betting_stops: moment.Moment;
  chatSend: ThrottledChat;
  moneySend: ThrottledMoneyTransfer;
  positionSizes: IPositionSize;
  reflipping: boolean;
  bettingTable: string;
  blinds: number;
  betting_started: number;
  popularityContests: Array<IPopularityContest>;
  potSizeStored: number;
  clockRemaining: number;
  freeze: string;
}

export interface IPositionSize {
  [key: string]: number;
}
