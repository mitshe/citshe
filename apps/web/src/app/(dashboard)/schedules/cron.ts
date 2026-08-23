// Small cron helpers for the schedule dialog — we support the presets the UI
// offers (hourly / daily / weekly / monthly) plus a raw custom expression.
// `describeCron` gives a friendly summary for common shapes and falls back to
// the raw expression for anything else.

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export type CronPreset = "hourly" | "daily" | "weekly" | "monthly" | "custom";

export function cronFromPreset(opts: {
  preset: Exclude<CronPreset, "custom">;
  time: string; // "HH:MM"
  weekday: string; // "0".."6"
  day: string; // "1".."28"
}): string {
  const [h, m] = (opts.time || "08:00").split(":");
  const hour = String(parseInt(h ?? "8", 10) || 0);
  const minute = String(parseInt(m ?? "0", 10) || 0);
  switch (opts.preset) {
    case "hourly":
      return `${minute} * * * *`;
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekly":
      return `${minute} ${hour} * * ${opts.weekday}`;
    case "monthly":
      return `${minute} ${hour} ${opts.day} * *`;
    default:
      return `${minute} ${hour} * * *`;
  }
}

/** Best-effort: turn a stored cron back into preset + fields for the editor. */
export function presetFromCron(cron: string): {
  preset: CronPreset;
  time: string;
  weekday: string;
  day: string;
} {
  const parts = cron.trim().split(/\s+/);
  const fallback = {
    preset: "custom" as CronPreset,
    time: "08:00",
    weekday: "1",
    day: "1",
  };
  if (parts.length !== 5) return fallback;
  const [min, hour, dom, mon, dow] = parts;
  const time = `${pad(hour)}:${pad(min)}`;
  const numeric = (v: string) => /^\d+$/.test(v);

  if (mon === "*") {
    if (hour === "*" && dom === "*" && dow === "*" && numeric(min)) {
      return { ...fallback, preset: "hourly" };
    }
    if (numeric(min) && numeric(hour)) {
      if (dom === "*" && dow === "*") {
        return { preset: "daily", time, weekday: "1", day: "1" };
      }
      if (dom === "*" && numeric(dow)) {
        return { preset: "weekly", time, weekday: dow, day: "1" };
      }
      if (numeric(dom) && dow === "*") {
        return { preset: "monthly", time, weekday: "1", day: dom };
      }
    }
  }
  return fallback;
}

export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;
  const numeric = (v: string) => /^\d+$/.test(v);
  const at = () => `${pad(hour)}:${pad(min)}`;

  if (mon === "*") {
    if (hour === "*" && dom === "*" && dow === "*" && numeric(min)) {
      return min === "0" ? "Every hour" : `Every hour at :${pad(min)}`;
    }
    if (numeric(min) && numeric(hour)) {
      if (dom === "*" && dow === "*") return `Every day at ${at()}`;
      if (dom === "*" && numeric(dow)) {
        return `Every ${DAY_NAMES[parseInt(dow, 10) % 7]} at ${at()}`;
      }
      if (numeric(dom) && dow === "*") {
        return `Monthly on day ${dom} at ${at()}`;
      }
    }
  }
  return cron;
}

function pad(v: string): string {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? v : String(n).padStart(2, "0");
}
