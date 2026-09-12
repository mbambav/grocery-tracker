// Heuristic receipt-text parsing. Receipts vary wildly by store, so this is
// deliberately conservative: it surfaces candidates for a human to confirm,
// not a confident final answer. Never wire this straight into `purchases`.

const SKIP_PATTERNS = [
  /\btotal\b/i, /\bsub ?total\b/i, /\btax\b/i, /\bcash\b/i, /\bchange\b/i,
  /\bdebit\b/i, /\bcredit\b/i, /\bvisa\b/i, /\bmastercard\b/i, /\bamex\b/i,
  /\bauth\b/i, /\bref\s*#/i, /\bbalance\b/i, /\bcard\b/i, /\bapproved\b/i,
  /\bchange due\b/i, /\bsavings\b/i, /\bmember\b/i, /\bstore\s*#/i,
  /\bthank you\b/i, /\bsurvey\b/i, /\breturn policy\b/i, /\bcashier\b/i,
  /\bitems? sold\b/i, /\bqty\b.*\btotal\b/i,
];

// A "price" is digits.digits, optionally with a leading $, at (or near) end of line.
const PRICE_RE = /\$?\s?(\d{1,4}\.\d{2})\s*$/;

// Quantity hints like "2 @ 1.99" or "QTY 3" or a leading "3 x".
const QTY_RE = /(?:^|\s)(\d+(?:\.\d+)?)\s*(?:@|x|X|ea\b|qty)/;

export function parseReceiptLines(rawText) {
  const lines = rawText
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);

  const candidates = [];
  for (const rawLine of lines) {
    if (SKIP_PATTERNS.some(re => re.test(rawLine))) continue;

    // Some registers append a single tax-category letter after the price
    // (e.g. "EGGS LARGE DZ  4.29 T"). Strip it before looking for the price.
    const line = rawLine.replace(/(\d\.\d{2})\s+[A-Z]{1,2}$/, '$1');

    const priceMatch = line.match(PRICE_RE);
    if (!priceMatch) continue;
    const price = Number(priceMatch[1]);
    if (!price || price <= 0) continue;

    let name = line.slice(0, priceMatch.index).trim();
    // Strip a leading product code (common on grocery receipts: "004123 BANANAS").
    name = name.replace(/^\d{4,}\s+/, '');
    if (!name) continue;

    const qtyMatch = line.match(QTY_RE);
    const quantity = qtyMatch ? Number(qtyMatch[1]) : 1;

    candidates.push({ rawLine, name, price, quantity });
  }
  return candidates;
}

const DATE_PATTERNS = [
  /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/, // 09/12/2026 or 9-12-26
];

/** Best-effort guess at the receipt's date. Returns an ISO yyyy-mm-dd string, or null. */
export function parseReceiptDate(rawText) {
  for (const re of DATE_PATTERNS) {
    const m = rawText.match(re);
    if (!m) continue;
    let [, mo, day, yr] = m;
    if (yr.length === 2) yr = Number(yr) < 70 ? `20${yr}` : `19${yr}`;
    const mm = String(mo).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const candidate = `${yr}-${mm}-${dd}`;
    const d = new Date(candidate);
    if (!isNaN(d) && d.getFullYear() > 2000 && d <= new Date(Date.now() + 86400000)) {
      return candidate;
    }
  }
  return null;
}
