const graphemes = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, {granularity:"grapheme"}) : undefined;

/** Reveal received text over a few frames, without delaying an unbounded backlog. */
export function streamFrame(text: string, shown: string) {
  if (!text.startsWith(shown)) shown = "";
  const rest = text.slice(shown.length);
  if (!rest) return { value: shown, pending: false };
  const count = Math.max(2, Math.ceil(Array.from(rest).length / 2));
  const chars = graphemes ? Array.from(graphemes.segment(rest), item => item.segment) : Array.from(rest);
  const value = shown + chars.slice(0, count).join("");
  return { value, pending: value.length < text.length };
}
