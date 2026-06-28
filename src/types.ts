/** Odds consensus payload — PascalCase per TxLINE API schema. */
export interface OddsPayload {
  FixtureId: number;
  MessageId: string;
  Ts: number;
  Bookmaker: string;
  BookmakerId: number;
  SuperOddsType: string;
  GameState: string;
  InRunning: boolean;
  MarketParameters: string;
  MarketPeriod: string;
  PriceNames: string[];
  Prices: number[];
  Pct: string[];
}

/** Score update — fields from live/historical feed (PascalCase primary). */
export interface ScorePayload {
  FixtureId?: number;
  GameState?: string;
  Ts?: number;
  Seq?: number;
  Action?: string;
  fixtureId?: number;
  ts?: number;
  gameState?: string;
  seq?: number;
  [key: string]: unknown;
}

/** Fixture from /fixtures/snapshot — PascalCase per API. */
export interface FixturePayload {
  FixtureId: number;
  Participant1: string;
  Participant2: string;
  StartTime: number;
  Competition?: string;
  CompetitionId?: number;
  Participant1Id?: number;
  Participant2Id?: number;
  [key: string]: unknown;
}

export type FeedEvent =
  | { type: "odds"; ts: number; data: OddsPayload }
  | { type: "score"; ts: number; data: ScorePayload };

export interface FairOutcome {
  name: string;
  fairProb: number;
  fairOdds: number;
  rawPrice: number | null;
}

export interface FairLine {
  fixtureId: number;
  market: string;
  period: string;
  params: string;
  inRunning: boolean;
  ts: number;
  messageId: string;
  outcomes: FairOutcome[];
}
