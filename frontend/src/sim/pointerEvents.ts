const bodyPointerEvents = new WeakSet<PointerEvent>();

export function markBodyPointerEvent(event: PointerEvent): void {
  bodyPointerEvents.add(event);
}

export function isBodyPointerEvent(event: PointerEvent): boolean {
  return bodyPointerEvents.has(event);
}
