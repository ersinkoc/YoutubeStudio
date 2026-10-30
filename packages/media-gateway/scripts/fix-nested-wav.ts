/**
 * Önbellekteki iç içe sarılmış WAV dosyalarını onarır (30 Eki: Gemini TTS hazır WAV döndürürken bir kez daha
 * sarılıyordu; sahne geçişlerinde çıtırtı). Orijinal yanına .nested.bak olarak kopyalanır.
 *
 *   pnpm tsx packages/media-gateway/scripts/fix-nested-wav.ts [kök=.data/assets/assets]
 */
import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unwrapNestedWav } from "../src/audio.ts";

const root = process.argv[2] ?? ".data/assets/assets";
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

let checked = 0;
let fixed = 0;
for (const file of walk(root).filter((p) => p.endsWith(".wav"))) {
  checked++;
  const inner = unwrapNestedWav(new Uint8Array(readFileSync(file)));
  if (!inner) continue;
  copyFileSync(file, `${file}.nested.bak`);
  writeFileSync(file, inner);
  fixed++;
}
console.log(`kontrol edilen: ${checked} wav, onarılan: ${fixed}`);
