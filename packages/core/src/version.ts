/**
 * Sürüm numaraları (semver, "v" önekli ya da öneksiz). Tek kaynak kök package.json; release betiği artırır,
 * Stüdyo GitHub'daki son release ile karşılaştırıp güncelleme uyarısı gösterir.
 */
export type Bump = "major" | "minor" | "patch";

export function parseVersion(v: string): [number, number, number] | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/** a > b ise pozitif, eşitse 0; geçersiz sürüm en küçük sayılır (uyarı yanlışlıkla çıkmasın diye). */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}

export function bumpVersion(v: string, bump: Bump): string {
  const p = parseVersion(v);
  if (!p) throw new Error(`Geçersiz sürüm: ${v}`);
  const [major, minor, patch] = p;
  return bump === "major" ? `${major + 1}.0.0` : bump === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}
