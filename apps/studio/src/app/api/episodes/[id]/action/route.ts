import {
  runStatusOf,
  setSeries,
  reuseCharacter,
  acceptAsset,
  approve,
  rejectAsset,
  setRealism,
  changeVoice,
  editNarration,
  redrawShots,
  revokeApproval,
  selectCandidate,
  setMotion,
  type MotionMode,
} from "@ys/pipeline/light";
import { LocalizedError, msg } from "@ys/core/messages";
import { apiError, errorResponse } from "../../../../../lib/api";
import { cancelJob, episodeBusy, getJob, repo, startJob, store } from "../../../../../lib/server";

const EPISODE_ID = /^[a-z0-9][a-z0-9-]{0,120}$/;
const MOTION_MODES: MotionMode[] = ["animated", "mixed", "still", "vector"];

export type StudioAction =
  | { type: "generate-script" }
  | { type: "edit-narration"; sceneId: string; narration: string }
  | { type: "approve-script" }
  | { type: "revoke-script" }
  | { type: "select"; entityId: string; index: number }
  | { type: "regenerate-concept" }
  | { type: "preview" }
  | { type: "set-motion"; motionMode: MotionMode; aiClipRatio?: number }
  | { type: "approve-concept" }
  | { type: "change-voice"; voiceId: string }
  | { type: "redraw"; shotIds: string[] }
  | { type: "resume" }
  | { type: "accept-asset"; key: string }
  | { type: "reject-asset"; key: string; note?: string }
  | { type: "set-realism"; enabled: boolean }
  | { type: "reuse-character"; castId: string; key: string }
  | { type: "set-series"; series?: string }
  | { type: "cancel" };

/** Stüdyodaki her insan kararı ve iş başlatma buradan geçer. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!EPISODE_ID.test(id)) return apiError(req, msg("api.badEpisode"));
  const action = (await req.json()) as StudioAction;
  const episodes = repo();

  try {
    // Çalışan iş (Stüdyo'nun ya da CLI'ın) durum dosyasını bellekteki kopyasıyla yeniden yazar: araya giren her
    // değişiklik kaybolur ya da işin ilerlemesini siler. İptal dışında hiçbir eylem iş sürerken yapılmaz.
    if (action.type !== "cancel") {
      const state = await episodes.load(id);
      if (await episodeBusy(id, state, runStatusOf(state).status)) throw new LocalizedError(msg("api.busy"));
    }
    switch (action.type) {
      case "generate-script":
        startJob(id, "job.script", ["episode", "run", id, "--until", "script"]);
        break;
      case "edit-narration":
        await episodes.update(id, (s) => editNarration(s, action.sceneId, action.narration));
        break;
      case "approve-script":
        await episodes.update(id, (s) => approve(s, "script"));
        startJob(id, "job.concept", ["episode", "run", id, "--until", "concept"]);
        break;
      case "revoke-script":
        await episodes.update(id, (s) => revokeApproval(s, "script"));
        break;
      case "select":
        await episodes.update(id, (s) => selectCandidate(s, action.entityId, action.index));
        break;
      case "regenerate-concept":
        startJob(id, "job.regenerate", ["episode", "run", id, "--only", "concept"]);
        break;
      case "preview":
        startJob(id, "job.preview", ["episode", "preview", id]);
        break;
      case "set-motion":
        if (!MOTION_MODES.includes(action.motionMode)) throw new LocalizedError(msg("api.badMotion"));
        await episodes.update(id, (s) => setMotion(s, action.motionMode, action.aiClipRatio));
        break;
      case "approve-concept":
        await episodes.update(id, (s) => approve(s, "concept"));
        startJob(id, "job.produce", ["episode", "run", id]);
        break;
      case "change-voice":
        await episodes.update(id, (s) => changeVoice(s, action.voiceId));
        break;
      case "redraw":
        await episodes.update(id, (s) => redrawShots(s, action.shotIds));
        startJob(id, "job.redraw", ["episode", "run", id]);
        break;
      case "accept-asset":
      case "reject-asset": {
        const s = await episodes.load(id);
        if (action.type === "accept-asset") await acceptAsset(store(), s, action.key);
        else await rejectAsset(store(), s, action.key, action.note);
        await episodes.save(s);
        break;
      }
      case "reuse-character": {
        const s = await episodes.load(id);
        await reuseCharacter(store(), s, action.castId, action.key);
        await episodes.save(s);
        break;
      }
      case "set-series":
        await episodes.update(id, (s) => setSeries(s, typeof action.series === "string" ? action.series : undefined));
        break;
      case "set-realism":
        await episodes.update(id, (s) => setRealism(s, action.enabled));
        break;
      case "resume":
        startJob(id, "job.resume", ["episode", "run", id]);
        break;
      case "cancel":
        cancelJob(id);
        break;
      default:
        throw new LocalizedError(msg("api.badAction", { type: String((action as { type?: unknown }).type) }));
    }
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(req, e);
  }
}
