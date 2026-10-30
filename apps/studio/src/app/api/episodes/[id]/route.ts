import { groupCosts } from "@ys/media-gateway";
import { estimateEpisode, lineStyleOf, listLibraryCharacters, motionModeOf, progressOf, runStatusOf, type MotionMode } from "@ys/pipeline/light";
import { episodeBusy, episodeSpentUsd, estimateContext, getJob, ledgerEntries, quotaOf, repo, store } from "../../../../lib/server";
import type { EpisodeResponse, QuotaView } from "../../../../lib/types";

const MODES: MotionMode[] = ["animated", "mixed", "still", "vector"];

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(id)) return new Response("Geçersiz bölüm", { status: 400 });
  try {
    const [state, entries, estimateCtx] = await Promise.all([repo().load(id), ledgerEntries(id), estimateContext()]);
    const estimates = Object.fromEntries(MODES.map((m) => [m, estimateEpisode(state, estimateCtx, m)])) as EpisodeResponse["estimates"];

    // Ses henüz bitmediyse kullanılacak sağlayıcının kotası yetiyor mu?
    let quota: QuotaView | null = null;
    if (!state.done.voice) {
      const row = estimates[motionModeOf(state.input)].rows.find((r) => r.stage === "voice");
      const providerId = state.voiceProviderId ?? row?.providerId;
      const q = providerId ? await quotaOf(providerId) : undefined;
      if (providerId && q && row) {
        const voiced = new Set(Object.keys(state.voice ?? {}));
        const needed =
          state.script?.scenes.filter((s) => !voiced.has(s.id)).reduce((n, s) => n + s.narration.length, 0) ?? row.quantity;
        quota = { providerId, quota: q, needed };
      }
    }

    const job = getJob(id) ?? null;
    const status = runStatusOf(state);
    // Stüdyo'nun başlattığı süreç yaşıyorsa (ör. uzun bir ajan çağrısında) takılmış sayılmaz.
    if (job?.status === "running" && status.status === "stalled") status.status = "running";
    // İptal edilen/çöken Stüdyo işi aşamayı kapatamadı: dosyadaki "sürüyor" bayat, kullanıcı devam ettirebilsin.
    if (status.status === "running" && !episodeBusy(id, state, "running")) status.status = job?.status === "error" ? "error" : "idle";
    // Konsept sekmesinde "Kütüphaneden kullan": aynı stil ve çizgi stilindeki onaylı karakterler.
    const library =
      motionModeOf(state.input) === "vector" && state.style && state.cast && !state.approvals?.concept
        ? await listLibraryCharacters(store(), { artStyle: state.style.artStyle, lineStyle: lineStyleOf(state), realism: state.input.realism !== false })
        : [];
    const body: EpisodeResponse = {
      state,
      library,
      job,
      status,
      spentUsd: await episodeSpentUsd(id),
      claudeUsd: entries.filter((e) => e.capability === "llm" && !e.cacheHit).reduce((n, e) => n + e.estimateMicros, 0) / 1_000_000,
      estimates,
      actual: {
        byStage: groupCosts(entries, (e) => e.stage ?? "—"),
        byProvider: groupCosts(entries, (e) => e.providerId),
      },
      progress: progressOf(state) ?? null,
      quota,
    };
    return Response.json(body);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
