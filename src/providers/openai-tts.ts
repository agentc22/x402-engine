import { keyPool } from "../lib/key-pool.js";

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

const VALID_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
const VALID_MODELS = ["tts-1", "tts-1-hd"] as const;
const VALID_FORMATS = ["mp3", "opus", "aac", "flac", "wav", "pcm"] as const;

export type OpenAIVoice = (typeof VALID_VOICES)[number];
export type OpenAITTSModel = (typeof VALID_MODELS)[number];
export type OpenAITTSFormat = (typeof VALID_FORMATS)[number];

export { VALID_VOICES, VALID_MODELS, VALID_FORMATS };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function textToSpeech(
  text: string,
  voice: OpenAIVoice = "alloy",
  model: OpenAITTSModel = "tts-1",
  format: OpenAITTSFormat = "mp3",
): Promise<{ audio: string; format: string; model: string }> {
  const key = keyPool.acquire("openai");
  if (!key) {
    throw Object.assign(new Error("OpenAI not configured"), { status: 502 });
  }

  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 200;
      console.warn(`[openai-tts] retry ${attempt}/${MAX_RETRIES} after ${Math.round(delay)}ms`);
      await sleep(delay);
    }

    try {
      const res = await fetch(OPENAI_TTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: text,
          voice,
          response_format: format,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status >= 500 && attempt < MAX_RETRIES) {
        lastErr = Object.assign(new Error(`OpenAI TTS ${res.status}`), { status: res.status });
        continue;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw Object.assign(new Error(errData.error?.message || "OpenAI TTS API error"), {
          status: res.status,
          upstream: errData,
        });
      }

      const arrayBuffer = await res.arrayBuffer();
      const audio = Buffer.from(arrayBuffer).toString("base64");

      return { audio, format, model };
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
