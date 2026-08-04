"use client";

import { useCallback, useState } from "react";

export interface Disclosure {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

/**
 * Open/closed state for a Modal, Drawer or dropdown.
 *
 * Every one of those needs the same `isOpen` plus three setters, and writing
 * them inline produces a new closure per render — which then defeats the memo
 * on any child receiving `onClose`. These are stable across renders.
 *
 * @example
 * ```tsx
 * const modal = useDisclosure()
 * <Button onClick={modal.open}>Add campus</Button>
 * <Modal isOpen={modal.isOpen} onClose={modal.close} title="Add campus">…</Modal>
 * ```
 */
export function useDisclosure(initial = false): Disclosure {
  const [isOpen, setIsOpen] = useState(initial);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  // Uses the updater form so `toggle` never closes over a stale `isOpen` and
  // can stay in the dependency-free callback above.
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  return { isOpen, open, close, toggle };
}
