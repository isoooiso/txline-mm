import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CACHE_DIR = "pundit-audio";
const DEFAULT_VOICE = "en-US-GuyNeural";

let edgeTtsMissingWarned = false;

/** Remove emoji and other symbols TTS engines stumble on. */
export function stripEmoji(text: string): string {
  return text
    .replace(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Plain speech text — no emoji or leading alert icon residue. */
export function cleanTextForTts(text: string): string {
  return stripEmoji(text).replace(/^[\s\p{P}\p{S}]+/u, "").trim();
}

function voiceEnabled(): boolean {
  return (process.env.VOICE_ENABLED ?? "false").toLowerCase() === "true";
}

function voiceName(): string {
  return (process.env.EDGE_TTS_VOICE ?? DEFAULT_VOICE).trim();
}

function cachePath(cleanedText: string): string {
  const key = createHash("sha1")
    .update(`${voiceName()}:${cleanedText}`)
    .digest("hex");
  return join(CACHE_DIR, `${key}.mp3`);
}

function stderrSnippet(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { stderr?: string | Buffer; message?: string };
    if (e.stderr) {
      return String(e.stderr).slice(0, 200);
    }
    if (e.message) return e.message.slice(0, 200);
  }
  return String(err).slice(0, 200);
}

async function runEdgeTts(
  cleanedText: string,
  outPath: string,
  voice: string,
): Promise<boolean> {
  try {
    await execFileAsync("edge-tts", [
      "--voice",
      voice,
      "--text",
      cleanedText,
      "--write-media",
      outPath,
    ]);
    return existsSync(outPath);
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: string }).code)
        : "";
    if (code === "ENOENT") {
      if (!edgeTtsMissingWarned) {
        console.warn(
          "[pundit/tts] edge-tts not found — run: pip install edge-tts; continuing text-only",
        );
        edgeTtsMissingWarned = true;
      }
      return false;
    }
    console.error(`[pundit/tts] edge-tts failed: ${stderrSnippet(err)}`);
    return false;
  }
}

export async function synthesizeSpeech(text: string): Promise<string | null> {
  if (!voiceEnabled()) return null;

  const cleanedText = cleanTextForTts(text);
  if (!cleanedText) return null;

  const path = cachePath(cleanedText);
  if (existsSync(path)) return path;

  mkdirSync(CACHE_DIR, { recursive: true });

  const ok = await runEdgeTts(cleanedText, path, voiceName());
  return ok ? path : null;
}
