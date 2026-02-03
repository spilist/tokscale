/**
 * Format a Date to "YYYY-MM-DD" using the **local** timezone.
 *
 * Unlike `date.toISOString().split("T")[0]` which always uses UTC,
 * this uses `getFullYear/getMonth/getDate` so the result matches
 * the user's wall-clock date.
 */
export function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
