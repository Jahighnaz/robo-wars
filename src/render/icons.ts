// Block glyphs as SVG path data (24×24, stroked). Shared by the canvas sprites
// (via Path2D) and the DOM UI (inline SVG), so the garage and the run match.
export const ICONS: Record<string, string> = {
  cab: 'M12 3L20 8V16L12 21L4 16V8Z M12 8L16 10.5V14L12 16.5L8 14V10.5Z',
  wheel: 'M12 4a8 8 0 1 0 0.01 0Z M12 9.5a2.5 2.5 0 1 0 0.01 0Z M12 4V9.5 M12 14.5V20 M4 12H9.5 M14.5 12H20',
  track: 'M7 3H17V21H7Z M7 7.5H17 M7 12H17 M7 16.5H17',
  hover: 'M4 13a8 4 0 1 0 16 0a8 4 0 1 0 -16 0Z M8.5 13a3.5 1.6 0 1 0 7 0a3.5 1.6 0 1 0 -7 0Z M12 3V7 M8 5L9.5 7.5 M16 5L14.5 7.5',
  armor: 'M12 3L19 6V12C19 16 16 19 12 21C8 19 5 16 5 12V6Z M12 7V17',
  regen: 'M5 19C5 10 11 5 19 5C19 13 14 19 5 19Z M5 19L13 11',
  cannon: 'M10 2H14V12H10Z M6 12H18V21H6Z M9 16.5H15',
  shotgun: 'M12 12L6.5 2.5 M12 12V2 M12 12L17.5 2.5 M6 12H18V21H6Z',
  laser: 'M12 2L15 8L12 12L9 8Z M7 12H17V21H7Z M12 15V18',
  tesla: 'M13 2L5 13H11L10 22L19 10H13Z',
  flamer: 'M12 2C15 7 18 9 18 14A6 6 0 0 1 6 14C6 10 9 9 9 6C11 8 12 7 12 2Z M12 12C13.5 14 14 15 14 16A2 2 0 0 1 10 16C10 15 11 14 12 12Z',
  mortar: 'M12 3.5a5 5 0 1 0 0.01 0Z M5 21L9 12.5 M19 21L15 12.5 M6 21H18',
  battery: 'M7 5H17V21H7Z M10 2H14V5H10Z M12 9.5V16.5 M8.5 13H15.5',
  magnet: 'M6 4V12A6 6 0 0 0 18 12V4H14V12A2 2 0 0 1 10 12V4Z M6 7.5H10 M14 7.5H18',
  repair: 'M14.5 3A5 5 0 0 0 9.3 9.6L3 15.9L6.1 19L12.4 12.7A5 5 0 0 0 19 7.5L16 9L14.5 7.5L16 4.5Z',
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
