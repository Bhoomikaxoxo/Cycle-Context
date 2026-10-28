// Simulates raw speech-recognition output: lowercase, no sentence punctuation.
// Keeps apostrophes (haven't) and digit separators (10/2, 10-2, 3:30) because
// browser transcripts keep those.
export function toSpeech(text) {
  return text
    .toLowerCase()
    .replace(/(?<!\d)[.,;:!?"()]|[.,;:!?"()](?!\d)/g, " ") // drop punctuation unless between digits
    .replace(/\s+/g, " ")
    .trim();
}
