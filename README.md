# YoutubeStudio

**English** · [Türkçe](README-TR.md)

An AI video factory that produces multilingual, animation-heavy YouTube videos from a single topic. Claude agents write the story and script, plan the shots, design the vector art and review their own output. Paid media APIs generate voice, images and video clips, and Remotion renders the final cut. A web Studio shows what is happening at every step and lets a human make the final call.

Architecture, provider choices and the roadmap are in [docs/PROJE_PLANI.md](docs/PROJE_PLANI.md) (Turkish). Release history: [CHANGELOG.md](CHANGELOG.md).

## Features

- **Topic to finished video.** The pipeline runs these stages: style → story → script → *approval* → cast → concept → *approval* → voice → shots → keyframes → clips → timeline → render → review. Every stage is idempotent and saves after each sub-step, so a failed run resumes where it stopped.
- **Four motion modes:**
  - `vector`: Claude-drawn SVG characters on a rig, animated in code. This is the cheapest mode.
  - `still`: images with Ken Burns motion.
  - `mixed`: some shots become AI video clips.
  - `animated`: every shot becomes an AI video clip.
- **Quality gate.** No SVG is used without a check:
  1. Before drawing, a planner agent studies reference images and turns the description into a concrete drawing plan.
  2. A blind reviewer says what the drawing shows without being told its name.
  3. A gate agent scores how recognisable it is and how faithful it is to the references.
  4. Drawings that fail are redrawn with the list of defects. If they still fail, they are not used.
