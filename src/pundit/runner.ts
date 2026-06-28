import type { FeedSource } from "../feed/feedSource.js";
import type { ScorePayload } from "../types.js";
import { composeAlert, type Teams } from "./compose.js";
import {
  DEFAULT_PUNDIT_DETECTOR_CONFIG,
  PunditEventDetector,
  type PunditDetectorConfig,
} from "./events.js";
import { synthesizeSpeech } from "./tts.js";
import * as telegram from "./telegram.js";

export interface FixtureMeta {
  fixtureId: number;
  participants: string[];
  startMs: number;
  scores?: ScorePayload[];
}

export interface PunditRunConfig {
  speed?: number;
  voiceEnabled?: boolean;
  moveThreshold?: number;
  moveCooldownMs?: number;
  settleDelayMs?: number;
}

export const DEFAULT_PUNDIT_RUN_CONFIG: Required<
  Omit<PunditRunConfig, "speed">
> & { speed: number } = {
  speed: 60,
  voiceEnabled: false,
  moveThreshold: DEFAULT_PUNDIT_DETECTOR_CONFIG.moveThreshold,
  moveCooldownMs: DEFAULT_PUNDIT_DETECTOR_CONFIG.moveCooldownMs,
  settleDelayMs: DEFAULT_PUNDIT_DETECTOR_CONFIG.settleDelayMs,
};

let sendChain: Promise<void> = Promise.resolve();

export function resetSendQueue(): void {
  sendChain = Promise.resolve();
}

export async function drainSendQueue(): Promise<void> {
  await sendChain;
}

function enqueueSend(task: () => Promise<void>): void {
  sendChain = sendChain.then(task).catch((err: unknown) => {
    console.error("[pundit]", err instanceof Error ? err.message : err);
  });
}

export async function runPundit(
  feed: FeedSource,
  meta: FixtureMeta,
  cfg: PunditRunConfig = {},
): Promise<PunditEventDetector> {
  const merged = { ...DEFAULT_PUNDIT_RUN_CONFIG, ...cfg };
  const p1 = meta.participants[0] ?? "Team 1";
  const p2 = meta.participants[1] ?? "Team 2";
  const teams: Teams = { p1, p2 };

  const detectorCfg: Partial<PunditDetectorConfig> = {
    moveThreshold: merged.moveThreshold,
    moveCooldownMs: merged.moveCooldownMs,
    settleDelayMs: merged.settleDelayMs,
  };

  const detector = new PunditEventDetector(detectorCfg);
  detector.setStartMs(meta.startMs);
  detector.setTeams(p1, p2);
  if (meta.scores?.length) {
    detector.preloadScoreIncrements(meta.scores, meta.startMs);
  }
  detector.attach(feed);

  const voiceOn =
    merged.voiceEnabled ||
    ["true", "1", "yes"].includes(
      (process.env.VOICE_ENABLED ?? "false").toLowerCase(),
    );

  detector.on("alert", (ev) => {
    enqueueSend(async () => {
      const { text } = await composeAlert(ev, teams);
      console.log(`[pundit] ${text}`);
      await telegram.sendText(text);
      if (voiceOn) {
        const audio = await synthesizeSpeech(text);
        if (audio) await telegram.sendVoice(audio);
      }
    });
  });

  return detector;
}
