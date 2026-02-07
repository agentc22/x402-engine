import { createClient, type DeepgramClient } from "@deepgram/sdk";
import { config } from "../config.js";
import { keyPool } from "../lib/key-pool.js";

// Pool of pre-initialized Deepgram clients (one per key)
let clients: DeepgramClient[] = [];
let clientIndex = 0;

export function initDeepgram(): void {
  if (!keyPool.has("deepgram")) {
    console.log("  Deepgram API key not configured — transcribe endpoint will return 502");
    return;
  }

  // Create a client for each key in the pool
  const keyCount = keyPool.count("deepgram");
  for (let i = 0; i < keyCount; i++) {
    const key = keyPool.acquire("deepgram");
    if (key) clients.push(createClient(key));
  }
  console.log(`  Deepgram client initialized (${clients.length} key${clients.length > 1 ? "s" : ""})`);
}

function getClient(): DeepgramClient {
  if (clients.length === 0) {
    throw Object.assign(new Error("Deepgram not configured"), { status: 502 });
  }
  const client = clients[clientIndex];
  clientIndex = (clientIndex + 1) % clients.length;
  return client;
}

export interface TranscriptionRequest {
  audio_url?: string;
  audio_base64?: string;
  audio_mimetype?: string;
  language?: string;
  diarize?: boolean;
  punctuate?: boolean;
  model?: "nova-3" | "whisper-large";
}

export interface TranscriptionResponse {
  text: string;
  segments: Array<{
    text: string;
    start: number;
    end: number;
    speaker?: number;
    confidence: number;
  }>;
  speakers?: Array<{ id: number; segments_count: number }>;
  duration_seconds: number;
  language: string;
  model: string;
}

export async function transcribe(req: TranscriptionRequest): Promise<TranscriptionResponse> {
  const client = getClient();

  const options: Record<string, any> = {
    model: req.model || config.computeProviders.deepgram.model,
    language: req.language || "en",
    punctuate: req.punctuate !== false,
    diarize: req.diarize !== false,
    utterances: true,
    smart_format: true,
  };

  let result: any;

  if (req.audio_url) {
    const { result: transcription, error } = await client.listen.prerecorded.transcribeUrl(
      { url: req.audio_url },
      options,
    );
    if (error) {
      throw Object.assign(new Error(error.message), { status: 502 });
    }
    result = transcription;
  } else if (req.audio_base64) {
    const buffer = Buffer.from(req.audio_base64, "base64");
    const { result: transcription, error } = await client.listen.prerecorded.transcribeFile(
      buffer,
      { ...options, mimetype: req.audio_mimetype || "audio/mp3" },
    );
    if (error) {
      throw Object.assign(new Error(error.message), { status: 502 });
    }
    result = transcription;
  } else {
    throw new Error("Either audio_url or audio_base64 is required");
  }

  const channel = result.results?.channels?.[0];
  const alternative = channel?.alternatives?.[0];

  if (!alternative) {
    throw new Error("No transcription result returned");
  }

  const utterances = result.results?.utterances;
  const speakerIds = utterances
    ? [...new Set(utterances.map((u: any) => u.speaker))] as number[]
    : undefined;

  return {
    text: alternative.transcript,
    segments: (alternative.words || []).map((w: any) => ({
      text: w.word,
      start: w.start,
      end: w.end,
      speaker: w.speaker,
      confidence: w.confidence,
    })),
    speakers: speakerIds?.map((id) => ({
      id,
      segments_count: utterances!.filter((u: any) => u.speaker === id).length,
    })),
    duration_seconds: result.metadata?.duration || 0,
    language: result.metadata?.detected_language || req.language || "en",
    model: req.model || config.computeProviders.deepgram.model,
  };
}
