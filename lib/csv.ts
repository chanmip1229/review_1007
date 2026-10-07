export interface ParsedReview {
  review_no: number;
  written_on: string;
  rating: number;
  review_text: string;
}

/**
 * RFC 4180 compliant CSV line parser that handles quoted fields containing commas.
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseReviewCsv(rawText: string): ParsedReview[] {
  const cleaned = rawText.replace(/^\uFEFF/, "").trim();
  if (!cleaned) return [];

  const lines = cleaned.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  // Check if first row is header (e.g., 번호,작성일,별점,리뷰)
  let startIndex = 0;
  const firstCols = parseCsvLine(lines[0]);
  if (
    firstCols[0] === "번호" ||
    firstCols[0]?.toLowerCase() === "review_no" ||
    isNaN(Number(firstCols[0]))
  ) {
    startIndex = 1;
  }

  const parsed: ParsedReview[] = [];
  for (let i = startIndex; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 4) continue;

    const reviewNo = Number(cols[0]);
    const writtenOn = cols[1];
    const rating = Number(cols[2]);
    // In case an unquoted comma slipped into the review text, join remaining columns
    const reviewText =
      cols.length === 4 ? cols[3] : cols.slice(3).join(", ");

    if (isNaN(reviewNo) || !reviewText) continue;

    parsed.push({
      review_no: reviewNo,
      written_on: writtenOn,
      rating: isNaN(rating) ? 0 : rating,
      review_text: reviewText,
    });
  }

  return parsed;
}
