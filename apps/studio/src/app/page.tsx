import Link from "next/link";
import { repo } from "../lib/server";
import { NewEpisodeForm } from "./new-episode-form";

export const dynamic = "force-dynamic";

export default async function Home() {
  const episodes = await repo().list();
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <section>
        <h1 className="mb-4 text-2xl font-semibold">Bölümler</h1>
        {episodes.length === 0 && <p className="text-muted">Henüz bölüm yok. Sağdan bir konu gir.</p>}
        <ul className="grid gap-3">
          {episodes
            .filter((e) => e.input.topic !== "render demo")
            .map((e) => (
              <li key={e.id}>
                <Link href={`/episodes/${e.id}`} className="card block hover:border-muted">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium">{e.story?.title ?? e.input.topic}</div>
                      <div className="mt-1 text-sm text-muted">
                        {e.input.lang.toUpperCase()} · {Math.round(e.input.targetSec / 60)} dk ·{" "}
                        {e.input.motionMode ?? "mixed"} · {new Date(e.createdAt).toLocaleString("tr-TR")}
                      </div>
                    </div>
                    <Status done={Object.keys(e.done).length} waiting={e.waitingFor} video={Boolean(e.render)} />
                  </div>
                </Link>
              </li>
            ))}
        </ul>
      </section>
      <aside>
        <NewEpisodeForm />
      </aside>
    </div>
  );
}

function Status({ done, waiting, video }: { done: number; waiting?: string; video: boolean }) {
  if (video) return <span className="rounded-full bg-ok/15 px-3 py-1 text-xs text-ok">Video hazır</span>;
  if (waiting)
    return (
      <span className="rounded-full bg-accent/15 px-3 py-1 text-xs text-accent">
        {waiting === "script" ? "Senaryo onayı bekliyor" : "Konsept onayı bekliyor"}
      </span>
    );
  return <span className="rounded-full bg-panel-2 px-3 py-1 text-xs text-muted">{done}/11 aşama</span>;
}
