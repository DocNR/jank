/** True when enough time has passed since the last programmatic SW update check. */
export function shouldCheckForUpdate(
  lastCheckMs: number,
  nowMs: number,
  minIntervalMs: number
): boolean {
  return nowMs - lastCheckMs >= minIntervalMs
}
