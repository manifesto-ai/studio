/**
 * Unit tests for counterfactual hint decoding (Rule P1).
 *
 * Central invariant under test: we NEVER guess. Anything beyond the
 * narrow set of safe forms returns null.
 */
import { describe, expect, it } from "vitest";
import { deriveCounterfactualHint } from "../counterfactual.js";

const ref = (r: string) => ({ kind: "ref" as const, ref: r });
const lit = (v: unknown) => ({ kind: "literal" as const, value: v });
const call = (op: string, ...args: unknown[]) => ({ kind: "call" as const, op, args });

describe("deriveCounterfactualHint — decodable forms", () => {
  it("eq(ref, literal)", () => {
    const h = deriveCounterfactualHint(call("eq", ref("phase"), lit("playing")));
    expect(h).not.toBeNull();
    expect(h?.text).toBe('Passes when phase becomes "playing".');
    expect(h?.refPath).toBe("phase");
  });

  it("eq(literal, ref) (operand order reversed)", () => {
    const h = deriveCounterfactualHint(call("eq", lit(5), ref("count")));
    expect(h?.text).toBe("Passes when count becomes 5.");
  });

  it("neq, gt, gte, lt, lte", () => {
    expect(deriveCounterfactualHint(call("neq", ref("x"), lit(0)))?.text).toBe(
      "Passes when x stops being 0.",
    );
    expect(deriveCounterfactualHint(call("gt", ref("n"), lit(3)))?.text).toBe(
      "Passes when n becomes greater than 3.",
    );
    expect(deriveCounterfactualHint(call("gte", ref("n"), lit(3)))?.text).toBe(
      "Passes when n becomes ≥ 3.",
    );
    expect(deriveCounterfactualHint(call("lt", ref("n"), lit(3)))?.text).toBe(
      "Passes when n becomes less than 3.",
    );
    expect(deriveCounterfactualHint(call("lte", ref("n"), lit(3)))?.text).toBe(
      "Passes when n becomes ≤ 3.",
    );
  });

  it("isNull(ref) and isNotNull(ref)", () => {
    expect(deriveCounterfactualHint(call("isNull", ref("user")))?.text).toBe(
      "Passes when user becomes null.",
    );
    expect(deriveCounterfactualHint(call("isNotNull", ref("user")))?.text).toBe(
      "Passes when user becomes non-null.",
    );
  });

  it("bare boolean ref", () => {
    expect(deriveCounterfactualHint(ref("canShoot"))?.text).toBe(
      "Passes when canShoot becomes true.",
    );
  });

  it("not(ref) flips polarity to false", () => {
    expect(deriveCounterfactualHint(call("not", ref("isLoading")))?.text).toBe(
      "Passes when isLoading becomes false.",
    );
  });

  it("not(eq(ref, lit)) inverts to neq", () => {
    expect(
      deriveCounterfactualHint(call("not", call("eq", ref("x"), lit(1))))?.text,
    ).toBe('Passes when x stops being 1.');
  });

  it("binary ==, !=, > etc. (alternative AST shape)", () => {
    expect(
      deriveCounterfactualHint({ kind: "binary", op: "==", left: ref("x"), right: lit("open") })?.text,
    ).toBe('Passes when x becomes "open".');
    expect(
      deriveCounterfactualHint({ kind: "binary", op: ">=", left: ref("n"), right: lit(10) })?.text,
    ).toBe('Passes when n becomes ≥ 10.');
  });
});

describe("deriveCounterfactualHint — silence on unsafe forms (Rule P1)", () => {
  it("returns null for variadic `and`", () => {
    const expr = call(
      "and",
      call("eq", ref("a"), lit(1)),
      call("eq", ref("b"), lit(2)),
    );
    expect(deriveCounterfactualHint(expr)).toBeNull();
  });

  it("returns null for variadic `or`", () => {
    const expr = call(
      "or",
      call("eq", ref("a"), lit(1)),
      call("eq", ref("b"), lit(2)),
    );
    expect(deriveCounterfactualHint(expr)).toBeNull();
  });

  it("returns null for comparison between two refs", () => {
    // We cannot claim "if a becomes b" without also proving b stays
    // constant. Silence is correct.
    expect(
      deriveCounterfactualHint(call("eq", ref("a"), ref("b"))),
    ).toBeNull();
  });

  it("returns null for aggregation sum/len in guards", () => {
    expect(
      deriveCounterfactualHint(call("gt", call("len", ref("items")), lit(0))),
    ).toBeNull();
  });

  it("returns null for unknown expression kinds", () => {
    expect(deriveCounterfactualHint({ kind: "weird-future-node" })).toBeNull();
    expect(deriveCounterfactualHint(null)).toBeNull();
    expect(deriveCounterfactualHint(undefined)).toBeNull();
    expect(deriveCounterfactualHint("string")).toBeNull();
    expect(deriveCounterfactualHint(42)).toBeNull();
  });
});
