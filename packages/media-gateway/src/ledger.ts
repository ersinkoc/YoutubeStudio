import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Capability, Micros } from "@ys/core";

export interface CostEntry {
  at: string;
  episodeId?: string;
  stage?: string;
  providerId: string;
  capability: Capability;
  estimateMicros: Micros;
  cacheHit: boolean;
  requestHash: string;
}

export interface CostLedger {
  record(entry: CostEntry): Promise<void>;
  spent(episodeId: string): Promise<Micros>;
}

export class InMemoryLedger implements CostLedger {
  readonly entries: CostEntry[] = [];

  async record(entry: CostEntry): Promise<void> {
    this.entries.push(entry);
  }

  async spent(episodeId: string): Promise<Micros> {
    return sumFor(this.entries, episodeId);
  }
}

/** Veritabanı olmadan da maliyet geçmişi kalsın diye JSONL dosyası. */
export class JsonlLedger implements CostLedger {
  constructor(private readonly path: string) {}

  async record(entry: CostEntry): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(entry)}\n`);
  }

  async all(): Promise<CostEntry[]> {
    try {
      const text = await readFile(this.path, "utf8");
      return text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as CostEntry);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }

  async spent(episodeId: string): Promise<Micros> {
    return sumFor(await this.all(), episodeId);
  }
}

function sumFor(entries: readonly CostEntry[], episodeId: string): Micros {
  return entries
    .filter((e) => e.episodeId === episodeId && !e.cacheHit)
    .reduce((sum, e) => sum + e.estimateMicros, 0);
}
