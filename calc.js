import { categoryDefault } from './defaults.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function toDateOnly(d) {
  // Bare "YYYY-MM-DD" strings (from <input type="date">, or our own settings)
  // must be parsed as LOCAL calendar dates, not UTC. new Date("2026-09-12")
  // parses as UTC midnight, and .getDate() reads it back in local time — for
  // anyone west of UTC that silently returns the previous day. Parsing the
  // components ourselves avoids that shift entirely.
  if (typeof d === 'string') {
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const dt = new Date(d);
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

export function daysBetween(a, b) {
  return Math.round((toDateOnly(b) - toDateOnly(a)) / DAY_MS);
}

export function addDays(d, n) {
  const dt = toDateOnly(d);
  dt.setDate(dt.getDate() + n);
  return dt;
}

/**
 * Compute the [start, end) boundary of the "current" period containing `today`,
 * given a period type and an anchor date the periods are counted from.
 */
export function getPeriodBounds(settings, today = new Date()) {
  const anchor = toDateOnly(settings.periodAnchorDate);
  const t = toDateOnly(today);

  if (settings.periodType === 'monthly') {
    // Periods are calendar months starting on the anchor's day-of-month.
    const anchorDay = anchor.getDate();
    let start = new Date(t.getFullYear(), t.getMonth(), Math.min(anchorDay, daysInMonth(t.getFullYear(), t.getMonth())));
    if (start > t) {
      start = new Date(t.getFullYear(), t.getMonth() - 1, Math.min(anchorDay, daysInMonth(t.getFullYear(), t.getMonth() - 1)));
    }
    const nextMonth = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const end = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), Math.min(anchorDay, daysInMonth(nextMonth.getFullYear(), nextMonth.getMonth())));
    return { start, end };
  }

  const lengthDays = settings.periodType === 'weekly' ? 7 : 14;
  const diff = Math.floor((t - anchor) / DAY_MS);
  const periodsElapsed = Math.floor(diff / lengthDays);
  const start = addDays(anchor, periodsElapsed * lengthDays);
  const end = addDays(start, lengthDays);
  return { start, end };
}

/**
 * Bounds for the period `offset` steps away from the current one (0 = current,
 * -1 = previous, +1 = next). Uses real month arithmetic for monthly periods so
 * navigation doesn't drift when months have different lengths.
 */
export function getPeriodBoundsAtOffset(settings, offset, today = new Date()) {
  const current = getPeriodBounds(settings, today);

  if (settings.periodType === 'monthly') {
    const anchorDay = toDateOnly(settings.periodAnchorDate).getDate();
    const y = current.start.getFullYear();
    const m = current.start.getMonth() + offset;
    const start = new Date(y, m, Math.min(anchorDay, daysInMonth(y, m)));
    const end = new Date(y, m + 1, Math.min(anchorDay, daysInMonth(y, m + 1)));
    return { start, end };
  }

  const lengthDays = settings.periodType === 'weekly' ? 7 : 14;
  return {
    start: addDays(current.start, offset * lengthDays),
    end: addDays(current.end, offset * lengthDays),
  };
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/** Multi-person budget scaling: diminishing marginal cost per added person. */
export function scaledBudget(baseAmount, numPeople, marginalFactor) {
  const n = Math.max(1, numPeople || 1);
  return baseAmount * (1 + marginalFactor * (n - 1));
}

/** The budget that applies to the given [start,end) period. */
export function periodBudget(settings, numPeople) {
  const base = scaledBudget(settings.budgetAmount, numPeople, settings.marginalFactor ?? 0.6);
  if (settings.periodType === settings.budgetInputType) return base;
  // Convert a budget expressed in one cadence into the cadence being displayed.
  const toDays = { weekly: 7, biweekly: 14, monthly: 30.4375 };
  const perDay = base / toDays[settings.budgetInputType];
  return perDay * toDays[settings.periodType];
}

export function purchasesInRange(purchases, start, end) {
  return purchases.filter(p => {
    const d = toDateOnly(p.date);
    return d >= start && d < end;
  });
}

export function totalSpend(purchases) {
  return purchases.reduce((sum, p) => sum + (Number(p.price) || 0), 0);
}

/**
 * Simple run-rate projection: spend-so-far / elapsed-days * total-days-in-period.
 * Returns null if there isn't enough elapsed time yet to project from.
 */
export function projectedSpend(purchasesInPeriod, start, end, today = new Date()) {
  const t = toDateOnly(today);
  const elapsedDays = Math.max(1, daysBetween(start, t));
  const totalDays = Math.max(1, daysBetween(start, end));
  if (t < start || t >= end) return null;
  const spentSoFar = totalSpend(purchasesInPeriod);
  const dailyRate = spentSoFar / elapsedDays;
  return {
    spentSoFar,
    projectedTotal: dailyRate * totalDays,
    elapsedDays,
    totalDays,
  };
}

/**
 * Infer how long an item actually lasts for this household from real purchase
 * history: prefers explicit finishedDate - purchaseDate gaps, falls back to
 * gaps between consecutive purchase dates of the same item.
 */
export function inferLastingDays(item, purchases) {
  const history = purchases
    .filter(p => p.itemId === item.id)
    .sort((a, b) => toDateOnly(a.date) - toDateOnly(b.date));

  const explicitGaps = history
    .filter(p => p.finishedDate)
    .map(p => daysBetween(p.date, p.finishedDate))
    .filter(n => n > 0);

  if (explicitGaps.length > 0) {
    return { days: average(explicitGaps), source: 'logged', samples: explicitGaps.length };
  }

  if (history.length >= 2) {
    const gaps = [];
    for (let i = 1; i < history.length; i++) {
      gaps.push(daysBetween(history[i - 1].date, history[i].date));
    }
    return { days: average(gaps), source: 'inferred', samples: gaps.length };
  }

  const fallback = item.shelfLifeDays || categoryDefault(item.category).shelfLifeDays;
  return { days: fallback, source: 'default', samples: 0 };
}

function average(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** When should this item be bought next, and roughly how much? */
export function nextBuyEstimate(item, purchases) {
  const history = purchases
    .filter(p => p.itemId === item.id)
    .sort((a, b) => toDateOnly(b.date) - toDateOnly(a.date));

  const lasting = inferLastingDays(item, purchases);
  if (history.length === 0) {
    return { nextBuyDate: null, lastingDays: lasting.days, source: lasting.source, avgQuantity: null };
  }
  const last = history[0];
  const nextBuyDate = addDays(last.date, Math.round(lasting.days));
  const avgQuantity = average(history.map(p => Number(p.quantity) || 0));
  return { nextBuyDate, lastingDays: lasting.days, source: lasting.source, avgQuantity, lastPurchase: last };
}

export function fmtMoney(n) {
  return `$${(Number(n) || 0).toFixed(2)}`;
}

export function fmtDate(d) {
  if (!d) return '—';
  return toDateOnly(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}