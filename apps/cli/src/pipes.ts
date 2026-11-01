import type { EventEmitter } from "node:events";

/**
 * Stüdyo CLI sürecinin çıktısını borudan okur. Stüdyo kapanırsa (dev sunucusu düştü, 1 Kas) boru kırılır ve sonraki
 * ilk satırda EPIPE işlenmemiş hata olarak süreci düşürüyordu: senarist bitmiş, doktor çalışırken iş sessizce öldü,
 * durum dosyasında hata kaydı bile kalmadı. Kırık boruda çıktı kaybolur ama iş sürer (günlük durum dosyasında);
 * başka akış hataları eskisi gibi süreci düşürür.
 */
export function surviveBrokenPipe(...streams: EventEmitter[]): void {
  for (const stream of streams)
    stream.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code !== "EPIPE") throw e;
    });
}
