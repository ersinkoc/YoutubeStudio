import type { Ambience as AmbienceKind } from "@ys/core";
import { useMemo } from "react";
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * Durağan karelere canlılık veren prosedürel atmosfer katmanları. API maliyeti yok; her kare
 * `random(seed)` ile deterministik çizilir, böylece paralel render sekmeleri aynı sonucu verir.
 */
export function Ambience({ kind, seed }: { kind: AmbienceKind; seed: string }) {
  switch (kind) {
    case "rain":
      return <Rain seed={seed} />;
    case "snow":
      return <Snow seed={seed} />;
    case "fog":
      return <Fog seed={seed} />;
    case "dust":
      return <Motes seed={seed} variant="dust" />;
    case "embers":
      return <Motes seed={seed} variant="embers" />;
    case "flicker":
      return <Flicker seed={seed} />;
    case "rays":
      return <Rays seed={seed} />;
    default:
      return null;
  }
}

interface Particle {
  x: number;
  y: number;
  speed: number;
  size: number;
  phase: number;
}

function useParticles(seed: string, count: number): Particle[] {
  return useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: random(`${seed}-x-${i}`),
        y: random(`${seed}-y-${i}`),
        speed: random(`${seed}-s-${i}`),
        size: random(`${seed}-z-${i}`),
        phase: random(`${seed}-p-${i}`) * Math.PI * 2,
      })),
    [seed, count],
  );
}

/** 0..1 aralığında sarmalayan konum. */
const wrap = (v: number) => ((v % 1) + 1) % 1;