- **Grounded in reality.** Real subjects are drawn from reference images found on Wikipedia and Wikimedia Commons. For objects, a ready-made public-domain/CC0 vector drawing from Commons is tried first; it is used only if it passes the same quality gate. Claude does not draw maps or flags: they are generated from real data (world-atlas, flag-icons).
- **The human has the final say.** In the Studio you can accept a drawing the gate rejected, or reject one it passed and add a note for the designer. You can also turn the reality check off for one episode.
- **24 ready-made style packs.** Examples include flat explainer, Ottoman miniature, film noir, blueprint, ukiyo-e, synthwave, chalkboard, watercolour and 8-bit pixel. In *Automatic* mode a cheap agent picks the pack that fits the topic; you can also choose one yourself, or choose *Custom* to let the art director design freely. A pack fixes the colours, drawing rules and line style, so all episodes in a pack look as if the same hand made them. Run `pnpm ys styles` to list them.
- **Character reuse.** Approved characters are kept in a library together with their identity. When the same person appears again in the same style (for example a real historical figure or the channel's host), the casting agent reuses the drawing instead of redrawing it. In the Studio you can also pick one with *Use from library*. Run `pnpm ys library` to list them.
- **Series.** Episodes can belong to a series. The home page filters by series. A new episode in an existing series inherits that series' settings and style pack, and the series' own characters are offered first for reuse. Use `--series "Name"` in the CLI.
- **Learning loop.** After each render the frames are reviewed, and lessons are written to a rule book that later episodes follow.
- **Cost first.** Estimates are shown before any money is spent. Requests are cached by content hash, so the same request is never paid twice. A per-episode budget cap applies to paid image, voice and video APIs. Claude agent calls are shown separately and do not count toward the cap.
- **Choose a model per agent.** The Studio **Models** page sets which Claude model each agent uses (for example Sonnet instead of Haiku for the quality gate).
- **Bilingual Studio.** The Studio is in Turkish and English. Videos can be in any language the voice provider supports.

## Requirements

- Node.js 24 or newer, and pnpm 11
- FFmpeg (for the local render test)
- Claude: either a signed-in Claude Code installation (subscription) or `ANTHROPIC_API_KEY`
- Optional API keys: fal, Gemini, ElevenLabs. Providers without a key are disabled.

## Setup

```bash
pnpm install
cp .env.example .env          # fill in the keys you have; empty providers are disabled
pnpm ys providers             # which providers are active?
pnpm ys render-demo           # no API calls: local Remotion render test
```

It runs without Docker. Assets go to `.data/assets`, the cost ledger to `.data/ledger.jsonl` and videos to `.data/episodes`. To use Postgres 18, Redis 8 and RustFS (S3) instead:

```bash
pnpm infra:up                 # ports: 5433 (pg), 6380 (redis), 9000/9001 (rustfs)
pnpm db:migrate
pnpm test:integration
# .env: STORE=s3, LEDGER=db
```

## Studio (recommended)

```bash
pnpm studio                   # development: http://localhost:3100
pnpm studio:build && pnpm studio:start   # production build, same port
```

1. **New episode.** Enter a topic, then choose the language, length, motion mode, line style, voice, budget and whether the reality check is on. A live estimate shows cost and duration for each mode.
2. **Script.** Edit the scenes and approve them.
3. **Concept.** Characters and places are cast and drawn. The quality-gate panel shows each drawing with its references, scores, defects and drawing plan. Accept, reject or redraw with a note.
4. **Production.** The pipeline rail, live panel and activity log show every agent call with its model, cost and duration. The Shots tab shows a preview frame of every shot before the render.
5. **Watch and download** the video, and read its review.

Other pages:

- **Costs:** the spend ledger.
- **Pricing:** provider prices.
- **Lessons:** the learned rule book.
- **Rules:** the Studio rules, read from the same constants the code uses.
- **Models:** the model for each agent.

Heavy work runs in a separate CLI process, not in the Studio server, so CLI runs also appear live in the Studio.

## CLI

```bash
pnpm ys episode new --topic "Ottoman coffeehouse bans" --lang en --minutes 3 --motion vector --budget 5
pnpm ys episode run <id>                    # all stages; run again to resume after an error
pnpm ys episode run <id> --until script     # story + script only (no image or voice spend)
pnpm ys episode run <id> --from keyframes   # regenerate from a stage
pnpm ys episode show <id>
pnpm ys cost --episode <id>
pnpm ys plan --cap i2v --duration 5         # provider ranking without spending money
pnpm ys version
```

Useful options for `episode new`:

- `--motion animated|mixed|still|vector`
- `--style-pack auto|custom|<pack>` (list: `pnpm ys styles`)
- `--line outline|flat|sketch|ink` (default: the pack's line style)
- `--manual`: stop at the approval gates.
- `--no-qa`: turn off the frame checks.
- `--no-realism`: turn off the reality check.
- `--vertical`: render in 9:16.

Run `pnpm ys --help` for everything.

## Configuration

Keys and switches live in `.env` (see `.env.example`). Notable ones:

| Variable | Purpose |
|---|---|
| `FAL_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY` | Media providers. If a key is empty, that provider is disabled. |
| `ANTHROPIC_API_KEY` | Claude agents. If empty, the Claude Code login is used. |
| `YS_MODEL_CREATIVE` / `_FAST` / `_CHEAP` | Default model for each tier. Per-agent choices on the Models page override these. |
| `STORE=s3`, `LEDGER=db` | Use S3 and Postgres instead of local files. |
| `YS_UPDATE_CHECK=0` | Turn off the Studio's update check. |

## Versions and updates

The version lives in the root `package.json`. The Studio header shows it, and so does `pnpm ys version`.

The Studio checks the latest GitHub release every 6 hours. If a newer version exists, a banner with the release notes appears. To update:

```bash
git pull && pnpm install && pnpm studio:build   # then restart pnpm studio:start
```

To cut a release (maintainers):

```bash
pnpm release patch|minor|major              # bump, CHANGELOG, commit and tag (local only)
pnpm release minor --publish                # also push and create the GitHub release
pnpm release minor --dry-run                # preview the notes
```

The release script only runs on `main` with a clean working tree, after typecheck and tests pass.

## Commands

| Command | What it does |
|---|---|
| `pnpm studio` / `studio:build` / `studio:start` | Studio in development or production mode |
| `pnpm ys …` | CLI |
| `pnpm typecheck` | TypeScript 7 check |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:coverage` | Unit tests with coverage; fails below 100% lines/branches/functions/statements |
| `pnpm test:integration` | Postgres and RustFS tests (needs Docker) |
| `pnpm release` | Version bump, changelog and tag |
| `pnpm db:generate` / `db:migrate` | Drizzle migrations |
| `pnpm infra:up` / `infra:down` | Docker infrastructure |

## Repository layout

| Path | Contents |
|---|---|
| `packages/core` | Shared Zod schemas, money in micro-dollars, quality-gate rules, model roles, versions |
| `packages/media-gateway` | Every paid generation call: cost and quality router, cache, budget cap, fallback |
| `packages/agents` | Claude Agent SDK agents with JSON-schema output |
| `packages/pipeline` | Episode state machine and stages, references, map and flag generation, estimates |
| `packages/video` | Remotion compositions, including the vector scene renderer |
| `packages/storage`, `packages/db` | Local or S3 asset store; Postgres cost ledger |
| `apps/studio` | Next.js Studio |
| `apps/cli` | `pnpm ys` |
| `apps/worker` | Trigger.dev task (optional) |
