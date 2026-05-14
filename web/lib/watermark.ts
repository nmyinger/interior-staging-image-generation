import sharp from "sharp";

export interface MlsWatermarkRule {
  text: string;
  position:
    | "north"
    | "south"
    | "east"
    | "west"
    | "northeast"
    | "northwest"
    | "southeast"
    | "southwest"
    | "center";
  sizePct: number; // fraction of image width, e.g. 0.022
  opacity: number; // 0-1
  color?: string; // default "#FFFFFF"
  bgColor?: string; // default "rgba(0,0,0,0.5)"
}

export async function applyWatermark(
  imageBuffer: Buffer,
  rule: MlsWatermarkRule,
  brandText?: string, // photographer's brand name (optional second line)
): Promise<Buffer> {
  const img = sharp(imageBuffer);
  const { width = 1200 } = await img.metadata();

  const fontSize = Math.max(12, Math.round(width * rule.sizePct));
  const padding = Math.round(fontSize * 0.6);

  // Build SVG watermark
  const lines = [rule.text];
  if (brandText) lines.push(brandText);

  const lineHeight = fontSize + 4;
  const svgHeight = lines.length * lineHeight + padding * 2;

  // Estimate text width (rough approximation: 0.6 * fontSize * chars)
  const maxChars = Math.max(...lines.map((l) => l.length));
  const svgWidth = Math.round(maxChars * fontSize * 0.6) + padding * 2;

  const textElements = lines
    .map(
      (line, i) =>
        `<text x="${svgWidth / 2}" y="${padding + i * lineHeight + fontSize}" ` +
        `font-family="Arial, sans-serif" font-size="${fontSize}" ` +
        `fill="${rule.color ?? "#FFFFFF"}" text-anchor="middle" font-weight="600" ` +
        `stroke="#000" stroke-width="0.5">${escapeXml(line)}</text>`,
    )
    .join("\n");

  const svg = `<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${svgWidth}" height="${svgHeight}" fill="${rule.bgColor ?? "rgba(0,0,0,0.5)"}" rx="4"/>
    ${textElements}
  </svg>`;

  // Map position string to sharp gravity
  const gravityMap: Record<string, sharp.Gravity> = {
    north: "north",
    south: "south",
    east: "east",
    west: "west",
    northeast: "northeast",
    northwest: "northwest",
    southeast: "southeast",
    southwest: "southwest",
    center: "center",
  };

  return img
    .composite([
      {
        input: Buffer.from(svg),
        gravity: gravityMap[rule.position] ?? "south",
      },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
