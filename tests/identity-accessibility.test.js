import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");

test("identity page does not claim independent identity verification", () => {
  assert.ok(app.includes("Your identity profile"));
  assert.ok(app.includes("✓ Account active"));
  assert.ok(!app.includes("Your verified identity"));
  assert.ok(!app.includes('<span className="statusBadge success">✓ Verified</span>'));
});

test("text-size controls are keyboard-operable and bounded", () => {
  assert.ok(app.includes('aria-label="Decrease text size"'));
  assert.ok(app.includes('aria-label="Increase text size"'));
  assert.ok(app.includes("Math.max(85, size - 5)"));
  assert.ok(app.includes("Math.min(125, size + 5)"));
  assert.ok(styles.includes(".textSizeButton:focus-visible"));
});
