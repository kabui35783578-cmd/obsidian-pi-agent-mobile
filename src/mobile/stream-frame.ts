const graphemes = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, {granularity:"grapheme"}) : undefined;

/** Reveal received text over a few frames, without delaying an unbounded backlog. */
export function streamFrame(text: string, shown: string) {
  if (!text.startsWith(shown)) shown = "";
  const rest = text.slice(shown.length);
  if (!rest) return { value: shown, pending: false };
  // Find the boundary near the middle without walking or allocating the whole backlog.
  let end = Math.min(rest.length, Math.max(2, Math.ceil(rest.length / 2)));
  const segment = graphemes?.segment(rest).containing(end - 1);
  if (segment) end = segment.index + segment.segment.length;
  else if (rest.charCodeAt(end) >= 0xdc00 && rest.charCodeAt(end) <= 0xdfff) end++;
  const value = shown + rest.slice(0, end);
  return { value, pending: value.length < text.length };
}
