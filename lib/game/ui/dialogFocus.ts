/** Return a wrap target, or null to let the browser move within the dialog. */
export function dialogFocusTarget<T>(
  focusable: readonly T[],
  active: T | null,
  backward: boolean,
): T | null {
  if (!focusable.length) return null;
  const index = active === null ? -1 : focusable.indexOf(active);
  if (index < 0) return backward ? focusable[focusable.length - 1] : focusable[0];
  if (backward && index === 0) return focusable[focusable.length - 1];
  if (!backward && index === focusable.length - 1) return focusable[0];
  return null;
}

export function trapDialogTab(
  event: {
    key: string;
    shiftKey: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    preventDefault(): void;
  },
  panel: HTMLElement | null,
) {
  if (
    event.key !== "Tab" ||
    !panel ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  ) return;
  const candidates = Array.from(panel.querySelectorAll<HTMLElement>(
    "button, a[href], input, select, textarea, [tabindex]",
  )).filter((element) =>
    element.tabIndex >= 0 &&
    !element.matches(":disabled") &&
    !element.closest("[hidden], [inert]") &&
    element.getClientRects().length > 0,
  );
  const target = dialogFocusTarget(candidates, document.activeElement, event.shiftKey);
  if (target) {
    event.preventDefault();
    (target as HTMLElement).focus();
  } else if (!candidates.length) {
    event.preventDefault();
  }
}
