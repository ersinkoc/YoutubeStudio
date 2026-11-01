# Changelog

Releases are cut with `pnpm release`. The Studio shows an update banner when a newer GitHub release exists.

## v0.1.2 (2026-11-01)

- Shot previews appear while props are still being drawn
- Voice-over no longer needs ffprobe on PATH
- Episode jobs survive the Studio going away
- Wide shots keep everyone in frame
- Hide name tags whose face is out of frame
- Close-ups zoom on the things on a table, not the table
- Hidden name tags no longer use up an on-screen text slot
- Side-by-side name tags stay above their own heads
- Name tags follow their person through camera moves and walks
- Director frames narrated small objects as close-ups
- Characters hold objects up at chest height instead of letting them hang at the hip
- Director stages each moment in its own place instead of reusing unrelated rooms
- Review frames match the video when subtitles are off

## v0.1.1 (2026-10-31)

- Rename the product to AI Video Factory and refresh the READMEs

## v0.1.0 (2026-10-31)

First public release.

### Pipeline
- Topic to finished video: style → story → script → approval → cast → concept → approval → voice → shots → keyframes → clips → timeline → render → review. Every stage is idempotent and resumes where it stopped; a per-episode run lock prevents two runs at once.
- Four motion modes: `vector` (Claude-drawn SVG on a puppet rig, animated in code), `still`, `mixed` and `animated`.
- Quality gate for every SVG: a drawing plan from reference images, a blind recognition test and a gate score. Rejected drawings are not redrawn automatically; a human decides in the Studio.
- Real subjects are drawn from Wikipedia and Wikimedia Commons references. When the planner says the references miss the subject, the search runs again with its suggested query. Maps and flags come from real data.
- 24 style packs, series, a character library and a character bank (on-screen presenters, cast picks and series mascots).
- Learning loop: frames are reviewed after each render and lessons are kept for later episodes.

### Vector animation
- Motion obeys physics: grounded things do not float, walk steps follow the distance travelled, held objects stay in the hand, characters are never held or seated on another character.
- Gestures with anticipation, overshoot and overlapping action; pointing aims at its target, eyes follow the listener, explaining uses one dominant hand, thinking uses the free hand when holding something.
- Optional side views for walking characters.
- A character appears at most once per shot.
- Close-ups reframe when the subject would stay tiny.
- On-screen text follows one layout: an info card at the top-left for place, date and event, name tags next to their person.

### Media and cost
- One gateway for all paid calls with a cost/quality router, content-hash cache, budget cap and fallback.
- Providers: fal (FLUX, Kontext, Seedream 4.5, Kling 3 / 2.6, MiniMax H3 Max Turbo, PixVerse V6, Vidu Q3 Turbo, Seedance 2), Gemini (Nano Banana, TTS, optional Omni Flash video), ElevenLabs (voice, SFX, music) and local ComfyUI.
- Shut-down Veo preview models are skipped instead of failing at render.
- Estimates before any money is spent; Claude agent costs are shown separately.

### Studio
- Bilingual (Turkish and English) web Studio with live pipeline status, activity log, quality-gate decisions, per-agent model choice and cost pages.
- New episode page with motion-mode cards that show each mode's estimated cost.
- Subtitles are always written as an `.srt`; burning them into the video is a per-episode switch.
- Update banner when a newer GitHub release exists.

### Engineering
- TypeScript monorepo, 100% test coverage enforced, CLI (`pnpm ys`) next to the Studio.
- MIT license.
