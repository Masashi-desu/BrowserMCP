import { describe, expect, it } from "vitest";
import { parseCubeMoves, RubiksCubeBenchmark } from "../src/runtime/rubiks-cube.js";

const FACES = ["U", "R", "F", "D", "L", "B"] as const;
const MOVE_VARIANTS = ["U", "R'", "F2", "D", "L'", "B2", "U2", "R", "F'", "D2", "L", "B'"] as const;

const createSolvedCube = (): RubiksCubeBenchmark =>
  new RubiksCubeBenchmark({
    initialScrambleLength: 0,
    random: () => 0.5,
    animationDurationMs: 0,
  });

const expectLegalFacelets = (snapshot: ReturnType<RubiksCubeBenchmark["getSnapshot"]>): void => {
  expect(snapshot.faceletString).toHaveLength(54);
  expect(snapshot.faceletString).toBe(FACES.map((face) => snapshot.facelets[face]).join(""));

  for (const face of FACES) {
    expect(snapshot.facelets[face]).toHaveLength(9);
    expect(snapshot.facelets[face][4]).toBe(face);
    expect([...snapshot.faceletString].filter((sticker) => sticker === face)).toHaveLength(9);
  }

  expect(
    [...snapshot.faceletString].every((sticker) =>
      FACES.includes(sticker as (typeof FACES)[number]),
    ),
  ).toBe(true);
  expect(Number.isInteger(snapshot.revision)).toBe(true);
  expect(snapshot.revision).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(snapshot.entropy)).toBe(true);
  expect(snapshot.entropy).toBeGreaterThanOrEqual(0);
  expect(snapshot.stateId).toEqual(expect.any(String));
  expect(snapshot.stateId.length).toBeGreaterThan(0);
};

const inverseMove = (move: string): string => {
  if (move.endsWith("2")) return move;
  return move.endsWith("'") ? move.slice(0, -1) : `${move}'`;
};

describe("Rubik's cube move parser", () => {
  it("accepts only canonical Singmaster face turns and ordinary whitespace", () => {
    for (const notation of ["R", "U2", "F'", "R U R' U'", "  U   R2\nF'\tD L2 B'  "]) {
      expect(() => parseCubeMoves(notation)).not.toThrow();
    }
  });

  it("rejects unsupported, malformed, lowercase, and Unicode-lookalike moves", () => {
    for (const notation of [
      "r",
      "X",
      "M",
      "R3",
      "R''",
      "R2'",
      "R, U",
      "R nope",
      "Ｒ",
      "R’",
      "R\0U",
    ]) {
      expect(() => parseCubeMoves(notation), notation).toThrow();
    }
  });
});

describe("Rubik's cube state invariants", () => {
  it.each(FACES)("returns to the exact initial state after four %s turns", async (face) => {
    const cube = createSolvedCube();
    const initial = cube.getSnapshot();

    await cube.applyMoves(`${face} ${face} ${face} ${face}`, { animated: false });
    const restored = cube.getSnapshot();

    expect(restored.faceletString).toBe(initial.faceletString);
    expect(restored.isSolved).toBe(true);
    expect(restored.revision).toBeGreaterThan(initial.revision);
    expectLegalFacelets(restored);
  });

  it.each(FACES)("returns to the exact initial state after %s and its inverse", async (face) => {
    for (const notation of [`${face} ${face}'`, `${face}' ${face}`]) {
      const cube = createSolvedCube();
      const initial = cube.getSnapshot();

      await cube.applyMoves(notation, { animated: false });
      const restored = cube.getSnapshot();

      expect(restored.faceletString).toBe(initial.faceletString);
      expect(restored.isSolved).toBe(true);
      expectLegalFacelets(restored);
    }
  });

  it("preserves nine stickers of every face after a non-trivial algorithm", async () => {
    const cube = createSolvedCube();

    await cube.applyMoves("R U R' U' F2 D L' B", { animated: false });
    const snapshot = cube.getSnapshot();

    expect(snapshot.isSolved).toBe(false);
    expect(snapshot.entropy).toBeGreaterThan(0);
    expectLegalFacelets(snapshot);
  });

  it("reproduces the same scrambled state when reset with the same seed", async () => {
    const cube = createSolvedCube();

    await cube.reset({ mode: "scrambled", seed: "repeatable-benchmark-seed", length: 32 });
    const first = cube.getSnapshot();
    await cube.reset({ mode: "solved" });
    await cube.reset({ mode: "scrambled", seed: "repeatable-benchmark-seed", length: 32 });
    const second = cube.getSnapshot();

    expect(first.isSolved).toBe(false);
    expect(second.faceletString).toBe(first.faceletString);
    expect(second.entropy).toBe(first.entropy);
    expectLegalFacelets(second);
  });

  it("remains exact and legal after 10,000 turns and their inverse", async () => {
    const cube = createSolvedCube();
    const initial = cube.getSnapshot();
    const moves = Array.from(
      { length: 10_000 },
      (_, index) => MOVE_VARIANTS[index % MOVE_VARIANTS.length] ?? "U",
    );

    await cube.applyMoves(moves.join(" "), { animated: false });
    const afterTenThousand = cube.getSnapshot();
    expectLegalFacelets(afterTenThousand);

    const inverse = [...moves].reverse().map(inverseMove);
    await cube.applyMoves(inverse.join(" "), { animated: false });
    const restored = cube.getSnapshot();

    expect(restored.faceletString).toBe(initial.faceletString);
    expect(restored.isSolved).toBe(true);
    expectLegalFacelets(restored);
  });

  it("advances revision and stateId when the logical state changes", async () => {
    const cube = createSolvedCube();
    const initial = cube.getSnapshot();

    await cube.applyMoves("R", { animated: false });
    const moved = cube.getSnapshot();

    expect(moved.revision).toBeGreaterThan(initial.revision);
    expect(moved.stateId).not.toBe(initial.stateId);
    expect(moved.faceletString).not.toBe(initial.faceletString);
    expect(moved.isSolved).toBe(false);

    await cube.reset({ mode: "solved" });
    const reset = cube.getSnapshot();
    expect(reset.revision).toBeGreaterThan(moved.revision);
    expect(reset.stateId).not.toBe(moved.stateId);
    expect(reset.faceletString).toBe(initial.faceletString);
    expect(reset.isSolved).toBe(true);
  });
});
