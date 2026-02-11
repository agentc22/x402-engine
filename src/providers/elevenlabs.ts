import { keyPool } from "../lib/key-pool.js";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
const VALID_FORMATS = ["mp3_44100_128", "mp3_44100_64", "pcm_16000", "pcm_22050", "pcm_24000", "pcm_44100", "ulaw_8000"] as const;

export type ElevenLabsFormat = (typeof VALID_FORMATS)[number];
export { VALID_FORMATS, DEFAULT_VOICE_ID, DEFAULT_MODEL_ID };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function textToSpeech(
  text: string,
  voiceId: string = DEFAULT_VOICE_ID,
  modelId: string = DEFAULT_MODEL_ID,
  format: string = "mp3_44100_128",
): Promise<{ audio: string; format: string }> {
  const key = keyPool.acquire("elevenlabs");
  if (!key) {
    throw Object.assign(new Error("ElevenLabs not configured"), { status: 502 });
  }

  const url = `${ELEVENLABS_BASE}/${encodeURIComponent(voiceId)}`;
  const params = new URLSearchParams({ output_format: format });

  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200;
      console.warn(`[elevenlabs] retry ${attempt}/${MAX_RETRIES} after ${Math.round(delay)}ms`);
      await sleep(delay);
    }

    try {
      const res = await fetch(`${url}?${params}`, {
        method: "POST",
        headers: {
          "xi-api-key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status >= 500 && attempt < MAX_RETRIES) {
        lastErr = Object.assign(new Error(`ElevenLabs ${res.status}`), { status: res.status });
        continue;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw Object.assign(new Error(errData.detail?.message || "ElevenLabs API error"), {
          status: res.status,
          upstream: errData,
        });
      }

      const arrayBuffer = await res.arrayBuffer();
      const audio = Buffer.from(arrayBuffer).toString("base64");

      return { audio, format };
    } catch (err: any) {
      if ((err.status >= 500 || err.name === "TimeoutError") && attempt < MAX_RETRIES) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  throw lastErr;
}
