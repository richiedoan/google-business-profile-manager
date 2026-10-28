import { defaultRangeExtractor, type Range } from "@tanstack/react-virtual";

// Keep the focused row and adjacent keyboard targets mounted while scrolling.
export function locationVirtualRange(range: Range, focusedIndex: number) {
  const indices = new Set(defaultRangeExtractor(range));
  if (focusedIndex >= 0 && focusedIndex < range.count) {
    for (
      let index = Math.max(0, focusedIndex - 1);
      index <= Math.min(range.count - 1, focusedIndex + 1);
      index++
    ) {
      indices.add(index);
    }
  }
  return [...indices].sort((a, b) => a - b);
}
