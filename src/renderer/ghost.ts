// The Wispr Max mascot: a tiny pixel ghost, drawn from a pixel grid so it stays
// crisp at any size. O = outline, W = body, L = light shade, M = mid shade.
const BODY = [
  "......OOOOOO......",
  "....OOWWWWWWOO....",
  "...OWWWWWWWWWWO...",
  "..OLWWWWWWWWWWWO..",
  ".OLWWWWWWWWWWWWWO.",
  ".OLWWWWWWWWWWWWWO.",
  "OLWWWWWWWWWWWWWWWO",
  "OLWWWWWWWWWWWWWWWO",
  "OLWWWWWWWWWWWWWWWO",
  "OLWWWWWWWWWWWWWWWO",
  "OLWWWWWWWWWWWWWWWO",
  "OLWWWWWWWWWWWWWWWO",
  "OLWWWWWWWWWWWWWWWO",
  "OLLWWWWWWWWWWWWWLO",
  "OLLLWWWWWWWWWWWLLO",
  "OMLLLWWWWWWWWLLLLO",
  "OMMLLLLLLLLLLLLLMO",
  "OMMMLLLLLLLLLLLMMO",
  "OMMMOLLLLLLLLOMMMO",
  ".OOO.OMMMMMMO.OOO.",
  "......OOOOOO......",
];

export const GHOST_WIDTH = 18;
export const GHOST_HEIGHT = 21;

export const GHOST_COLORS = { O: "#4b6f6c", W: "#ffffff", L: "#d7dfe2", M: "#b5c3c8" };

export type Eyes = "center" | "right" | "left" | "closed" | "happy";

// [col, row, width, height] in grid pixels, all in the outline colour.
const EYES: Record<Eyes, [number, number, number, number][]> = {
  center: [[6, 8, 1, 4], [11, 8, 1, 4]],
  right: [[9, 8, 1, 4], [14, 8, 1, 4]],
  left: [[3, 8, 1, 4], [8, 8, 1, 4]],
  closed: [[4, 11, 3, 1], [11, 11, 3, 1]],
  happy: [[6, 9, 1, 1], [5, 10, 1, 1], [7, 10, 1, 1], [11, 9, 1, 1], [10, 10, 1, 1], [12, 10, 1, 1]],
};

const rect = (x: number, y: number, w: number, h: number, fill: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

function bodyRects(colors: Record<string, string>): string {
  let out = "";
  BODY.forEach((row, y) => {
    // Merge horizontal runs of one colour to keep the SVG small.
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      let end = x;
      while (row[end + 1] === c) end++;
      if (c !== ".") out += rect(x, y, end - x + 1, 1, colors[c]);
      x = end + 1;
    }
  });
  return out;
}

export interface GhostOptions {
  /** Which eyes to draw. Omit to include every set, switchable with `data-eyes` in CSS. */
  eyes?: Eyes;
  colors?: Partial<typeof GHOST_COLORS>;
  className?: string;
  /** Extra SVG drawn under the ghost, in grid units (for icon backgrounds). */
  padding?: number;
}

export function ghostSvg(opts: GhostOptions = {}): string {
  const colors = { ...GHOST_COLORS, ...opts.colors };
  const pad = opts.padding ?? 0;
  const eyeSets = (opts.eyes ? [opts.eyes] : (Object.keys(EYES) as Eyes[]))
    .map(
      (e) =>
        `<g class="eyes" data-e="${e}">${EYES[e].map(([x, y, w, h]) => rect(x, y, w, h, colors.O)).join("")}</g>`,
    )
    .join("");
  return `<svg class="${opts.className ?? "ghost"}" xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${GHOST_WIDTH + pad * 2} ${GHOST_HEIGHT + pad * 2}" shape-rendering="crispEdges"><g class="body">${bodyRects(colors)}</g>${eyeSets}</svg>`;
}
