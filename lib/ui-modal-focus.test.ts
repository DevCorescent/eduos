// ============================================================================
// OWNER  : Gauransh
// MODULE : UI — Modal focus management
// LAYER  : Regression Test
// PURPOSE: Pin the fix for the "input accepts only one character" bug that
//          affected every form rendered inside a Modal — Add Campus, Add
//          Academic Year and Add Administrator all reported it independently.
//
// THE BUG, EXACTLY
//   Modal's focus effect listed `onClose` in its dependency array. Every caller
//   passes an inline handler, which is a NEW function identity on each render,
//   so ANY state change inside the modal re-ran the effect:
//
//     keystroke -> setForm -> panel re-renders -> new onClose identity
//       -> effect cleanup runs   -> triggerRef.current.focus()  (trigger button)
//       -> effect body runs      -> dialogRef.current.focus()   (dialog)
//
//   The field lost focus after every single character, so the user had to click
//   back into it to type the next one.
//
// WHY THIS TEST READS THE SOURCE
//   The project has no React testing library and no DOM environment — see
//   package.json — so the effect cannot be mounted and driven here. What CAN be
//   asserted, and what actually prevents the regression, is the dependency
//   array itself: the bug was entirely a question of what that array contains.
//   A future edit that re-adds `onClose` fails this test with a message naming
//   the consequence.
//
//   This is deliberately narrow. It does not claim the modal focuses correctly;
//   it claims the one thing that made it focus INCORRECTLY is gone.
// ============================================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(process.cwd(), "components/ui/Modal.tsx"), "utf8");

/** The dependency array of the focus/scroll-lock effect. */
function focusEffectDeps(): string {
  // The effect that installs the Escape listener and locks body scroll — matched
  // by its content rather than its position, so reordering the file is fine.
  const match = /useEffect\(\(\) => \{\s*if \(!isOpen\) return;[\s\S]*?\}, \[([^\]]*)\]\);/.exec(
    source
  );

  assert.ok(match, "could not locate Modal's focus effect — has it been rewritten?");
  return match[1];
}

describe("Modal focus effect — the one-character-at-a-time regression", () => {
  it("does NOT depend on onClose, whose identity changes every render", () => {
    const deps = focusEffectDeps();

    assert.ok(
      !/\bonClose\b/.test(deps),
      "Modal's focus effect depends on onClose again. Callers pass inline " +
        "handlers, so this re-runs on every keystroke and steals focus from " +
        "the field being typed into — the Add Campus / Academic Year / " +
        "Administrator bug. Read the current handler through a ref instead."
    );
  });

  it("depends on isOpen, so it still runs when the modal opens and closes", () => {
    // The other half: removing the dependency must not have removed the effect's
    // reason to run at all.
    assert.match(focusEffectDeps(), /\bisOpen\b/);
  });

  it("calls the CURRENT onClose through a ref, so Escape is never stale", () => {
    // Dropping the dependency without the ref would leave Escape calling the
    // handler captured on the render the modal opened.
    assert.match(source, /onCloseRef/, "the latest onClose must be reachable via a ref");
    assert.match(
      source,
      /if \(e\.key === "Escape"\) onCloseRef\.current\(\);/,
      "Escape must invoke the current handler, not a captured one"
    );
    assert.ok(
      /useEffect\(\(\) => \{\s*onCloseRef\.current = onClose;\s*\}, \[onClose\]\);/.test(source),
      "the ref must be kept current in an effect rather than assigned during render"
    );
  });
});
