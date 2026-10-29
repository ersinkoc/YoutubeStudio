import { createTikTokStyleCaptions, type Caption } from "@remotion/captions";
import type { Timeline } from "@ys/core";
import { useMemo, type ReactNode } from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Ambience } from "./Ambience.tsx";

export type EpisodeProps = { timeline: Timeline };

type Visual = Timeline["visuals"][number];

/** http(s) ise olduğu gibi, değilse render klasörünün public/ dizininden. */
const src = (url: string) => (/^https?:\/\//.test(url) ? url : staticFile(url));

/** Geçişte ardışık çekimler bu kadar kare üst üste biner (crossfade). */
const CROSSFADE = 8;

function StillMotion({ visual }: { visual: Visual }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = visual;
  const progress = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const motion = visual.motion ?? { type: "ken_burns" as const, zoomFrom: 1, zoomTo: 1.12, panX: 0 };
  // zoomFrom > zoomTo ise geri çekilme. Kaydırma, büyütmenin açtığı payı aşmasın diye ölçekle sınırlı.
  const scale = motion.type === "none" ? 1 : motion.zoomFrom + (motion.zoomTo - motion.zoomFrom) * progress;
  const panX = (motion.panX * (progress - 0.5) * (scale - 1) * 100) / scale;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Img
        src={src(visual.assetUrl)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale}) translateX(${panX}%)`,
        }}
      />
      <Ambience kind={visual.ambience} seed={visual.shotId} />
    </AbsoluteFill>
  );
}

function Clip({ visual }: { visual: Visual }) {
  return (
    <AbsoluteFill>
      <OffthreadVideo
        src={src(visual.assetUrl)}
        muted
        playbackRate={visual.playbackRate}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </AbsoluteFill>
  );
}

function FadeIn({ children }: { children: ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, CROSSFADE], [0, 1], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

function Captions({ captions }: { captions: Timeline["captions"] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;

  const pages = useMemo(() => {
    const tokens: Caption[] = captions.map((w, i) => ({
      text: i === 0 ? w.text : ` ${w.text}`,
      startMs: w.startMs,
      endMs: w.endMs,
      timestampMs: w.startMs,
      confidence: null,
    }));
    return createTikTokStyleCaptions({ captions: tokens, combineTokensWithinMilliseconds: 1400 }).pages;
  }, [captions]);

  const page = pages.find((p) => nowMs >= p.startMs && nowMs < p.startMs + p.durationMs);
  if (!page) return null;

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 90 }}>
      <div
        style={{
          maxWidth: "80%",
          textAlign: "center",
          fontFamily: "Inter, 'Noto Sans', 'Segoe UI', sans-serif",
          fontSize: 54,
          fontWeight: 800,
          lineHeight: 1.25,
          color: "white",
          textShadow: "0 3px 12px rgba(0,0,0,0.85)",
          whiteSpace: "pre-wrap",
        }}
      >
        {page.tokens.map((t) => {
          const active = nowMs >= t.fromMs && nowMs < t.toMs;
          return (
            <span key={t.fromMs} style={{ color: active ? "#FFD84D" : "white" }}>
              {t.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

export function Episode({ timeline }: EpisodeProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {timeline.visuals.map((v, i) => {
        // Son çekim hariç her çekim bir sonrakinin üstüne binmesi için biraz uzatılır.
        const overlap = i < timeline.visuals.length - 1 ? CROSSFADE : 0;
        const duration = v.durationInFrames + overlap;
        return (
          <Sequence key={v.shotId} from={v.fromFrame} durationInFrames={duration} name={v.shotId}>
            <FadeIn>
              {v.kind === "still_motion" ? <StillMotion visual={v} /> : <Clip visual={v} />}
            </FadeIn>
          </Sequence>
        );
      })}

      {timeline.audio.map((a, i) => (
        <Sequence key={`${a.role}-${i}`} from={a.fromFrame} durationInFrames={a.durationInFrames} name={a.role}>
          <Audio src={src(a.assetUrl)} volume={a.volume} />
        </Sequence>
      ))}

      {timeline.captions.length > 0 && <Captions captions={timeline.captions} />}
    </AbsoluteFill>
  );
}
