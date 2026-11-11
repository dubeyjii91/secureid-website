import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../server/production-features.js", import.meta.url), "utf8");

test("institution API no-store middleware is registered before institution routes", () => {
  const middleware = source.indexOf('app.use("/api/institutions"');
  assert.notEqual(middleware, -1, "institution API cache middleware must exist");
  const header = source.indexOf('res.setHeader("Cache-Control", "private, no-store, max-age=0")', middleware);
  const firstRoute = source.indexOf('app.get("/api/institutions/', middleware);
  const moduleRegistration = source.indexOf("registerInstitutionModules({ app", middleware);
  const admissionsRegistration = source.indexOf("registerStudentAdmissions({ app", middleware);

  assert.ok(header > middleware, "middleware must set a private no-store cache policy");
  assert.ok(firstRoute > middleware, "middleware must be registered before production institution routes");
  assert.ok(moduleRegistration > middleware, "middleware must be registered before institution module routes");
  assert.ok(admissionsRegistration > middleware, "middleware must be registered before student admission routes");
});
