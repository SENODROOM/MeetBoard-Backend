// server/tests/analytics.test.js
// Run: cd server && npx jest tests/analytics.test.js
//
// Setup: npm install --save-dev jest
// Add to server/package.json: "scripts": { "test": "jest" }

"use strict";

// ── Pure helpers (extracted from classroom.js) ────────────────────────────────
// Copy these into server/utils/grades.js and import from both classroom.js
// and this test file to keep things DRY.
const safePts = (pts) => (pts != null && pts > 0 ? pts : 100);

const computeGradePct = (grade, points) => {
  const pct = (grade / safePts(points)) * 100;
  return isFinite(pct) ? pct : null;
};

const computeClassAvg = (allGrades) => {
  const valid = allGrades.filter((g) => isFinite(g) && !isNaN(g));
  if (!valid.length) return null;
  return (valid.reduce((a, b) => a + b, 0) / valid.length).toFixed(1);
};

const buildDistribution = (allGrades) => {
  const dist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  allGrades
    .filter((g) => isFinite(g) && !isNaN(g))
    .forEach((g) => {
      if (g >= 90) dist.A++;
      else if (g >= 80) dist.B++;
      else if (g >= 70) dist.C++;
      else if (g >= 60) dist.D++;
      else dist.F++;
    });
  return dist;
};

// ─────────────────────────────────────────────────────────────────────────────

describe("safePts — prevents division by zero", () => {
  test("returns value when points > 0", () => {
    expect(safePts(100)).toBe(100);
    expect(safePts(50)).toBe(50);
    expect(safePts(1)).toBe(1);
  });
  test("returns 100 when points is 0", () => {
    expect(safePts(0)).toBe(100);
  });
  test("returns 100 when points is null", () => {
    expect(safePts(null)).toBe(100);
  });
  test("returns 100 when points is undefined", () => {
    expect(safePts(undefined)).toBe(100);
  });
  test("returns 100 when points is negative", () => {
    expect(safePts(-10)).toBe(100);
  });
});

describe("computeGradePct — the old Infinity bug", () => {
  test("normal grade/points gives correct pct", () => {
    expect(computeGradePct(90, 100)).toBe(90);
    expect(computeGradePct(45, 50)).toBe(90);
    expect(computeGradePct(70, 100)).toBe(70);
  });
  test("0-point assignment DOES NOT return Infinity (bug fix)", () => {
    const result = computeGradePct(10, 0);
    expect(result).not.toBe(Infinity);
    expect(isFinite(result)).toBe(true);
    expect(result).toBe(10); // 10/100 * 100
  });
  test("null points falls back to 100 (no points set)", () => {
    const result = computeGradePct(80, null);
    expect(result).not.toBe(Infinity);
    expect(result).toBe(80);
  });
  test("perfect score returns 100", () => {
    expect(computeGradePct(100, 100)).toBe(100);
    expect(computeGradePct(50, 50)).toBe(100);
  });
  test("extra credit above 100% is allowed and finite", () => {
    const result = computeGradePct(110, 100);
    expect(result).toBe(110);
    expect(isFinite(result)).toBe(true);
  });
});

describe("computeClassAvg", () => {
  test("average of normal grades", () => {
    expect(computeClassAvg([80, 90, 100])).toBe("90.0");
    expect(computeClassAvg([70, 80])).toBe("75.0");
  });
  test("returns null for empty array", () => {
    expect(computeClassAvg([])).toBeNull();
  });
  test("filters Infinity (old bug: 0-point assignment)", () => {
    expect(computeClassAvg([80, Infinity, 90])).toBe("85.0");
  });
  test("filters NaN", () => {
    expect(computeClassAvg([80, NaN, 90])).toBe("85.0");
  });
  test("returns null when all grades invalid", () => {
    expect(computeClassAvg([Infinity, NaN])).toBeNull();
  });
  test("single grade", () => {
    expect(computeClassAvg([75])).toBe("75.0");
  });
});

describe("buildDistribution — grade letter assignment", () => {
  test("all five letter grades", () => {
    expect(buildDistribution([95, 85, 75, 65, 55])).toEqual({
      A: 1,
      B: 1,
      C: 1,
      D: 1,
      F: 1,
    });
  });
  test("boundary: 90 is A, 89.9 is B", () => {
    const dist = buildDistribution([90, 89.9]);
    expect(dist.A).toBe(1);
    expect(dist.B).toBe(1);
  });
  test("boundary: 80 is B, 79.9 is C", () => {
    const dist = buildDistribution([80, 79.9]);
    expect(dist.B).toBe(1);
    expect(dist.C).toBe(1);
  });
  test("boundary: 60 is D, 59.9 is F", () => {
    const dist = buildDistribution([60, 59.9]);
    expect(dist.D).toBe(1);
    expect(dist.F).toBe(1);
  });
  test("ignores Infinity and NaN (old bug)", () => {
    const dist = buildDistribution([Infinity, NaN, 85]);
    expect(dist).toEqual({ A: 0, B: 1, C: 0, D: 0, F: 0 });
  });
  test("handles empty input", () => {
    expect(buildDistribution([])).toEqual({ A: 0, B: 0, C: 0, D: 0, F: 0 });
  });
  test("multiple As", () => {
    const dist = buildDistribution([91, 95, 100]);
    expect(dist.A).toBe(3);
    expect(dist.B).toBe(0);
  });
});
