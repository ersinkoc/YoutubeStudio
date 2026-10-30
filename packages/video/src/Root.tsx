import type { Timeline } from "@ys/core";
import { Composition } from "remotion";
import { Episode, type EpisodeProps } from "./Episode.tsx";

const PLACEHOLDER: Timeline = {
  episodeId: "placeholder",
  lang: "tr",
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 90,
  visuals: [],
  audio: [],
  captions: [],
  vectorAssets: {},
  palette: [],
  lineStyle: "outline",
};

export function Root() {
  return (
    <Composition
      id="Episode"
      component={Episode}
      defaultProps={{ timeline: PLACEHOLDER } satisfies EpisodeProps}
      // Süre ve çözünürlük timeline'dan gelir.
      calculateMetadata={({ props }) => ({
        durationInFrames: props.timeline.durationInFrames,
        fps: props.timeline.fps,
        width: props.timeline.width,
        height: props.timeline.height,
      })}
      durationInFrames={PLACEHOLDER.durationInFrames}
      fps={PLACEHOLDER.fps}
      width={PLACEHOLDER.width}
      height={PLACEHOLDER.height}
    />
  );
}
