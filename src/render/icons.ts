// Block glyphs as SVG path data (24×24, stroked). Shared by the canvas sprites
// (via Path2D) and the DOM UI (inline SVG), so the garage and the run match.
export const ICONS: Record<string, string> = {
  cab: 'M5 4H19V20H5Z M8 7H16V11H8Z M8 15H10 M14 15H16',
  wheel: 'M7 3H17 M12 3V7 M12 7a6 6 0 1 0 0.01 0Z M12 11.5a1.5 1.5 0 1 0 0.01 0Z',
  track: 'M7 3H17V21H7Z M7 7.5H17 M7 12H17 M7 16.5H17',
  hover: 'M4 13a8 4 0 1 0 16 0a8 4 0 1 0 -16 0Z M8.5 13a3.5 1.6 0 1 0 7 0a3.5 1.6 0 1 0 -7 0Z M12 3V7 M8 5L9.5 7.5 M16 5L14.5 7.5',
  armor: 'M4 4H20V20H4Z M7.5 7.5H7.6 M16.4 7.5H16.5 M7.5 16.5H7.6 M16.4 16.5H16.5',
  regen: 'M12 4a8 8 0 1 0 0.01 0Z M12 9a3 3 0 1 0 0.01 0Z M20 12V20H14',
  cannon: 'M10 2H14V4H10Z M8 4H16V13H8Z M8 8H16 M10 13H14V21H10Z M14 15H17V19H14',
  shotgun: 'M12 2L14 5L17.5 3.6L17.8 7.2L21.4 8L19.6 11.2L22 13.8L18.6 15.2L19 18.8L15.4 18.4L13.8 21.8L11.4 19L8.4 21.4L7.8 17.8L4.2 17.4L5.6 14L2.6 11.6L5.8 9.8L5.2 6.2L8.8 6.6Z M12 9.5a2.5 2.5 0 1 0 0.01 0Z',
  laser: 'M12 1.5V7 M8 7H16V15H8Z M10 15H14V21H10Z M5 3.5L7.5 6 M19 3.5L16.5 6',
  tesla: 'M13 2L6 12H11L10 20L18 9H13Z M4 22H20',
  flamer: 'M11 1.5H13V5H11Z M7 5H17V12H7Z M10 12H14V21H10Z M17 8.5H20.5V10.5H17',
  mortar: 'M11 2H13V6H11Z M8 6H16V12H8Z M10 12H14V17H10Z M12 17V22 M7 2.5L9 5 M17 2.5L15 5',
  battery: 'M7 5H17V21H7Z M10 2H14V5H10Z M10 13L12.5 9V12.5H14L11.5 17V13.5H10',
  magnet: 'M6 4V12A6 6 0 0 0 18 12V4H14V12A2 2 0 0 1 10 12V4Z M6 7.5H10 M14 7.5H18',
  repair: 'M4 6H14V10H4Z M14 7H20V9H14 M6 10V18H12V15 M9 18V21',
};

const paths = new Map<string, Path2D>();
export function iconPath(t: string): Path2D {
  let p = paths.get(t);
  if (!p) { p = new Path2D(ICONS[t] || ICONS.cab); paths.set(t, p); }
  return p;
}

export function iconSvg(t: string, color: string, size = 24, rot = 0): string {
  const tr = rot ? ` style="transform:rotate(${rot}deg)"` : '';
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24"${tr} fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="${ICONS[t] || ICONS.cab}"/></svg>`;
}
