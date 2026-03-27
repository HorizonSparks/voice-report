/**
 * OpenAI API Client
 * Wraps Whisper transcription and TTS calls.
 * Extracted from ai.js for reusability and testability.
 */
const analytics = require('../../../database/analytics');

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';
const TTS_URL = 'https://api.openai.com/v1/audio/speech';

const MIME_MAP = {
  m4a: 'audio/mp4',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

/**
 * Transcribe audio via OpenAI Whisper
 * @param {Buffer} audioBuffer - Raw audio data
 * @param {string} ext - File extension (m4a, webm, etc.)
 * @param {string} prompt - Trade-specific vocabulary hints
 * @param {object} opts - { requestId, personId } for analytics
 * @returns {{ text: string, duration_estimate: number }}
 */
async function transcribe(audioBuffer, ext, prompt, opts = {}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const mimeType = MIME_MAP[ext] || 'audio/webm';
  const blob = new Blob([audioBuffer], { type: mimeType });
  const form = new FormData();
  form.append('file', blob, `audio.${ext}`);
  form.append('model', 'whisper-1');
  form.append('response_format', 'json');
  if (prompt) form.append('prompt', prompt);

  const res = await fetch(WHISPER_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper API failed: ${err}`);
  }

  const data = await res.json();
  const durationEstimate = Math.round(audioBuffer.length / 16000); // ~16KB/sec for webm

  // Track cost (~$0.006/min)
  analytics.trackAiCost({
    request_id: opts.requestId,
    person_id: opts.personId || null,
    provider: 'openai',
    service: 'transcribe',
    model: 'whisper-1',
    audio_seconds: durationEstimate,
    estimated_cost_cents: Math.max(1, Math.round(durationEstimate * 0.01)),
    success: 1,
  });

  return { text: data.text || '', duration_estimate: durationEstimate };
}

/**
 * Text-to-speech via OpenAI TTS
 * @param {string} text - Text to speak
 * @param {object} opts - { speed, voice, requestId, personId }
 * @returns {ReadableStream} Audio stream
 */
async function textToSpeech(text, opts = {}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const res = await fetch(TTS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice: opts.voice || 'nova',
      response_format: 'mp3',
      speed: opts.speed || 1.0,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`TTS API failed: ${err}`);
  }

  // Track cost ($15/1M chars)
  analytics.trackAiCost({
    request_id: opts.requestId,
    person_id: opts.personId || null,
    provider: 'openai',
    service: 'tts',
    model: 'tts-1',
    tts_characters: text.length,
    estimated_cost_cents: Math.max(1, Math.round(text.length * 15 / 10000)),
    success: 1,
  });

  return res;
}

/**
 * Get audio as base64 string (for embedded responses)
 */
async function textToSpeechBase64(text, opts = {}) {
  const res = await textToSpeech(text, opts);
  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    audio_base64: buffer.toString('base64'),
    audio_mime: 'audio/mpeg',
  };
}

module.exports = {
  MIME_MAP,
  transcribe,
  textToSpeech,
  textToSpeechBase64,
};
