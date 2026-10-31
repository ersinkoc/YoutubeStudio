import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// rename sahte: Windows'taki geçici kilit (EPERM/EBUSY) hatalarını taklit edebilmek için.
const renameFail = vi.hoisted(() => ({ errors: [] as (Error & { code?: string })[] }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...real,
    rename: async (from: string, to: string) => {
      const e = renameFail.errors.shift();
      if (e) throw e;
      return real.rename(from, to);
    },
  };
});

const { createStoreFromEnv, FsAssetStore, getJson, putJson, S3AssetStore } = await import("../src/index.ts");

const errno = (code?: string) => Object.assign(new Error(code ?? "bilinmeyen"), code ? { code } : {});

describe("FsAssetStore", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ys-store-"));
    renameFail.errors = [];
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });

  it("JSON yazar/okur; olmayan anahtar null, liste öneke göre süzülür ve .tmp dosyalarını atlar", async () => {
    const store = new FsAssetStore(root);
    const url = await putJson(store, "ep/a/state.json", { n: 1 });
    expect(url).toBe(`file://${join(root, "ep", "a", "state.json").replaceAll("\\", "/")}`);
    expect(await getJson(store, "ep/a/state.json")).toEqual({ n: 1 });
    expect(await getJson(store, "ep/yok.json")).toBeNull();
    await store.put("other/b.bin", new Uint8Array([1, 2]));
    await writeFile(join(root, "ep", "a", "yarim.tmp"), "x");
    expect(await store.list("ep/")).toEqual(["ep/a/state.json"]);
    expect((await store.list("")).sort()).toEqual(["ep/a/state.json", "other/b.bin"]);
  });

  it("kökün dışına çıkan anahtarı reddeder (kardeş klasör dahil)", async () => {
    const store = new FsAssetStore(join(root, "assets"));
    await expect(store.get("../assets-x/a")).rejects.toThrow("Geçersiz anahtar");
    await expect(store.put("../../a", new Uint8Array())).rejects.toThrow("Geçersiz anahtar");
  });

  it("kök yoksa liste boş; ENOENT dışındaki okuma hataları yükselir", async () => {
    expect(await new FsAssetStore(join(root, "yok")).list("")).toEqual([]);
    const store = new FsAssetStore(root);
    await store.put("dir/a.json", new Uint8Array([1]));
    await expect(store.get("dir")).rejects.toMatchObject({ code: expect.stringMatching(/EISDIR|EPERM|EACCES/) });
    await writeFile(join(root, "dosya"), "x");
    await expect(new FsAssetStore(join(root, "dosya")).list("")).rejects.toMatchObject({ code: "ENOTDIR" });
  });

  it("geçici kilitte yeniden dener ve sonunda yazar", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    renameFail.errors = [errno("EPERM"), errno("EBUSY"), errno("EACCES")];
    const store = new FsAssetStore(root);
    let done = false;
    const p = store.put("k.bin", new Uint8Array([7])).finally(() => (done = true));
    while (!done) {
      await vi.advanceTimersByTimeAsync(2000);
      await new Promise((r) => setImmediate(r));
    }
    await p;
    expect([...((await store.get("k.bin")) ?? [])]).toEqual([7]);
    expect(renameFail.errors).toEqual([]);
  });

  it("kalıcı hata ya da tükenen denemede geçici dosyayı siler ve hatayı iletir", async () => {
    const store = new FsAssetStore(root);
    renameFail.errors = [errno()];
    await expect(store.put("a.bin", new Uint8Array([1]))).rejects.toThrow("bilinmeyen");
    renameFail.errors = [errno("EXDEV")];
    await expect(store.put("a.bin", new Uint8Array([1]))).rejects.toMatchObject({ code: "EXDEV" });

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    renameFail.errors = Array.from({ length: 9 }, () => errno("EBUSY"));
    let done = false;
    const p = store.put("b.bin", new Uint8Array([1])).catch((e: unknown) => e).finally(() => (done = true));
    while (!done) {
      await vi.advanceTimersByTimeAsync(2000);
      await new Promise((r) => setImmediate(r));
    }
    expect(await p).toMatchObject({ code: "EBUSY" });
    expect(renameFail.errors).toEqual([]);
    expect(await readdir(root)).toEqual([]);
  });
});

