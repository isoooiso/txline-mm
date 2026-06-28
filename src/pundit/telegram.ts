import { readFileSync } from "node:fs";
import { basename } from "node:path";

function botToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is required");
  return t;
}

function chatId(): string {
  const id = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!id) throw new Error("TELEGRAM_CHAT_ID is required");
  return id;
}

async function apiPost(path: string, init: RequestInit): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken()}/${path}`, init);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram ${path} failed (${res.status}): ${body}`);
  }
}

export async function sendText(text: string): Promise<void> {
  await apiPost("sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId(),
      text,
    }),
  });
}

export async function sendVoice(audioPath: string, caption?: string): Promise<void> {
  const buf = readFileSync(audioPath);
  const form = new FormData();
  form.append("chat_id", chatId());
  form.append("voice", new Blob([buf], { type: "audio/mpeg" }), basename(audioPath));
  if (caption) form.append("caption", caption);

  await apiPost("sendVoice", {
    method: "POST",
    body: form,
  });
}
