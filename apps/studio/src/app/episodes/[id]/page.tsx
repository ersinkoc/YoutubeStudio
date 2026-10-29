import { notFound } from "next/navigation";
import { repo } from "../../../lib/server";
import { EpisodeView } from "./episode-view";

export const dynamic = "force-dynamic";

export default async function EpisodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await repo().load(id);
  } catch {
    notFound();
  }
  return <EpisodeView id={id} />;
}
