/** ElevenLabs hazır sesleri (v3 ile çok dilli). Boş kimlik = Gemini TTS (en ucuz, zamanlama tahmini). */
export const VOICES = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George — sıcak hikâye anlatıcısı", provider: "ElevenLabs" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian — derin, sakin", provider: "ElevenLabs" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel — haber spikeri", provider: "ElevenLabs" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice — eğitmen", provider: "ElevenLabs" },
  { id: "XrExE9yKIg1WjnnlVkGX", name: "Matilda — profesyonel", provider: "ElevenLabs" },
  { id: "", name: "Gemini TTS — en ucuz, kota yok", provider: "Gemini" },
] as const;

export const voiceName = (id: string | undefined) => VOICES.find((v) => v.id === (id ?? ""))?.name ?? id ?? "—";
