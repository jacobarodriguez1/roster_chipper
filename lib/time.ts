export function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(":").map((v) => Number(v));
  return h * 60 + m;
}

export function minutesToHhmm(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (totalMinutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}
