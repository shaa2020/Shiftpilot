const HEX = /^#[0-9a-fA-F]{6}$/;

/** Black or white text, whichever reads better on `hex` (WCAG relative luminance). */
export function readableOn(hex: string): "#ffffff" | "#0b1220" {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  // Contrast with white vs. with near-black.
  return (1.05 / (lum + 0.05)) >= ((lum + 0.05) / 0.06) ? "#ffffff" : "#0b1220";
}

/**
 * CSS overriding the theme's primary colour with an agency brand colour, for
 * light and dark mode. Returns "" for anything that is not a #rrggbb colour,
 * so the value can never inject other CSS.
 */
export function brandCss(color: string | null | undefined): string {
  if (!color || !HEX.test(color)) return "";
  const c = color.toLowerCase();
  const fg = readableOn(c);
  return (
    `:root{--primary:${c};--ring:${c};--primary-foreground:${fg};` +
    `--primary-soft:color-mix(in oklab,${c} 14%,#ffffff);--primary-soft-foreground:color-mix(in oklab,${c} 70%,#0b1220)}` +
    `.dark{--primary:${c};--ring:${c};--primary-foreground:${fg};` +
    `--primary-soft:color-mix(in oklab,${c} 22%,#0b1220);--primary-soft-foreground:color-mix(in oklab,${c} 55%,#ffffff)}`
  );
}
