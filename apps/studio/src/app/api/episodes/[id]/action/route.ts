import {
  approve,
  editNarration,
  revokeApproval,
  selectCandidate,
  setMotion,
  type MotionMode,
} from "@ys/pipeline/light";
import { cancelJob, repo, startJob } from "../../../../../lib/server";

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
  | { type: "resume" }
  | { type: "cancel" };

/** Stüdyodaki her insan kararı ve iş başlatma buradan geçer. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const action = (await req.json()) as StudioAction;
  const episodes = repo();

  try {
    switch (action.type) {
      case "generate-script":
        startJob(id, "Senaryo yazılıyor", ["episode", "run", id, "--until", "script"]);
        break;
      case "edit-narration":
        await episodes.update(id, (s) => editNarration(s, action.sceneId, action.narration));
        break;
      case "approve-script":
        await episodes.update(id, (s) => approve(s, "script"));
        startJob(id, "Karakterler ve mekânlar hazırlanıyor", ["episode", "run", id, "--until", "concept"]);
        break;
      case "revoke-script":
        await episodes.update(id, (s) => revokeApproval(s, "script"));
        break;
      case "select":
        await episodes.update(id, (s) => selectCandidate(s, action.entityId, action.index));
        break;
      case "regenerate-concept":
        startJob(id, "Yeni adaylar üretiliyor", ["episode", "run", id, "--only", "concept"]);
        break;
      case "preview":
        startJob(id, "Deneme kareleri üretiliyor", ["episode", "preview", id]);
        break;
      case "set-motion":
        await episodes.update(id, (s) => setMotion(s, action.motionMode, action.aiClipRatio));
        break;
      case "approve-concept":
        await episodes.update(id, (s) => approve(s, "concept"));
        startJob(id, "Video üretiliyor", ["episode", "run", id]);
        break;
      case "resume":
        startJob(id, "Kaldığı yerden devam", ["episode", "run", id]);
        break;
      case "cancel":
        cancelJob(id);
        break;
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
