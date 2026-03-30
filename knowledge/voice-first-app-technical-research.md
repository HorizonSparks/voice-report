# Voice-First AI Conversation App: Technical Research
## For Construction Field Reporting Application
### Research Date: March 2026

---

## 1. Web Speech API (SpeechRecognition) Limitations

### Browser Support Status
The Web Speech API is NOT a Baseline web feature. Support is inconsistent:

- **Chrome (desktop + Android)**: Full support since Chrome 33. Uses `webkitSpeechRecognition` prefix. Audio is sent to Google servers for processing -- does NOT work offline. This is the most complete implementation.
- **Safari (iOS + macOS)**: Supported since Safari 14.1 (iOS 14.5). Uses `webkitSpeechRecognition`. On-device processing via Apple's speech framework. Key difference: Safari's implementation has stricter auto-timeout behavior.
- **Firefox**: Supported behind a flag (`media.webspeech.recognition.enable`) since Firefox 110. Uses `SpeechRecognition` (no prefix). Server-based via Google Cloud Speech. Not enabled by default -- effectively unusable for production.
- **Edge**: Supported (Chromium-based, same as Chrome).
- **Samsung Internet, Opera**: Partial/no support.

### Auto-Timeout Behavior (The Critical Problem)

This is the single biggest limitation for a voice conversation app:

- **Chrome**: When `continuous = true`, Chrome will auto-stop recognition after approximately 60 seconds of silence. Even during active speech, sessions can terminate after ~5 minutes with no clear documentation on the exact limit. When recognition ends, the `end` event fires.
- **Safari (iOS)**: More aggressive timeout. Safari stops recognition after approximately 5-10 seconds of silence even with `continuous = true`. On iOS, the system may also revoke microphone access when the app goes to background. Safari also shows a persistent recording indicator in the address bar.
- **Chrome (Android)**: Similar to desktop Chrome but with additional OS-level restrictions. Android may kill background audio after the screen locks.

### Known Bugs and Issues

1. **Chrome "no-speech" error**: After ~8-10 seconds of silence, Chrome fires an error event with `error.error === "no-speech"` and stops recognition. Workaround: restart recognition in the `onend` handler.

2. **Chrome "network" error**: Since Chrome sends audio to Google servers, network interruptions cause `error.error === "network"`. Common on construction sites with spotty connectivity.

3. **Chrome "aborted" error**: Occurs when a new recognition session starts before the previous one fully ended. Race condition in the restart logic.

4. **Safari double-firing**: Safari sometimes fires the `result` event twice for the same utterance, producing duplicate text.

5. **iOS Safari page lifecycle**: When the user switches apps or the screen locks, recognition stops and cannot be restarted without user interaction (a tap).

6. **Memory leaks**: Long-running SpeechRecognition sessions in Chrome can leak memory. Some developers report browser tab crashes after 30+ minutes of continuous use.

7. **Interim results inconsistency**: The content of interim results varies significantly between Chrome and Safari. Chrome provides more granular interim updates.

8. **Language model limitations**: No custom vocabulary or grammar support (the `grammars` property is deprecated and non-functional). You cannot bias recognition toward construction terms like "romex", "THHN", "J-box", etc.

### Error Types (SpeechRecognitionErrorEvent.error)
- `no-speech` -- No speech detected
- `aborted` -- Recognition aborted
- `audio-capture` -- Audio capture failed
- `network` -- Network error (Chrome, server-based)
- `not-allowed` -- Microphone permission denied
- `service-not-allowed` -- Recognition service not allowed
- `language-not-supported` -- Language not supported

### Production Workarounds

The standard pattern used by production apps:

```javascript
// Auto-restart pattern (what your RecordView.jsx already does)
recog.onend = () => {
  if (stillRecording) {
    try { recog.start(); } catch(e) {}
  }
};
```

This works but creates gaps in recognition (200-500ms) during restart. Your current app correctly implements this pattern.

**Better approach**: Don't rely on SpeechRecognition for the actual transcript. Use it only for live preview (as your app currently does), and use MediaRecorder + Whisper for the real transcription. This is the correct architecture.

### What Your App Currently Does Right
Looking at `RecordView.jsx`, the app uses SpeechRecognition only as a live preview while MediaRecorder captures the actual audio for server-side Whisper transcription. This is the optimal web-based approach. The SpeechRecognition restart-on-end pattern at line 126 handles the auto-timeout gracefully.

---

## 2. Native vs Web for Voice Apps

### Web App (Current Architecture)

**Advantages:**
- No app store approval process -- deploy instantly
- Works on any device with a browser
- Single codebase for all platforms
- Easy to update (just deploy to server)
- HTTPS required (which you already have with certs)

**Disadvantages:**
- No background audio processing (tab must be active and visible)
- SpeechRecognition limitations described above
- MediaRecorder codec support varies by browser/OS
- No lock screen controls or persistent notifications
- iOS Safari aggressively suspends web audio when backgrounded
- No access to hardware audio processing (noise cancellation)
- getUserMedia re-prompts on some browsers after page reload
- PWA "Add to Home Screen" still runs in a sandboxed browser context

### React Native

**Advantages:**
- Access to native audio APIs through bridges
- Background audio processing possible
- Push notifications for reminders
- Better offline support with local storage
- Access to native noise cancellation
- Single codebase for iOS + Android (mostly)
- Can use Expo for faster development

**Disadvantages:**
- Need to manage app store submissions
- React Native audio bridges can be fragile
- Updates require app store review (unless using OTA updates)
- Native module compatibility issues between RN versions
- Debugging audio issues is harder (native logs needed)

### Native iOS (Swift/SwiftUI)

**Key APIs Available:**
- **AVAudioSession**: Full control over audio routing, categories (`.playAndRecord`), modes (`.voiceChat` which enables hardware echo cancellation and noise suppression)
- **AVAudioEngine**: Real-time audio processing pipeline with tap-on-bus for live audio access
- **Speech framework (SFSpeechRecognizer)**: On-device speech recognition with custom language models, no network dependency since iOS 17
- **AVSpeechSynthesizer**: On-device TTS (limited quality) or integrate with OpenAI TTS
- **Background Modes**: `audio` background mode keeps the app running and processing
- **CallKit integration**: Could make the voice conversation feel like a phone call
- **Core ML**: Run on-device ML models (Whisper, noise reduction)

