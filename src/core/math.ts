export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function angDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export function swapRemove<T>(arr: T[], i: number): void {
  arr[i] = arr[arr.length - 1];
  arr.pop();
}
export const fmtTime = (t: number) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
export const roman = (n: number) => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][clamp(n - 1, 0, 11)];
export const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
