export const MAX_WORKER_TEXT_LENGTH = 100_000;

export interface TextAnalysis {
  readonly characters: number;
  readonly words: number;
  readonly lines: number;
  readonly uniqueWords: number;
  readonly topTerms: readonly { readonly term: string; readonly count: number }[];
}

export const analyzeText = (text: string): TextAnalysis => {
  if (text.length > MAX_WORKER_TEXT_LENGTH) {
    throw new Error(`Worker input exceeds ${MAX_WORKER_TEXT_LENGTH} characters.`);
  }
  const words =
    text
      .normalize("NFKC")
      .toLocaleLowerCase("en-US")
      .match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  const topTerms = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([term, count]) => ({ term, count }));
  return {
    characters: [...text].length,
    words: words.length,
    lines: text.length === 0 ? 0 : text.split(/\r?\n/u).length,
    uniqueWords: counts.size,
    topTerms,
  };
};