describe("S3AssetStore", () => {
  const opts = { region: "auto", bucket: "kova", accessKeyId: "a", secretAccessKey: "s", endpoint: "http://127.0.0.1:1" };
  afterEach(() => vi.restoreAllMocks());

  it("kova varsa oluşturmaz, yoksa oluşturur", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
    const store = new S3AssetStore(opts);
    await store.ensureBucket();
    expect(send.mock.calls.map(([c]) => c.constructor)).toEqual([HeadBucketCommand]);
    send.mockReset().mockRejectedValueOnce(new Error("404")).mockResolvedValue({} as never);
    await store.ensureBucket();
    expect(send.mock.calls.map(([c]) => c.constructor)).toEqual([HeadBucketCommand, CreateBucketCommand]);
    expect(send.mock.calls[1]![0].input).toEqual({ Bucket: "kova" });
  });

  it("yazar ve s3:// adresi döner", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({} as never);
    const url = await new S3AssetStore(opts).put("ep/a.json", new Uint8Array([1]), "application/json");
    expect(url).toBe("s3://kova/ep/a.json");
    const cmd = send.mock.calls[0]![0] as PutObjectCommand;
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input).toMatchObject({ Bucket: "kova", Key: "ep/a.json", ContentType: "application/json" });
  });

  it("sayfalı listeyi sonuna kadar okur, anahtarsız nesneyi atlar", async () => {
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockResolvedValueOnce({ Contents: [{ Key: "p/1" }, {}], IsTruncated: true, NextContinuationToken: "t2" } as never)
      .mockResolvedValueOnce({ IsTruncated: false } as never);
    expect(await new S3AssetStore(opts).list("p/")).toEqual(["p/1"]);
    const inputs = send.mock.calls.map(([c]) => (c as ListObjectsV2Command).input);
    expect(inputs).toEqual([
      { Bucket: "kova", Prefix: "p/", ContinuationToken: undefined },
      { Bucket: "kova", Prefix: "p/", ContinuationToken: "t2" },
    ]);
  });

  it("okur; gövdesiz yanıt ve NoSuchKey null, diğer hatalar yükselir", async () => {
    const send = vi.spyOn(S3Client.prototype, "send");
    const store = new S3AssetStore(opts);
    send.mockResolvedValueOnce({ Body: { transformToByteArray: async () => new Uint8Array([9]) } } as never);
    expect([...((await store.get("a")) ?? [])]).toEqual([9]);
    expect((send.mock.calls[0]![0] as GetObjectCommand).input).toEqual({ Bucket: "kova", Key: "a" });
    send.mockResolvedValueOnce({} as never);
    expect(await store.get("a")).toBeNull();
    send.mockRejectedValueOnce(new NoSuchKey({ message: "yok", $metadata: {} }));
    expect(await store.get("a")).toBeNull();
    send.mockRejectedValueOnce(new Error("ağ"));
    await expect(store.get("a")).rejects.toThrow("ağ");
  });
});

describe("createStoreFromEnv", () => {
  const env = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;
  it("STORE=s3 eksik değişkeni bildirir, tamamsa S3 deposu kurar; yoksa klasör deposu", async () => {
    expect(() => createStoreFromEnv(env({ STORE: "s3", S3_BUCKET: "b" }))).toThrow("STORE=s3 için S3_ACCESS_KEY_ID gerekli");
    const s3 = createStoreFromEnv(env({ STORE: "s3", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "s" }));
    expect(s3).toBeInstanceOf(S3AssetStore);
    expect(await (s3 as InstanceType<typeof S3AssetStore>)["client"].config.region()).toBe("auto");
    const s3r = createStoreFromEnv(env({ STORE: "s3", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "s", S3_REGION: "eu" }));
    expect(await (s3r as InstanceType<typeof S3AssetStore>)["client"].config.region()).toBe("eu");
    expect(createStoreFromEnv(env({}), "x")).toBeInstanceOf(FsAssetStore);
    expect(createStoreFromEnv(env({}))).toBeInstanceOf(FsAssetStore);
  });
});
