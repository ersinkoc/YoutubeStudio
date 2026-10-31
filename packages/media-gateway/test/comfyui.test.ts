import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComfyUiAdapter, fillPlaceholders, type ComfyWorkflowSpec } from "../src/index.ts";

interface Call {
  url: string;
  method: string;
  body?: BodyInit | null;
}

function mockFetch(handler: (url: string, call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET", body: init?.body };
    calls.push(call);
    return handler(call.url, call);
  }) as typeof fetch;
  return { fetch: fn, calls };
}

const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
const BASE = "http://comfy.local:8188";

const workflow = {
  "1": { class_type: "Prompt", inputs: { text: "{{prompt}}", neg: "{{negative}}", seed: "{{seed}}" } },
  "2": { class_type: "Size", inputs: { width: "{{width}}", height: "{{height}}", frames: "{{frames}}", fps: "{{fps}}" } },
  "3": { class_type: "Load", inputs: { image: "{{image_1}}", image2: "{{image_2}}" } },
};

const spec = (over: Partial<ComfyWorkflowSpec> = {}): ComfyWorkflowSpec => ({
  id: "wan",
  file: "wan.json",
  capabilities: ["i2v"],
  qualityPrior: 0.6,
  ...over,
});

describe("ComfyUiAdapter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("kimlik, ücretsiz fiyat ve limitleri spec'ten alır", () => {
    const a = new ComfyUiAdapter(spec({ limits: { maxRefs: 1 } }), workflow, BASE);
    expect(a).toMatchObject({ id: "comfy:wan", local: true, price: { unit: "free" }, limits: { maxRefs: 1 }, qualityPrior: 0.6 });
    expect(new ComfyUiAdapter(spec(), workflow, BASE).limits).toEqual({});
  });

  it("referansları yükler, yer tutucuları doldurur, bekler ve çıktıları indirir", async () => {
    let prompt: Record<string, { inputs: Record<string, unknown> }> = {};
    let polls = 0;
    const uploads: string[] = [];
    const progress: string[] = [];
    const { fetch, calls } = mockFetch(async (url, call) => {
      if (url === `${BASE}/upload/image`) {
        const form = call.body as FormData;
        const file = form.get("image") as File;
        uploads.push(`${file.type} ${file.name.split(".").pop()} ${form.get("overwrite")}`);
        return json(uploads.length === 1 ? { name: "a.png", subfolder: "ys" } : { name: "b.webp" });
      }
      if (url === `${BASE}/prompt`) {
        prompt = JSON.parse(String(call.body)).prompt;
        return json({ prompt_id: "p1" });
      }
      if (url === `${BASE}/history/p1`) {
        if (++polls === 1) return json({});
        if (polls === 2) return json({ p1: { status: { completed: false, status_str: "running" } } });
        return json({
          p1: {
            status: { completed: true, status_str: "success" },
            outputs: {
              "9": {
                videos: [
                  { filename: "klip.MP4", subfolder: "", type: "output" },
                  { filename: "on.png", subfolder: "", type: "temp" },
                ],
                text: "liste değil",
              },
              "10": { files: [{ filename: "garip.xyz", subfolder: "s", type: "output" }, { filename: "uzantisiz", subfolder: "", type: "output" }] },
            },
          },
        });
      }
      if (url.startsWith(`${BASE}/view?`)) return new Response(new Uint8Array([url.length % 256]));
      throw new Error(`beklenmeyen ${url}`);
    });
    const adapter = new ComfyUiAdapter(spec({ fps: 16 }), workflow, BASE);
    const p = adapter.generate(
      {
        capability: "i2v",
        quality: "standard",
        prompt: "kedi",
        negativePrompt: "kötü",
        seed: 42,
        durationSec: 3,
        aspectRatio: "9:16",
        refs: [
          { role: "first_frame", bytes: new Uint8Array([1]), mimeType: "image/png" },
          { role: "character", bytes: new Uint8Array([2]), mimeType: "image/x-bilinmeyen" },
        ],
      },
      { fetch, onProgress: (m) => progress.push(m) },
    );
    await vi.runAllTimersAsync();
    const res = await p;

    expect(uploads).toEqual(["image/png png true", "image/x-bilinmeyen png true"]);
    expect(prompt["1"]!.inputs).toEqual({ text: "kedi", neg: "kötü", seed: 42 });
    // 3 sn × 16 fps = 48 → 8k+1 = 49.
    expect(prompt["2"]!.inputs).toEqual({ width: 720, height: 1280, frames: 49, fps: 16 });
    expect(prompt["3"]!.inputs).toEqual({ image: "ys/a.png", image2: "b.webp" });
    expect(progress).toEqual(["kuyrukta (p1)"]);
    expect(polls).toBe(3);

    const views = calls.filter((c) => c.url.includes("/view?")).map((c) => new URL(c.url).searchParams.get("filename"));
    expect(views).toEqual(["klip.MP4", "garip.xyz", "uzantisiz"]);
    expect(res.files.map((f) => f.mimeType)).toEqual(["video/mp4", "application/octet-stream", "application/octet-stream"]);
    expect(calls.find((c) => c.url.includes("garip"))!.url).toBe(`${BASE}/view?filename=garip.xyz&subfolder=s&type=output`);
    // Şablon kopyalanır, orijinali değişmez.
    expect(workflow["1"].inputs.text).toBe("{{prompt}}");
  });

  it("varsayılanlar: 16:9, 24 fps, 5 sn, rastgele tohum, boş metinler; çıktısız iş boş liste döner", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    let prompt: Record<string, { inputs: Record<string, unknown> }> = {};
    const { fetch } = mockFetch((url, call) => {
      if (url.endsWith("/prompt")) {
        prompt = JSON.parse(String(call.body)).prompt;
        return json({ prompt_id: "p2" });
      }
      return json({ p2: { status: { completed: true, status_str: "success" } } });
    });
    const res = await new ComfyUiAdapter(spec(), workflow, BASE).generate({ capability: "t2i", quality: "draft" }, { fetch });
    expect(res.files).toEqual([]);
    expect(prompt["1"]!.inputs).toEqual({ text: "", neg: "", seed: 2 ** 30 });
    // 5 × 24 = 120 → 121.
    expect(prompt["2"]!.inputs).toEqual({ width: 1280, height: 720, frames: 121, fps: 24 });
    // Referans yoksa görsel yer tutucuları dokunulmadan kalır.
    expect(prompt["3"]!.inputs).toEqual({ image: "{{image_1}}", image2: "{{image_2}}" });
    vi.restoreAllMocks();
  });

  it("ComfyUI hata durumunu mesajlarıyla hataya çevirir", async () => {
    const { fetch } = mockFetch((url) => {
      if (url.endsWith("/prompt")) return json({ prompt_id: "p3" });
      return json({ p3: { status: { completed: false, status_str: "error", messages: [["execution_error", { node: "5" }]] } } });
    });
    await expect(
      new ComfyUiAdapter(spec(), workflow, BASE).generate({ capability: "t2i", quality: "draft", seed: 1 }, { fetch }),
    ).rejects.toThrow('ComfyUI hata: [["execution_error",{"node":"5"}]]');
  });
});

describe("fillPlaceholders", () => {
  it("dizileri ve iç içe nesneleri gezer; sayı, null ve boolean'a dokunmaz", () => {
    const input = { a: ["{{x}}", 3, null, true, { b: "ön {{x}} {{y}} son" }], c: "{{y}}" };
    expect(fillPlaceholders(input, { x: 7 })).toEqual({ a: [7, 3, null, true, { b: "ön 7 {{y}} son" }], c: "{{y}}" });
  });
});
