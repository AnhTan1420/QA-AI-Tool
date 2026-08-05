import sharp from 'sharp';

type AnnotationBox = { x: number; y: number; width: number; height: number; label?: string };

/** Draw red bounding boxes on a screenshot using Sharp SVG overlay. */
export async function annotateScreenshot(
  inputPath: string,
  outputPath: string,
  boxes: AnnotationBox[],
): Promise<void> {
  const meta = await sharp(inputPath).metadata();
  const width = meta.width ?? 1280;
  const height = meta.height ?? 720;

  const rects = boxes
    .map(
      (b, i) =>
        `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="none" stroke="red" stroke-width="3"/>
         <text x="${b.x + 4}" y="${Math.max(14, b.y - 6)}" fill="red" font-size="14" font-family="sans-serif">${b.label ?? `Issue ${i + 1}`}</text>`,
    )
    .join('');

  const svg = `<svg width="${width}" height="${height}">${rects}</svg>`;
  await sharp(inputPath)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toFile(outputPath);
}
