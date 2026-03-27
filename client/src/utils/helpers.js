import { marked } from 'marked';

export function safeMarkdown(text) {
  try {
    if (marked && marked.parse) return marked.parse(text);
    return text.replace(/\n/g, '<br>');
  } catch (e) { return text.replace(/\n/g, '<br>'); }
}

export function getSupportedMimeType() {
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'audio/webm';
}

export const TRADES = ['Electrical', 'Instrumentation', 'Pipe Fitting', 'Industrial Erection', 'Safety'];