**Specific iOS advantages for voice:**
- `AVAudioSession.Category.playAndRecord` with `.defaultToSpeaker` -- handles the full-duplex audio that web apps struggle with
- Voice Processing I/O audio unit -- hardware-level echo cancellation
- On-device Whisper via Core ML (Apple has optimized transformer inference)
- Siri Shortcuts integration for hands-free launch

### Native Android (Kotlin)

**Key APIs Available:**
- **AudioRecord**: Low-level audio capture with configurable sample rate, buffer size
- **MediaRecorder**: Higher-level recording API
- **SpeechRecognizer**: On-device speech recognition (varies by device/manufacturer)
- **TextToSpeech**: On-device TTS engine
- **Foreground Service**: Keep app alive in background with notification
- **AudioManager**: Audio focus management, routing
- **Oboe library**: Low-latency audio I/O

**Specific Android advantages:**
- Foreground services with persistent notification -- reliable background operation
- AudioRecord gives raw PCM access for custom processing
- Google's on-device speech models are good quality
- More permissive OS for background processing than iOS

### Recommendation for Construction Field App

**Short term (now)**: Stay web-based. Your current MediaRecorder + Whisper architecture is sound. The web app gets workers reporting today without an app install.

**Medium term (3-6 months)**: If voice conversation becomes the primary interaction mode and workers need hands-free operation, move to React Native. You keep React skills and gain native audio access.

**Long term (if voice is the product)**: Native iOS/Android if you need maximum audio quality, background processing, and lock-screen operation. But this doubles development effort.

---

## 3. OpenAI Realtime API

### What It Is
The OpenAI Realtime API provides a WebSocket-based interface for real-time, multi-modal (voice + text) conversations with GPT-4o. It handles speech-to-text, reasoning, and text-to-speech in a single streaming connection, eliminating the need to chain separate Whisper + LLM + TTS calls.

### How It Works
1. Client opens a WebSocket connection to `wss://api.openai.com/v1/realtime`
2. Client streams raw audio chunks (PCM16 at 24kHz, or G.711 u-law/a-law)
3. Server performs VAD (voice activity detection), transcription, LLM inference, and TTS generation
4. Server streams audio responses back in real-time
5. The model can be interrupted mid-response (barge-in support)

### Key Technical Details
- **Audio formats**: PCM16 LE 24kHz mono (primary), G.711 u-law 8kHz, G.711 a-law 8kHz
- **Protocol**: WebSocket with JSON event messages
- **Model**: GPT-4o Realtime (specifically `gpt-4o-realtime-preview`)
- **Session management**: Server maintains conversation state; client sends audio events and receives audio + text events
- **VAD**: Server-side voice activity detection with configurable silence threshold
- **Function calling**: Supports tool use / function calling within the realtime session
- **Turn detection**: Automatic or manual (push-to-talk style)

### Latency
- **End-to-end**: ~300-500ms from end of user speech to start of audio response (under ideal network conditions)
- **This is dramatically faster** than the sequential chain: record audio (variable) + upload + Whisper (~1-2s) + LLM (~1-3s) + TTS (~0.5-1s) + download + playback
- The Realtime API achieves this by running all components in a single pipeline with streaming throughout

### Pricing (as of early 2026)
- **Audio input**: $0.06 per minute (equivalent to ~$0.001 per second)
- **Audio output**: $0.24 per minute
- **Text input tokens**: $5.00 / 1M tokens
- **Text output tokens**: $20.00 / 1M tokens
- **Cached audio input**: $0.03 per minute (50% discount for repeated context)

For comparison, the sequential approach:
- Whisper: $0.006 / minute
- Claude API (Sonnet): ~$3 / 1M input, $15 / 1M output tokens
- OpenAI TTS: ~$0.015 / 1000 characters

**Cost comparison for a 5-minute voice conversation (roughly 750 words spoken by user, 500 words by AI):**
- Realtime API: ~$0.30 input audio + ~$1.20 output audio = ~$1.50
- Sequential (Whisper + Claude + TTS): ~$0.03 transcription + ~$0.05 LLM + ~$0.08 TTS = ~$0.16

The Realtime API is approximately **10x more expensive** but delivers a dramatically better experience.

### Can It Be Used From a Web App?
**Yes**, but with caveats:
- You cannot expose your OpenAI API key in client-side code
- You need a relay server: Client <-> Your Server (WebSocket) <-> OpenAI Realtime API (WebSocket)
- Your server authenticates with OpenAI and relays audio between client and OpenAI
- OpenAI provides a reference implementation: `openai-realtime-console` (GitHub)
- Alternatively, use ephemeral tokens: OpenAI offers a REST endpoint to generate short-lived tokens that the client can use directly

**From native apps**: Works the same way via WebSocket. Native apps can send raw PCM audio from the microphone directly.

### How ChatGPT Voice Mode Uses It
ChatGPT's voice mode (Advanced Voice) is built on this same infrastructure. It uses:
- On-device VAD for fast turn detection
- Streaming WebSocket audio to the Realtime API backend
- Barge-in support (interrupt the AI mid-sentence)
- Emotion/tone detection in the model
- The native app captures audio via AVAudioEngine (iOS) / AudioRecord (Android) for best quality

### Relevance to Your App
The Realtime API would replace your current flow of: record chunk -> upload -> /api/transcribe -> /api/converse -> /api/tts -> play audio. It would make conversations feel natural rather than walkie-talkie style. The trade-off is cost (10x) and architectural complexity (WebSocket relay server).

---

## 4. Voice Activity Detection (VAD)

### Why VAD Matters
VAD determines when a user starts and stops speaking. Good VAD is critical for:
- Knowing when to stop recording and send audio for processing
- Avoiding sending silence/noise to the transcription API (saves cost)
- Enabling natural conversation flow (no push-to-talk)

### Browser-Based VAD Libraries

