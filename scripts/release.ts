/**
 * Release: `pnpm release [patch|minor|major] [--publish] [--dry-run]`
 *
 * 1. main dalında ve temiz çalışma ağacında olunmalı; typecheck ve testler geçmeli.
 * 2. Kök package.json sürümü artırılır, CHANGELOG.md başına son etiketten bu yana commit başlıkları eklenir.
 * 3. "Release vX.Y.Z" commit'i ve vX.Y.Z etiketi oluşturulur.
 * 4. --publish verilirse main ve etiket push edilir, GitHub release'i (gh) açılır. Stüdyo güncelleme uyarısını
 *    bu release'ten okur. --publish olmadan hiçbir şey dışarı gönderilmez.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bumpVersion, type Bump } from "../packages/core/src/version.ts";

const args = process.argv.slice(2);
const bump = (args.find((a) => !a.startsWith("--")) ?? "patch") as Bump;
const publish = args.includes("--publish");
const dryRun = args.includes("--dry-run");
if (!["patch", "minor", "major"].includes(bump)) fail(`Bilinmeyen artırma: ${bump} (patch | minor | major)`);

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}
const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" }).trim();
function run(command: string) {
  console.log(`$ ${command}`);
  const r = spawnSync(command, { stdio: "inherit", shell: true });
  if (r.status !== 0) fail(`${command} başarısız`);
}

if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") fail("Release yalnız main dalından çıkar.");
if (git("status", "--porcelain")) fail("Çalışma ağacı temiz değil: önce commit et.");

const pkgPath = "package.json";
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
const current = pkg.version ?? "0.0.0";
const next = bumpVersion(current, bump);
const tag = `v${next}`;
if (git("tag", "--list", tag)) fail(`${tag} etiketi zaten var.`);

let lastTag = "";
try {
  lastTag = git("describe", "--tags", "--abbrev=0");
} catch {
  // İlk release: tüm geçmiş.
}
const subjects = git("log", "--no-merges", "--format=%s", ...(lastTag ? [`${lastTag}..HEAD`] : []))
  .split("\n")
  .filter((s) => s && !/^Release v\d/.test(s));
if (!subjects.length) fail(`${lastTag} etiketinden bu yana yeni commit yok.`);

const date = new Date().toISOString().slice(0, 10);
const notes = subjects.map((s) => `- ${s}`).join("\n");
const section = `## ${tag} (${date})\n\n${notes}\n`;
console.log(`${current} → ${next}${lastTag ? ` (${lastTag} sonrası ${subjects.length} commit)` : ""}\n\n${section}`);
if (dryRun) process.exit(0);

run("pnpm typecheck");
run("pnpm test");

pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
const changelogPath = "CHANGELOG.md";
let changelog = "# Değişiklik günlüğü\n\nSürümler `pnpm release` ile çıkar; Stüdyo GitHub'daki son release'i görünce güncelleme uyarısı gösterir.\n";
try {
  changelog = readFileSync(changelogPath, "utf8");
} catch {
  // İlk release: dosya oluşturulur.
}
const [head, ...rest] = changelog.split(/\n(?=## v)/);
writeFileSync(changelogPath, [head!.trimEnd() + "\n", section, ...rest.map((r) => r.trimEnd() + "\n")].join("\n"));

git("add", pkgPath, changelogPath);
git("commit", "-m", `Release ${tag}`);
git("tag", "-a", tag, "-m", `Release ${tag}`);
console.log(`✓ ${tag} commit'i ve etiketi oluşturuldu.`);

if (!publish) {
  console.log(`Yayınlamak için: git push origin main --follow-tags && gh release create ${tag} --title ${tag} --notes-from-tag\n(ya da bir dahaki sefere: pnpm release ${bump} --publish)`);
  process.exit(0);
}
run("git push origin main --follow-tags");
const notesFile = join(mkdtempSync(join(tmpdir(), "ys-release-")), "notes.md");
writeFileSync(notesFile, notes + "\n");
execFileSync("gh", ["release", "create", tag, "--title", tag, "--notes-file", notesFile], { stdio: "inherit" });
console.log(`✓ ${tag} yayınlandı.`);