function Rain({ seed }: { seed: string }) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const drops = useParticles(seed, 140);
  const t = frame / fps;
  const slant = 0.18; // rüzgâr: düşerken sağa kayma oranı
  return (
    <AbsoluteFill style={{ background: "rgba(20,30,45,0.18)" }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {drops.map((d, i) => {
          const len = 28 + d.size * 46;
          const y = wrap(d.y + t * (1.1 + d.speed * 0.9)) * (height + len) - len;
          const x = wrap(d.x + (y / height) * slant * 0.3) * width;
          return (
            <line
              key={i}
              x1={x}
              y1={y}
              x2={x + len * slant}
              y2={y + len}
              stroke="rgba(210,225,255,0.45)"
              strokeWidth={1 + d.size * 1.4}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
}

function Snow({ seed }: { seed: string }) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const flakes = useParticles(seed, 110);
  const t = frame / fps;
  return (
    <AbsoluteFill>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {flakes.map((f, i) => {
          const r = 1.5 + f.size * 4;
          const y = wrap(f.y + t * (0.05 + f.speed * 0.08)) * (height + 2 * r) - r;
          const x = (f.x + Math.sin(t * (0.6 + f.speed) + f.phase) * 0.012) * width;
          return <circle key={i} cx={x} cy={y} r={r} fill="white" opacity={0.45 + f.size * 0.45} />;
        })}
      </svg>
    </AbsoluteFill>
  );
}

function Fog({ seed }: { seed: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const offset = random(`${seed}-fog`) * 100;
  const layer = (speed: number, top: string, opacity: number) => ({
    position: "absolute" as const,
    left: "-50%",
    top,
    width: "200%",
    height: "70%",
    opacity,
    // Blur filtresi yok: render'ı 4–5 kat yavaşlatıyordu (30 Eki ölçümü). Yumuşaklık çok duraklı gradyandan geliyor.
    background:
      "radial-gradient(ellipse 30% 45% at 20% 50%, rgba(235,240,245,0.75), rgba(235,240,245,0.35) 40%, transparent 72%), radial-gradient(ellipse 25% 40% at 55% 45%, rgba(235,240,245,0.65), rgba(235,240,245,0.3) 40%, transparent 72%), radial-gradient(ellipse 30% 50% at 85% 55%, rgba(235,240,245,0.7), rgba(235,240,245,0.32) 40%, transparent 72%)",
    transform: `translateX(${Math.sin((t + offset) * speed) * 12}%)`,
  });
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ background: "linear-gradient(to top, rgba(220,226,235,0.35), rgba(220,226,235,0.08) 70%)" }} />
      <div style={layer(0.07, "30%", 0.55)} />
      <div style={layer(-0.05, "50%", 0.45)} />
    </AbsoluteFill>
  );
}

/** Havada süzülen toz (sıcak, yavaş) ya da yukarı uçan kıvılcım (turuncu, parlak). */
function Motes({ seed, variant }: { seed: string; variant: "dust" | "embers" }) {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const embers = variant === "embers";
  const motes = useParticles(seed, embers ? 90 : 110);
  const t = frame / fps;
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen" }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id={`glow-${seed}`}>
            <feGaussianBlur stdDeviation={embers ? 2 : 1.2} />
          </filter>
        </defs>
        {motes.map((m, i) => {
          const rise = embers ? 0.06 + m.speed * 0.1 : 0.004 + m.speed * 0.01;
          const y = embers ? (1 - wrap(m.y + t * rise)) * height : wrap(m.y - t * rise) * height;
          const sway = embers ? 0.02 : 0.03;
          const x = (m.x + Math.sin(t * (0.3 + m.speed * 0.5) + m.phase) * sway) * width;
          const twinkle = 0.5 + 0.5 * Math.sin(t * (1.5 + m.speed * 2) + m.phase);
          const r = embers ? 2 + m.size * 4 : 1.5 + m.size * 3.5;
          // Kıvılcım tepeye yaklaştıkça söner.
          const fade = embers ? Math.min(1, y / (height * 0.6)) : 1;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={r}
              fill={embers ? "rgb(255,160,70)" : "rgb(255,226,175)"}
              opacity={(embers ? 0.6 + twinkle * 0.4 : 0.35 + twinkle * 0.55) * fade}
              filter={`url(#glow-${seed})`}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
}

/** Mum/lamba ışığı: sıcak tonda düzensiz parlaklık oynaması ve kenarlarda nefes alan gölge. */
function Flicker({ seed }: { seed: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const p = random(`${seed}-flicker`) * 10;
  // Farklı frekanslı sinüslerin toplamı: periyodik görünmeyen titreme (-1..1).
  const n = Math.sin((t + p) * 7.3) * 0.5 + Math.sin((t + p) * 13.1) * 0.3 + Math.sin((t + p) * 2.1) * 0.2;
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background: "radial-gradient(ellipse 60% 55% at 50% 40%, rgba(255,175,90,0.55), rgba(255,175,90,0) 70%)",
          mixBlendMode: "overlay",
          opacity: 0.6 + n * 0.4,
        }}
      />
      <AbsoluteFill
        style={{
          background: "radial-gradient(ellipse 75% 70% at 50% 45%, rgba(0,0,0,0) 45%, rgba(15,5,0,0.6) 100%)",
          opacity: 0.55 - n * 0.3,
        }}
      />
    </AbsoluteFill>
  );
}

/**
 * Pencereden ya da ağaçlardan süzülen ışık huzmeleri. Konik gradyanla çizilir: huzme kenarları gradyan
 * duraklarından yumuşar, blur filtresi gerekmez (filtreli sürüm kare başına ~280 ms'ydi).
 */
function Rays({ seed }: { seed: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const fromLeft = random(`${seed}-rays`) < 0.5;
  const beams = useParticles(`${seed}-beams`, 6);
  // Işık kaynağı kadrajın üst köşesinin dışında; huzmeler aşağı doğru yelpaze gibi açılır.
  const origin = fromLeft ? "-10% -15%" : "110% -15%";
  const start = fromLeft ? 100 : 170; // derece; konik gradyan tepeden saat yönünde
  const stops = beams
    .map((b, i) => {
      const center = start + 6 + i * 14 + b.x * 6;
      const half = 1.5 + b.size * 3;
      const a = 0.18 + 0.3 * (0.5 + 0.5 * Math.sin(t * (0.4 + b.speed * 0.6) + b.phase));
      const color = `rgba(255,238,195,${a.toFixed(3)})`;
      return `transparent ${(center - half * 2).toFixed(1)}deg, ${color} ${center.toFixed(1)}deg, transparent ${(center + half * 2).toFixed(1)}deg`;
    })
    .join(", ");
  return (
    <AbsoluteFill
      style={{
        mixBlendMode: "screen",
        background: `conic-gradient(at ${origin}, transparent 0deg, ${stops}, transparent 360deg)`,
        maskImage: `radial-gradient(circle at ${fromLeft ? "0% 0%" : "100% 0%"}, black 10%, transparent 95%)`,
      }}
    />
  );
}