#### @ricky0123/vad-web (Recommended)
- **What it is**: Browser-based VAD using the Silero VAD model (ONNX runtime)
- **Model**: Silero VAD v5 -- a small neural network (~2MB) trained specifically for voice activity detection
- **How it works**: Processes audio frames from getUserMedia through the Silero model via ONNX Runtime Web (WebAssembly)
- **Performance**: Runs at ~1ms per frame on modern devices. Very lightweight.
- **Key features**:
  - `onSpeechStart` / `onSpeechEnd` callbacks
  - Configurable thresholds: `positiveSpeechThreshold` (default 0.5), `negativeSpeechThreshold` (default 0.35)
  - `minSpeechFrames` -- minimum frames before triggering speech start
  - `redemptionFrames` -- how many silent frames before declaring speech end (handles natural pauses)
  - Pre/post speech padding to avoid clipping
  - Returns audio segments as Float32Arrays
- **Browser support**: Any browser with WebAssembly + AudioWorklet (Chrome, Safari, Firefox, Edge)
- **Install**: `npm install @ricky0123/vad-web`
- **Bundle size**: ~2MB (ONNX model + runtime)

#### Silero VAD (standalone)
- The underlying model used by vad-web
- Available as ONNX, PyTorch, TFLite formats
- Can be run natively on iOS/Android for better performance
- 512-sample window at 16kHz (32ms per frame)
- Very robust to background noise -- trained on diverse audio

### Comparison: VAD vs SpeechRecognition Silence Detection

| Feature | VAD (Silero/vad-web) | SpeechRecognition |
|---------|---------------------|-------------------|
| Silence detection accuracy | Excellent (ML-based) | Poor (heuristic) |
| Works offline | Yes (on-device model) | Chrome: No. Safari: Yes |
| Configurable thresholds | Yes (fine-grained) | No |
| Background noise handling | Good (trained for it) | Poor |
| Returns raw audio | Yes | No (text only) |
| Construction site performance | Good with tuning | Poor |
| Latency | ~1ms per frame | N/A (different purpose) |

### Thresholds for Noisy Environments (Construction Sites)

For construction sites, you need to adjust VAD thresholds:
- **Raise `positiveSpeechThreshold`** to 0.7-0.85 (default 0.5) -- reduces false positives from equipment noise
- **Raise `negativeSpeechThreshold`** to 0.5-0.6 (default 0.35) -- prevents noise from being classified as speech
- **Increase `redemptionFrames`** to 15-20 (default 8) -- workers often pause mid-sentence around noise
- **Increase `minSpeechFrames`** to 5-8 (default 3) -- filters out impact noise / bangs

Example configuration for construction:
```javascript
const vad = await MicVAD.new({
  positiveSpeechThreshold: 0.8,
  negativeSpeechThreshold: 0.55,
  redemptionFrames: 16,
  minSpeechFrames: 6,
  preSpeechPadFrames: 10,
  onSpeechStart: () => { /* start recording */ },
  onSpeechEnd: (audio) => { /* process audio segment */ },
});
```

### VAD Recommendation for Your App
Replace the current push-to-talk approach with VAD-triggered recording:
1. User taps once to enter "listening mode"
2. vad-web detects speech start -> begin buffering audio
3. vad-web detects speech end -> send buffered audio to Whisper
4. AI responds via TTS
5. vad-web detects next speech start -> new turn

This transforms the experience from walkie-talkie to something closer to a natural conversation.

---

## 5. Audio Quality on Construction Sites

### Noise Profile of Construction Sites
- **Impact noise**: Hammers, nail guns, concrete breakers -- 100-130 dB, impulse/transient
- **Equipment hum**: Generators, compressors, HVAC -- 70-90 dB, continuous low-frequency
- **Power tools**: Saws, grinders, drills -- 90-110 dB, continuous broadband
- **Wind**: Outdoor sites -- variable, mainly low-frequency
- **Reverb**: Inside structures with hard surfaces -- complex reflections
- **Typical speech level**: 65-75 dB at normal distance, 80-85 dB if shouting

Workers will often be recording in 80-100 dB environments. Speech-to-noise ratio can be 0 dB or negative.

### Noise Reduction Techniques

#### 1. WebRTC Noise Suppression (Available Now in Browsers)
- Built into `getUserMedia` via audio constraints:
```javascript
navigator.mediaDevices.getUserMedia({
  audio: {
    noiseSuppression: true,    // WebRTC noise suppression
    echoCancellation: true,    // Echo cancellation
    autoGainControl: true,     // Auto gain control
    channelCount: 1,           // Mono
    sampleRate: 16000,         // 16kHz is sufficient for speech
  }
});
```
- **Effectiveness**: Moderate. Good for steady-state noise (fans, hum). Poor for impulse noise (hammering).
- **Chrome**: Uses WebRTC's built-in NS (noise suppression) module. Three levels internally but not configurable via API.
- **Safari**: Uses Apple's AUVoiceIO noise suppression. Generally better quality than Chrome's.
- **Limitation**: Processes audio before it reaches MediaRecorder, so you get the cleaned audio. Cannot tune aggressiveness.

#### 2. RNNoise (Recurrent Neural Network Noise Suppression)
- Open-source ML-based noise suppression from Mozilla/Xiph.org
- Can run in the browser via WebAssembly
- Library: `rnnoise-wasm` or integrate via AudioWorklet
- Much better than WebRTC's built-in NS for non-stationary noise
- Adds ~2ms latency per frame
- Trained on diverse noise types including some industrial noise

#### 3. Hardware-Level (Native Apps Only)
- **iOS AVAudioSession mode `.voiceChat`**: Enables Apple's Voice Processing I/O, which includes hardware-accelerated noise suppression, echo cancellation, and AGC. This is what phone calls use. Significantly better than any software solution.
- **Android AudioEffect**: NOISE_SUPPRESSOR effect can be attached to AudioRecord. Quality varies by device manufacturer.

#### 4. Whisper's Built-in Noise Robustness
- Whisper was trained on 680,000 hours of audio including noisy conditions
- It handles moderate background noise reasonably well
- For severe noise, preprocessing helps but Whisper alone may struggle
- The `--condition_on_previous_text` flag helps maintain coherence through noisy patches
- Whisper large-v3 is notably better in noisy conditions than smaller models

