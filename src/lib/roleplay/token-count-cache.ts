/** Keep only exact text counts, bounded by retained UTF-16 characters and entry count. */
export function createTokenCountCache(count: (text: string) => number, maxChars = 500_000, maxEntries = 1024) {
  const entries = new Map<string, number>();
  let chars = 0;
  return {
    clear() { entries.clear(); chars = 0; },
    count(text: string) {
      const cached = entries.get(text);
      if (cached !== undefined) {
        entries.delete(text); entries.set(text, cached);
        return cached;
      }
      const result = count(text);
      if (text.length > maxChars || maxEntries < 1) return result;
      while (entries.size && (chars + text.length > maxChars || entries.size >= maxEntries)) {
        const oldest = entries.keys().next().value!;
        chars -= oldest.length; entries.delete(oldest);
      }
      entries.set(text, result); chars += text.length;
      return result;
    },
  };
}
