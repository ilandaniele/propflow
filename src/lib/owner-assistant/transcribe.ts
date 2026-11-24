import { log } from '@/lib/log';

const MODEL = '@cf/openai/whisper-large-v3-turbo';
const TIMEOUT_MS = 25_000;
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/** Voice notes are transcribed with Workers AI only when both vars are set; otherwise the feature stays off (no cost). */
export function transcriptionEnabled(): boolean {
  return Boolean(process.env.WORKERS_AI_ACCOUNT_ID && process.env.WORKERS_AI_API_TOKEN);
}

export async function transcribeAudio(audio: Buffer, language = 'es'): Promise<string | null> {
  const accountId = process.env.WORKERS_AI_ACCOUNT_ID;
  const token = process.env.WORKERS_AI_API_TOKEN;
  if (!accountId || !token || audio.byteLength > MAX_AUDIO_BYTES) return null;

  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${MODEL}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: audio.toString('base64'), language }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn('[owner-assistant] transcription failed', { status: res.status });
      return null;
    }
    const body = (await res.json()) as { result?: { text?: unknown } };
    const text = typeof body.result?.text === 'string' ? body.result.text.trim() : '';
    return text || null;
  } catch (e) {
    log.warn('[owner-assistant] transcription error', { error: e instanceof Error ? e.message : 'unknown' });
    return null;
  }
}
