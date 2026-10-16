import assert from "node:assert/strict";
import { test } from "node:test";

import { BANNER, report } from "./report.js";

test("the run output names FalkorDB before it names the fix", () => {
  const text = report({
    injectedFrom: "issue",
    tools: ["filesystem.write", "git.push"],
    hops: 4,
    grant: "git.push",
  });
  assert.equal(text.startsWith(BANNER), true);
  assert.match(text, /FalkorDB 6\.0\.2/);
  assert.match(text, /CALL algo\.maxFlow on FalkorDB/);
  assert.match(text, /revoke git\.push/);
  // the sponsor line is above the fix line
  assert.ok(text.indexOf("FalkorDB") < text.indexOf("revoke"));
});
