import type { MessageKey } from "./i18n";

/** ElevenLabs hazır sesleri (v3 ile çok dilli). Boş kimlik = Gemini TTS (en ucuz, zamanlama tahmini). */
export const VOICES: readonly { id: string; label: MessageKey }[] = [
  { id: "JBFqnCBsd6RMkjVDRZzb", label: "voice.george" },
  { id: "nPczCjzI2devNBz1zQrb", label: "voice.brian" },
  { id: "onwK4e9ZLuTAKqWW03F9", label: "voice.daniel" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", label: "voice.alice" },
  { id: "XrExE9yKIg1WjnnlVkGX", label: "voice.matilda" },
  { id: "", label: "voice.gemini" },
];
