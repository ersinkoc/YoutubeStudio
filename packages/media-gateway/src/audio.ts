import type { WordTiming } from "@ys/core";

/** Bayt dizisi bir RIFF/WAVE dosyası mı? */
export function isWav(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WAVE";
}

/**
 * Gemini TTS ses verisini WAV olarak döndürür: hazır WAV gelirse olduğu gibi, ham PCM gelirse sarılmış.
 * 30 Eki: model WAV döndürmeye başlamıştı, biz yine sarıyorduk; içteki başlık ve metadata ses gibi çalınıp
 * her sahne geçişinde çıtırtı yapıyordu.
 */
export function toWav(bytes: Uint8Array, sampleRate = 24_000): Uint8Array {
  return isWav(bytes) ? bytes : pcm16ToWav(bytes, sampleRate);
}

/**
 * İç içe sarılmış WAV'ı (dış 44 baytlık başlık + içte tam bir WAV) düzeltir; sorun yoksa undefined.
 * Önbellekteki eski bozuk dosyaları yeniden üretmeden onarmak için.
 */
export function unwrapNestedWav(bytes: Uint8Array): Uint8Array | undefined {
  if (!isWav(bytes) || bytes.length < 56) return undefined;
  const inner = bytes.subarray(44);
  if (!isWav(inner)) return undefined;
  const size = new DataView(inner.buffer, inner.byteOffset, inner.byteLength).getUint32(4, true) + 8;
  return inner.slice(0, Math.min(size, inner.length));
}

/** Ham 16-bit little-endian PCM'i WAV kabına sarar. */
export function pcm16ToWav(pcm: Uint8Array, sampleRate = 24_000, channels = 1): Uint8Array {
  const header = new DataView(new ArrayBuffer(44));
  const byteRate = sampleRate * channels * 2;
  const writeAscii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) header.setUint8(offset + i, s.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  header.setUint32(4, 36 + pcm.length, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, channels, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, byteRate, true);
  header.setUint16(32, channels * 2, true);
  header.setUint16(34, 16, true);
  writeAscii(36, "data");
  header.setUint32(40, pcm.length, true);

  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header.buffer), 0);
  out.set(pcm, 44);
  return out;
}

/** ElevenLabs karakter hizalamasını kelime zamanlamalarına çevirir. */
export function charAlignmentToWords(
  characters: readonly string[],
  startSeconds: readonly number[],
  endSeconds: readonly number[],
): WordTiming[] {
  const words: WordTiming[] = [];
  let text = "";
  let start = 0;
  let end = 0;

  const flush = () => {
    if (text) words.push({ text, startMs: Math.round(start * 1000), endMs: Math.round(end * 1000) });
    text = "";
  };

  characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      flush();
      return;
    }
    if (!text) start = startSeconds[i] ?? 0;
    text += ch;
    end = endSeconds[i] ?? start;
  });
  flush();
  return words;
}
