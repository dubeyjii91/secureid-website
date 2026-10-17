import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/DocumentVault.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/document-vault.css", import.meta.url), "utf8");

test("document shares remain visible and copyable when clipboard access is unavailable", () => {
  assert.match(source, /Active share link/);
  assert.match(source, /value=\{documentShares\[doc\.id\]\.link\}/);
  assert.match(source, /onClick=\{\(\)=>copyDocumentShare\(doc\.id\)\}/);
  assert.match(source, /Clipboard access is unavailable\. Select and copy the link shown on the document card\./);
  assert.match(source, /Secure document link created\. Copy it from the document card below/);
  assert.match(styles, /\.documentShareLink\s*\{/);
});
