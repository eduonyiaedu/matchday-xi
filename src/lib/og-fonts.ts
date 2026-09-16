// Shared by every server-side ImageResponse (next/og / satori) renderer in the app — the share
// card route and the admin metrics chart-image generator for exports.
//
// next/og's ImageResponse (satori) has no built-in fallback font on the Node runtime — without an
// explicit `fonts` array it has no metrics to lay text out with at all, which doesn't error, it
// just collapses every text box to ~zero height and stacks them on top of each other. Fetched once
// per server instance and reused (module-level cache), same technique satori's own docs recommend
// for pulling a specific static weight from Google Fonts (the CSS endpoint serves woff2 to a
// modern UA, but satori needs ttf/otf — spoofing an old UA gets the ttf link instead).
let fontsPromise: Promise<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }[]> | null = null;

export function loadOgFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all([loadGoogleFont("Inter", 400), loadGoogleFont("Inter", 700)]).then(
      ([regular, bold]) => [
        { name: "Inter", data: regular, weight: 400 as const, style: "normal" as const },
        { name: "Inter", data: bold, weight: 700 as const, style: "normal" as const },
      ],
    );
  }
  return fontsPromise;
}

async function loadGoogleFont(family: string, weight: number): Promise<ArrayBuffer> {
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${family}:wght@${weight}`, {
    headers: {
      // A legacy UA gets a ttf/otf @font-face src back instead of woff2 — satori can't parse woff2.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.34 (KHTML, like Gecko) Chrome/9.0.601.0 Safari/534.34",
    },
  }).then((r) => r.text());
  const match = css.match(/src: url\(([^)]+)\)/);
  if (!match) throw new Error(`Could not resolve a font URL for ${family} ${weight}`);
  return fetch(match[1]).then((r) => r.arrayBuffer());
}