#### 5. Microphone Technique (User Education)
This is often more impactful than software:
- Hold phone 4-6 inches from mouth (not at arm's length)
- Position microphone away from wind direction
- Cup hand around microphone in high-wind conditions
- Step away from active equipment when possible
- Use a Bluetooth earpiece/headset if available (microphone closer to mouth, better SNR)

#### How Vocera Handles Hospital Noise
Vocera (hospital badge communicator) uses:
- Close-talk microphone (worn on chest, near mouth)
- Aggressive noise gating (silence anything below a threshold)
- Push-to-talk by default
- Server-side noise reduction on the audio stream
- Custom acoustic models trained on hospital ambient noise
- The physical form factor (close-talk mic) is the biggest factor

### Recommendation for Construction Field App
1. **Enable all WebRTC constraints** (noiseSuppression, echoCancellation, autoGainControl) -- you already have getUserMedia; just add these constraints
2. **Educate users**: Add a brief onboarding tip about holding phone close to mouth
3. **Use Whisper large-v3** for transcription (better noise robustness, worth the extra cost)
4. **Consider a future native app** with AVAudioSession `.voiceChat` mode for hardware-level noise suppression
5. **Add VAD** to avoid sending pure noise to Whisper (saves cost and improves accuracy)

---

## 6. Latency Optimization

### Latency Budget for Natural Conversation

Human conversational turn-taking has a natural gap of ~200ms. Anything under 1 second feels "responsive." Over 2 seconds feels laggy. Over 3 seconds breaks the conversational flow.

### Current Latency Components (Your App's Architecture)

| Step | Typical Latency | Notes |
|------|----------------|-------|
| Recording stop + blob creation | 500ms | Your `setTimeout(async () => {}, 500)` in RecordView |
| Upload audio to server | 200-2000ms | Depends on audio size and cell connection |
| Whisper API transcription | 1000-3000ms | Depends on audio length and model size |
| Claude API response | 1000-5000ms | Depends on response length, streaming helps |
| OpenAI TTS generation | 500-1500ms | Depends on text length |
| TTS audio download | 200-1000ms | Depends on audio length and connection |
| Total | **3.5 - 13 seconds** | **Too slow for natural conversation** |

### Optimization Strategies

#### 1. Eliminate the 500ms setTimeout
Your RecordView has `setTimeout(async () => {}, 500)` after stopping recording. This was likely added to ensure all MediaRecorder chunks are flushed. Instead, use the `onstop` event:
```javascript
recorder.onstop = () => {
  // All chunks are guaranteed to be available here
  processAudio();
};
```
**Savings: ~500ms**

#### 2. Stream Audio During Recording
Instead of recording the entire turn, then uploading:
- Use MediaRecorder with `timeslice` parameter (you already use `recorder.start(1000)`)
- Send chunks to server as they're recorded via WebSocket
- Server begins Whisper processing on chunks as they arrive
- Or: accumulate on client but begin upload immediately when recording stops (no setTimeout)

**Savings: 500-1500ms** (overlaps recording and upload)

#### 3. Use Streaming Transcription
Instead of Whisper batch API, consider:
- **Deepgram streaming**: WebSocket-based, real-time transcription, ~300ms latency
- **AssemblyAI real-time**: WebSocket streaming, ~500ms latency
- **Google Cloud Speech-to-Text streaming**: Well-established, ~300ms latency
- These return words as they're spoken, allowing you to start LLM inference before the user finishes speaking

**Savings: 1000-2000ms**

#### 4. Stream LLM Responses
Use Claude's streaming API to start generating TTS before the full response is ready:
```javascript
// Start TTS on the first sentence while Claude is still generating
const stream = await anthropic.messages.stream({...});
let buffer = '';
for await (const chunk of stream) {
  buffer += chunk;
  if (buffer.includes('.') || buffer.includes('?') || buffer.includes('!')) {
    // Send first sentence to TTS immediately
    startTTS(buffer);
    buffer = '';
  }
}
```
**Savings: 1000-3000ms**

#### 5. Pre-warm Connections
- Keep a WebSocket connection to your server open (avoid TCP + TLS handshake per request)
- Pre-establish connections to Whisper API, Claude API, TTS API at app load
- Use HTTP/2 to multiplex requests on a single connection

**Savings: 200-500ms**

#### 6. Use OpenAI TTS Streaming
The TTS API supports streaming responses. Start playing audio as soon as the first chunk arrives rather than waiting for the complete audio file:
```javascript
const response = await fetch('/api/tts-stream', { method: 'POST', body: ... });
const reader = response.body.getReader();
// Feed chunks to an AudioContext as they arrive
```
**Savings: 300-800ms**

#### 7. Your App's TTS Pre-fetch (Already Smart)
Your `prefetchTTS()` function pre-fetches TTS audio when the AI responds. This is good but only helps for the "Read" button, not for auto-play.

### Optimized Latency Budget

| Step | Optimized Latency | How |
|------|-------------------|-----|
| Recording stop | ~50ms | Use onstop event, no setTimeout |
| Upload + transcription | 800-1500ms | Streaming upload, Deepgram streaming |
| LLM first sentence | 500-1000ms | Claude streaming, send first sentence |
| TTS first audio chunk | 200-400ms | Streaming TTS |
| Total to first audio | **1.5 - 3 seconds** | **Acceptable for conversation** |

### The Nuclear Option: OpenAI Realtime API
If you switch to the Realtime API, the entire chain collapses to a single WebSocket with ~300-500ms latency. This is how ChatGPT Voice achieves natural conversation pace. Cost is 10x higher but the experience is dramatically better.

---

## 7. React Native Voice Libraries

### @react-native-voice/voice (formerly react-native-voice)
- **npm**: `@react-native-voice/voice`
- **GitHub**: ~1.8k stars
- **What it does**: Bridge to native speech recognition (SFSpeechRecognizer on iOS, SpeechRecognizer on Android)
- **Continuous listening**: Yes, supports `continuous` mode
- **Interim results**: Yes
- **Offline**: iOS yes (since iOS 13 with downloaded language packs), Android varies by device
- **Platforms**: iOS 13+, Android API 21+
- **Known issues**:
  - Android: Some manufacturers (Samsung, Xiaomi) have custom speech recognizer implementations that behave differently
  - iOS: Recognition stops after ~60 seconds; must restart
  - Expo: NOT supported in Expo Go (requires native modules)
  - New Architecture: Compatibility issues with RN 0.73+ (TurboModules)
- **Best for**: Live transcription / speech-to-text

### expo-speech
- **npm**: `expo-speech`
- **What it does**: Text-to-speech ONLY (not speech recognition)
- **Uses**: Native TTS engines (AVSpeechSynthesizer on iOS, Android TTS)
- **Expo compatible**: Yes (works in Expo Go)
- **Voice quality**: Limited to system voices. Much lower quality than OpenAI TTS.
- **Best for**: Simple voice output, offline TTS

### expo-av (Audio Recording)
- **npm**: `expo-av`
- **What it does**: Audio recording and playback
- **Recording formats**: Configurable (AAC, WAV, etc.)
- **Background audio**: Supported with configuration
- **Expo compatible**: Yes
- **Best for**: Recording audio to send to Whisper API (similar to your current web approach)

### react-native-audio-api
- **What it does**: Web Audio API polyfill for React Native
- **Status**: Relatively new, smaller community
- **Provides**: AudioContext, AudioWorklet-like processing
- **Best for**: Real-time audio processing, VAD integration

### react-native-live-audio-stream
- **npm**: `react-native-live-audio-stream`
- **What it does**: Raw PCM audio streaming from microphone
- **Format**: 16-bit PCM at configurable sample rate
- **Key advantage**: Direct access to audio frames -- can pipe to Deepgram/Whisper streaming or run local VAD
- **Best for**: Real-time audio processing, streaming to speech APIs

### react-native-webrtc
- **npm**: `react-native-webrtc`
- **What it does**: Full WebRTC implementation for React Native
- **Noise suppression**: Yes (built into WebRTC)
- **Best for**: If you want to use WebRTC-based noise suppression natively

### Recommended React Native Audio Stack for Your App

```
Recording:        react-native-live-audio-stream (raw PCM access)
VAD:              Silero VAD via ONNX Runtime (react-native-onnxruntime)
Transcription:    Stream PCM to Deepgram or Whisper API
LLM:              Claude API (streaming)
TTS:              OpenAI TTS API (streaming) or expo-speech (offline fallback)
Background:       React Native background task + foreground service
```

If using Expo:
```
Recording:        expo-av
Transcription:    Record complete audio -> upload to Whisper
LLM:              Claude API
TTS:              expo-speech (offline) or OpenAI TTS (quality)
Limitation:       No raw audio stream access, no custom native modules in Expo Go
                  (Use EAS Build / dev client for native modules)
```

---

## 8. Progressive Web App (PWA) Voice Capabilities

### Microphone Access in PWAs

#### Android (Chrome)
- **Persistent microphone access**: Yes. Once granted, permission persists across sessions for the PWA.
- **Background audio**: NO. When the PWA is backgrounded or the screen is off, audio capture stops.
- **Workaround**: Using a foreground notification via the Notifications API does NOT keep audio alive (unlike native apps).
- **Web Locks API**: Can prevent the screen from dimming with `navigator.wakeLock.request('screen')` -- keeps the app visible and audio running.

#### iOS (Safari / PWA)
- **Persistent microphone access**: NO. iOS re-prompts for microphone permission every time the PWA is opened (or after a period of inactivity). This is a fundamental iOS WebKit limitation.
- **Background audio**: Absolutely not. iOS kills all web audio when the PWA is not in the foreground.
- **Audio context**: iOS requires a user gesture (tap) to start an AudioContext. Your app handles this with the record button.
- **Screen Wake Lock**: Not supported in iOS Safari PWA as of iOS 17. Partial support in iOS 18+.

#### Key PWA Limitations for Voice
1. **No background processing**: The moment the screen locks or user switches apps, recording stops. On a construction site, workers WILL lock their phone while walking to the next location.
2. **iOS microphone re-prompt**: Kills the seamless experience. Workers will see the permission dialog frequently.
3. **No foreground service equivalent**: Web apps cannot request "keep me alive" permission the way native Android foreground services can.
4. **Service Worker audio**: Service Workers cannot access getUserMedia or AudioContext. Audio processing must happen in the main thread or a Web Worker (limited AudioWorklet support).

### PWA Apps That Do Voice Well
Honestly, there are no widely-recognized PWA apps that do continuous voice conversation well. The limitations are too severe, especially on iOS. Most "voice PWAs" are:
- Simple voice search (single utterance, not continuous)
- Voice note recorders (press-to-record, not continuous listening)
- Google's web-based voice search (not a PWA, runs in Chrome tab)

### Service Worker Audio Processing
- Service Workers cannot access the microphone
- Web Workers can receive audio data transferred from the main thread (via SharedArrayBuffer or MessagePort) and process it (VAD, feature extraction)
- AudioWorklet runs in its own thread but cannot access network APIs
- The practical architecture is: Main thread (getUserMedia) -> AudioWorklet (processing) -> Main thread (network)

### Recommendation
A PWA is fine for your current use case (tap to record, speak, stop, wait for response). It is NOT viable for:
- Hands-free continuous listening
- Background recording
- Lock-screen voice interaction
- Always-listening mode

If "hands-free on the job site" is a goal, PWA is a dead end. You need native.

---

## 9. Offline / Poor Connectivity

### The Construction Site Connectivity Problem
- Cell service in buildings under construction is often 1-2 bars or dead zones
- Basement/underground work has no signal
- Rural job sites may have no cell coverage
- WiFi typically not available on active construction sites
- Workers move between coverage zones throughout the day

### Audio Queuing Architecture
When offline, queue audio recordings and sync when back online:

```
1. Record audio (always works - local microphone)
2. Save audio blob to IndexedDB (web) or local file system (native)
3. Mark recording as "pending transcription"
4. When connectivity returns:
   a. Upload queued audio files
   b. Transcribe via Whisper
   c. Process with Claude
   d. Store structured report
   e. Mark recordings as "processed"
5. Show user their pending vs. processed recordings
```

For your web app, IndexedDB can store audio blobs (up to hundreds of MB):
```javascript
// Store audio blob offline
const db = await openDB('voiceReports', 1, {
  upgrade(db) {
    db.createObjectStore('pendingAudio', { keyPath: 'id' });
  }
});
await db.put('pendingAudio', {
  id: Date.now(),
  blob: audioBlob,
  metadata: { user, timestamp, liveTranscript }
});
```

### On-Device Transcription Options

#### Whisper.cpp
- **What it is**: C/C++ port of OpenAI's Whisper model, optimized for CPU inference
- **Performance**: Whisper tiny (~39MB) runs at ~10x real-time on a modern phone CPU. Whisper base (~74MB) at ~4-5x real-time. Whisper small (~244MB) at ~1-2x real-time.
- **Quality**: Tiny model is adequate for clear speech. Small model is needed for noisy environments. Large models are too heavy for mobile.
- **WebAssembly**: whisper.cpp has a WASM build that runs in the browser. Performance is 3-5x slower than native but usable for short recordings.
- **React Native**: Can be integrated via native modules (C++ bridge)
- **iOS**: Runs well on Apple Silicon (M-series / A-series) with Core ML acceleration
- **Android**: Runs on CPU; NNAPI delegate available for hardware acceleration

#### Transformers.js (Whisper in the browser)
- **Library**: `@xenova/transformers` (now `@huggingface/transformers`)
- **What it does**: Runs Whisper ONNX models in the browser via WebAssembly / WebGPU
- **Model sizes**: whisper-tiny (~40MB download), whisper-base (~75MB), whisper-small (~250MB)
- **Performance**: Whisper tiny processes 30 seconds of audio in ~5-10 seconds in Chrome (WebGPU path is faster)
- **Limitation**: First load downloads the model. Caches in browser storage after that.
- **Quality**: Reasonable for clear speech. Not as good as server-side large-v3 in noisy conditions.

#### Apple on-device Speech Recognition
- iOS 17+ includes on-device speech recognition via `SFSpeechRecognizer`
- No network required if language pack is downloaded
- Quality is good but not Whisper-level for noisy audio
- Free (no API cost)

#### Google on-device Speech Recognition
- Android includes on-device speech models
- Available via `SpeechRecognizer` with `EXTRA_PREFER_OFFLINE`
- Quality varies by device and model version
- Free (no API cost)

### Recommended Offline Strategy

**Tier 1 (Minimum -- implement now):**
- Queue audio blobs in IndexedDB when offline
- Show "pending upload" status to user
- Auto-sync when connectivity returns
- Show the live SpeechRecognition transcript as a preview (it works on-device in Safari)

**Tier 2 (Better -- medium term):**
- Run Whisper tiny in the browser via transformers.js for offline transcription
- Pre-download the model (~40MB) when on WiFi
- Give users immediate transcription even offline
- Queue the Claude conversation for when online

**Tier 3 (Best -- native app):**
- Run Whisper small via whisper.cpp natively (~244MB model)
- Full quality offline transcription
- Store structured data locally, sync when online
- Could even run a small local LLM for basic structuring (but impractical on current phone hardware)

### Connectivity Detection
```javascript
// Basic online/offline detection
window.addEventListener('online', () => syncPendingRecordings());
window.addEventListener('offline', () => showOfflineBanner());

// Better: check actual API reachability
async function checkConnectivity() {
  try {
    const res = await fetch('/api/health', {
      method: 'HEAD',
      cache: 'no-store',
      signal: AbortSignal.timeout(3000)
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

---

## 10. Cost Analysis

### Architecture Comparison (Per 5-Minute Voice Conversation)

Assumptions: ~750 words spoken by user (~5 min audio), ~500 words AI response (~2000 tokens), ~300 characters TTS output.

#### Option A: Whisper + Claude + OpenAI TTS (Your Current Architecture)
| Component | Cost |
|-----------|------|
| Whisper API (5 min) | $0.030 |
| Claude Sonnet ($3/$15 per 1M tokens) | ~$0.04 |
| OpenAI TTS (~2000 chars) | ~$0.03 |
| **Total per conversation** | **~$0.10** |
| **At 50 conversations/day** | **~$5.00/day** |
| **Monthly (22 work days)** | **~$110/month** |

#### Option B: OpenAI Realtime API
| Component | Cost |
|-----------|------|
| Audio input (5 min) | $0.30 |
| Audio output (~2 min) | $0.48 |
| Text tokens (context) | ~$0.05 |
| **Total per conversation** | **~$0.83** |
| **At 50 conversations/day** | **~$41.50/day** |
| **Monthly (22 work days)** | **~$913/month** |

NOTE: Realtime API uses GPT-4o, not Claude. You'd lose Claude's quality for your domain.

#### Option C: On-Device Transcription + Cloud LLM + On-Device TTS
| Component | Cost |
|-----------|------|
| Whisper.cpp (on-device) | $0.00 |
| Claude API | ~$0.04 |
| System TTS (on-device) | $0.00 |
| **Total per conversation** | **~$0.04** |
| **At 50 conversations/day** | **~$2.00/day** |
| **Monthly (22 work days)** | **~$44/month** |

Trade-offs: Lower transcription quality (smaller model), lower TTS quality (system voices), requires native app.

#### Option D: Deepgram + Claude + OpenAI TTS
| Component | Cost |
|-----------|------|
| Deepgram Nova-2 (5 min) | $0.04 ($0.0043/15sec increments) |
| Claude Sonnet | ~$0.04 |
| OpenAI TTS | ~$0.03 |
| **Total per conversation** | **~$0.11** |
| **At 50 conversations/day** | **~$5.50/day** |
| **Monthly** | **~$121/month** |

Advantage: Deepgram has real-time streaming (lower latency), custom vocabulary support, better noise handling.

### Transcription Service Comparison

| Service | Price | Latency | Accuracy | Noise Handling | Streaming | Custom Vocab |
|---------|-------|---------|----------|----------------|-----------|-------------|
| OpenAI Whisper API | $0.006/min | 1-3s batch | Excellent | Very good | No (batch only) | No |
| Deepgram Nova-2 | $0.0043/15s (~$0.017/min) | 300ms streaming | Excellent | Excellent | Yes (WebSocket) | Yes (keywords) |
| Google Cloud STT | $0.006-0.009/15s | 300ms streaming | Good | Good | Yes | Yes (phrases) |
| AssemblyAI | $0.006/15s ($0.024/min) | 500ms streaming | Excellent | Good | Yes (WebSocket) | No |
| Azure Speech | $0.008/15s | 300ms streaming | Good | Good | Yes | Yes |
| AWS Transcribe | $0.006/15s | 500ms streaming | Good | Good | Yes | Yes |
| On-device Whisper | Free | 2-10s | Good-Excellent | Model dependent | No | No |

### TTS Service Comparison

| Service | Price | Latency | Quality | Streaming |
|---------|-------|---------|---------|-----------|
| OpenAI TTS (tts-1) | $15/1M chars | 300ms first byte | Good | Yes |
| OpenAI TTS (tts-1-hd) | $30/1M chars | 500ms first byte | Excellent | Yes |
| ElevenLabs | $0.30/1K chars | 300ms | Excellent | Yes |
| Google Cloud TTS | $4-16/1M chars | 200ms | Good | Yes |
| Azure TTS | $15/1M chars | 200ms | Good | Yes |
| Amazon Polly | $4/1M chars | 200ms | Adequate | Yes |
| System TTS (on-device) | Free | <50ms | Low-Medium | Yes |

### Recommendation
Your current architecture (Option A) is cost-effective and the right choice. At ~$0.10 per conversation and ~$110/month for a full crew, it's very reasonable. The Realtime API (Option B) is 8x more expensive and locks you into GPT-4o. Save it for a premium "natural conversation" tier if you ever want that.

Deepgram is worth evaluating if you want to reduce latency -- their streaming API would let you start Claude processing before the user finishes speaking.

---

## 11. Security and Privacy

### Voice Data Concerns in Construction

#### What Data Is Being Collected
- Audio recordings of workers' voices
- Transcripts of what they said
- Location data (if GPS is used for job site identification)
- Worker identity (person_id in your system)
- Time and duration of recordings

#### Legal / Compliance Considerations

**Recording Consent:**
- In the US, recording laws vary by state: "one-party consent" (most states) vs "two-party/all-party consent" (California, Florida, Illinois, others)
- For a work tool where the worker initiates the recording themselves, this is generally one-party consent (the worker consents)
- BUT: if the recording captures other workers' voices in the background, it gets complicated
- **Recommendation**: Have workers acknowledge in the app that recordings are for work reports only

**OSHA / Labor Considerations:**
- Workers may fear recordings could be used against them (documenting mistakes, tracking productivity)
- Clear policy that recordings are for reporting purposes only, not performance monitoring
- Union considerations if applicable

**Data Privacy (GDPR if applicable, CCPA in California):**
- Voice data is biometric data in some jurisdictions
- Right to deletion -- workers should be able to request deletion of their voice data
- Data minimization -- don't store audio longer than needed
- Illinois BIPA (Biometric Information Privacy Act) -- specifically covers voiceprints

### Data Handling Best Practices

#### 1. Audio Data Lifecycle
```
Record -> Transcribe -> Delete Audio (keep only transcript)
```
Don't store audio files indefinitely. Once transcribed and verified, delete the audio. Your app stores audio files in `/audio` -- consider adding an automatic cleanup policy (delete after 30 days, or after report is finalized).

#### 2. On-Device vs Cloud Processing
| Approach | Privacy | Quality | Cost |
|----------|---------|---------|------|
| Cloud only (current) | Audio leaves device | Best | API costs |
| On-device STT + cloud LLM | Audio stays on device, text goes to cloud | Good | Lower |
| Fully on-device | Maximum privacy | Limited | Lowest |

Your current approach sends audio to OpenAI (Whisper) and text to Anthropic (Claude). Both have data processing policies. For enterprise construction companies, this may need to go through IT/security review.

#### 3. API Provider Data Policies
- **OpenAI (Whisper, TTS)**: API data is not used for training (as of their current policy). 30-day retention for abuse monitoring. Enterprise API has zero retention option.
- **Anthropic (Claude)**: API data is not used for training by default. Enterprise plans have additional data handling agreements.
- **Deepgram**: Offers on-premise deployment for maximum data control.

#### 4. In-Transit Security
- Your app uses HTTPS (cert.pem / key.pem) -- good
- Audio is encrypted in transit to your server
- Your server to OpenAI/Anthropic is HTTPS -- good
- Consider: end-to-end encryption if storing audio at rest

#### 5. At-Rest Security
- Audio files on server should be encrypted at rest
- Database (reports, transcripts) should be encrypted
- Access controls on who can view/listen to recordings
- Audit log of who accessed what

### Enterprise Voice App Patterns
Enterprise voice apps (like Nuance Dragon Medical, 3M M*Modal, Vocera) typically:
- Offer on-premise deployment options
- Provide BAA (Business Associate Agreements) for healthcare
- Allow configurable data retention policies
- Support SSO integration
- Provide audit trails
- Offer data residency choices (which region data is stored)

### Recommendation for Your App
1. **Add a data retention policy**: Auto-delete audio files after reports are finalized (configurable, e.g., 7-30 days)
2. **Add a privacy notice**: When workers first use the app, briefly explain what's recorded and where it goes
3. **Consider transcript-only storage**: Delete audio once Whisper transcribes it; keep only the text
4. **Document your data flow**: "Audio -> your server (HTTPS) -> OpenAI Whisper (transcription, not stored long-term) -> Anthropic Claude (text only, not stored) -> structured report (your database)"
5. **For enterprise/union shops**: May need on-device transcription option to keep audio off the cloud entirely

---

## 12. Known Issues in Production Voice Apps

### ChatGPT Voice (Advanced Voice Mode)
- **Hallucinated responses**: Model sometimes generates confident but incorrect information in voice mode (same issue as text but users can't "re-read" to verify)
- **Language switching**: Occasionally responds in wrong language when accents are detected
- **Background noise interruption**: Interprets background noise as speech and responds to it
- **Barge-in sensitivity**: Sometimes interrupts itself when the user makes a small sound (cough, "uh-huh")
- **Latency spikes**: Generally fast (~500ms) but occasional 2-3 second spikes during high load
- **Context window in voice**: Conversation context is shorter in voice mode than text mode
- **Inability to spell/format**: Cannot spell out words, format numbers precisely, or dictate punctuation naturally
- **Refusal patterns**: Sometimes refuses benign requests due to overly cautious safety filters on voice

### Google Gemini Live
- **Interruption handling**: Worse than ChatGPT at handling barge-in (user interrupting AI speech)
- **Longer latency**: Typically 800ms-1.5s to first audio, slower than Realtime API
- **Voice quality**: TTS quality is lower than OpenAI's voices
- **Context loss**: Loses track of conversation context more easily in long conversations
- **Language support**: Fewer languages supported in voice mode
- **Mobile-only**: Initially limited to mobile, web support came later

### Siri
- **The fundamental problem**: Siri is command-oriented, not conversational. No multi-turn conversation.
- **Misrecognition**: Handles proper nouns poorly (people names, place names, brand names)
- **Construction terminology**: Almost no understanding of trade-specific vocabulary
- **Slow response**: On-device processing for simple queries, but anything requiring internet is slow
- **No customization**: Cannot add custom vocabulary or domain knowledge
- **Inconsistent behavior**: Same query yields different results at different times

### Alexa
- **Wake word false positives**: Activates on sounds similar to "Alexa" (TV, conversation)
- **Multi-turn limitations**: Can have short conversations but loses context quickly
- **Timeout**: Very aggressive listening timeout -- stops listening after ~8 seconds of silence
- **Ambient noise**: Performs poorly in noisy environments without its far-field microphone array
- **Skill ecosystem**: Third-party skills have even worse voice UX than first-party
- **Privacy controversies**: Audio recordings were reviewed by human contractors (now opt-in)

### Common Unsolved Problems Across All Voice Apps

1. **The "uh" / "um" problem**: Conversational speech is full of filler words, false starts, and self-corrections. Transcription handles these, but they confuse the LLM or make reports look messy.

2. **Ambient speech separation**: If two people are near the phone, the app captures both voices. No production voice app reliably separates the intended speaker from background conversation.

3. **Technical vocabulary**: Domain-specific terms (NEC code references, construction terminology, medical terms) are frequently misrecognized. Even Whisper struggles with "THHN" vs "thin" or "Romex" vs "romax."

4. **Conversation repair**: When the AI misunderstands, correcting it via voice is awkward. Text lets you edit; voice requires repeating yourself or explicitly saying "no, I said..."

5. **Output modality mismatch**: Voice is great for input but bad for reviewing structured output. Workers need to READ the final report, not listen to it. The transition from voice input to visual output is always awkward.

6. **Hands-free activation**: All apps require a visual trigger (button tap) or wake word. On a construction site with gloves, neither is ideal. Wake words are unreliable in noise.

7. **Phone positioning**: Audio quality varies dramatically based on phone position (pocket, hand at side, held to mouth, on a surface nearby). No good solution without dedicated hardware.

8. **Battery drain**: Continuous listening and audio processing drains batteries significantly. Workers on 10-hour shifts may not have charging access.

9. **Intermittent connectivity**: None of the major voice apps handle going in and out of connectivity gracefully. They either work or they don't.

10. **Accents and dialects**: Construction workforce is diverse. Heavy accents, ESL speakers, code-switching between languages -- all degrade recognition accuracy.

---

## Summary: Recommendations for Your Construction Field Voice App

### Architecture Decision Matrix

| Priority | Current (Web) | Near-term | Long-term |
|----------|---------------|-----------|-----------|
| Platform | PWA/Web app | Web + offline queue | React Native or Native |
| Recording | MediaRecorder | MediaRecorder + VAD | Native audio APIs |
| Transcription | Whisper API (batch) | Whisper API + offline Whisper.cpp (WASM) | Deepgram streaming or on-device Whisper |
| Conversation | Claude API | Claude streaming | Realtime API or Claude streaming |
| TTS | OpenAI TTS (pre-fetch) | OpenAI TTS (streaming) | OpenAI TTS streaming + system TTS fallback |
| Offline | None | Audio queuing in IndexedDB | Full offline transcription + sync |
| Noise handling | WebRTC constraints | + RNNoise WASM | Native voice processing mode |

### Top 5 Highest-Impact Improvements (Web App, Today)

1. **Add WebRTC audio constraints** to getUserMedia (noiseSuppression, echoCancellation, autoGainControl). Zero cost, immediate noise improvement.

2. **Add VAD (@ricky0123/vad-web)** to detect speech end automatically instead of requiring manual stop. Transforms the recording UX.

3. **Stream Claude responses** and start TTS on the first sentence. Cuts perceived latency by 1-3 seconds.

4. **Add offline audio queuing** in IndexedDB. Workers can record even without signal; reports process when connectivity returns.

5. **Remove the 500ms setTimeout** in RecordView.jsx stopRecording. Use the MediaRecorder onstop event instead. Free 500ms latency reduction.

### When to Go Native

Move to React Native or native when ANY of these become requirements:
- Hands-free operation (screen locked, phone in pocket)
- Continuous background listening
- Hardware noise cancellation (AVAudioSession voiceChat mode)
- On-device Whisper for offline transcription
- Persistent microphone access on iOS
- Lock-screen controls

### Cost Projection

For a crew of 10 workers doing 5 voice reports each per day:
- Current architecture: ~$5/day = ~$110/month
- With Deepgram streaming: ~$6/day = ~$132/month
- With Realtime API: ~$42/day = ~$913/month
- With on-device STT: ~$2/day = ~$44/month

The current architecture hits the right cost/quality balance for a construction app.
