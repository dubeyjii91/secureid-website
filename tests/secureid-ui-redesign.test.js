import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../src/App.jsx");
const dashboard = read("../src/SecurityDashboard.jsx");
const icon = read("../src/SecureIcon.jsx");
const design = read("../src/secureid-design-system.css");
const launchers = read("../src/secureid-dashboard-workspaces.css");

test("SecureID primary navigation uses a shared SVG icon component", () => {
  assert.ok(app.includes('import SecureIcon from "./SecureIcon.jsx"'));
  assert.ok(app.includes('className="navIcon"><SecureIcon name={icon} size={18} />'));
  assert.ok(icon.includes('viewBox="0 0 24 24"'));
  assert.ok(icon.includes('strokeLinecap="round"'));
  assert.ok(icon.includes('paths[name] || paths.shield'));
  const nav = app.match(/const navItems = \[([\s\S]*?)\n\];/)?.[1] || "";
  assert.ok(nav.includes('"dashboard"') && nav.includes('"documents"') && nav.includes('"college"'));
  assert.doesNotMatch(nav, /[🏠🛡️🗂️🪪📁🔗📊💻🏫⚙️📜]/u);
});

test("dashboard feature cards navigate through the existing application event", () => {
  assert.ok(dashboard.includes('className="quickAccessGrid"'));
  assert.ok(dashboard.includes('className="quickAccessCard"'));
  assert.ok(dashboard.includes('new CustomEvent("secureid:navigate"'));
  assert.ok(dashboard.includes('sessionRole === "owner"'));
  assert.ok(dashboard.includes('["documents","Document vault"'));
  assert.ok(dashboard.includes('["share","Share ID"'));
  assert.ok(dashboard.includes('["college","College workspace"'));
});

test("the product design layer includes accessible responsive navigation and controls", () => {
  assert.ok(app.includes('import "./secureid-design-system.css"'));
  assert.ok(app.includes('import "./secureid-dashboard-workspaces.css"'));
  assert.match(design, /\.navItem\.active/);
  assert.match(design, /\.navIcon\s*\{/);
  assert.match(design, /:focus-visible/);
  assert.match(design, /@media\s*\(max-width:\s*650px\)/);
  assert.match(design, /prefers-reduced-motion/);
  assert.match(launchers, /\.quickAccessCard:hover/);
  assert.match(launchers, /@media\(max-width:560px\)/);
});
