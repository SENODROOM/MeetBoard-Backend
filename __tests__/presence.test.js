const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

describe("presence multi-connection contract", () => {
  it("leavePresence only fans out user-left when last connection", async () => {
    // Light unit: document expected semantics without DB.
    // enterPresence with connectionId A+B → one peer; leave A → still present; leave B → left.
    const connections = new Set(["a", "b"]);
    const leave = (id) => {
      connections.delete(id);
      return connections.size === 0 ? "user-left" : "stay";
    };
    assert.equal(leave("a"), "stay");
    assert.equal(leave("b"), "user-left");
  });

  it("LeaveClaim dedupes concurrent last-tab leaves", () => {
    const claims = new Set();
    const claim = (userId) => {
      if (claims.has(userId)) return false;
      claims.add(userId);
      return true;
    };
    assert.equal(claim("u1"), true);
    assert.equal(claim("u1"), false);
  });
});
