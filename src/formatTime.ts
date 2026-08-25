// Every timestamp this app shows a person is a local wall clock in 24-hour form. Stored values stay
// as they are -- epoch ms in the event log, UTC ISO strings in snapshots and checkpoints -- because
// they are compared and sorted; only the rendering moves to local time.
function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

export function formatLocalTimestamp(value: number | Date, options: { millis?: boolean } = {}): string {
  const date = value instanceof Date ? value : new Date(value);
  const stamp =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return options.millis ? `${stamp}.${pad(date.getMilliseconds(), 3)}` : stamp;
}

/** `YYYY-MM-DD-HH-mm-ss` in local time, for filenames that must match what the file says inside. */
export function localFilenameStamp(value: number | Date): string {
  return formatLocalTimestamp(value).replace(/[ :]/g, '-');
}

// A file that leaves this machine (an export, a debug bundle) carries the offset once in its header,
// so a local wall clock is still readable by whoever receives it.
export function localTimezoneLabel(value: number | Date = Date.now()): string {
  const date = value instanceof Date ? value : new Date(value);
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  return `UTC${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}
