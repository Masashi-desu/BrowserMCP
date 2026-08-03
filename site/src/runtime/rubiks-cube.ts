export const RUBIKS_CUBE_FACES = ["U", "R", "F", "D", "L", "B"] as const;

export type RubiksCubeFace = (typeof RUBIKS_CUBE_FACES)[number];
export type RubiksCubeAxis = "x" | "y" | "z";
export type RubiksCubeMove =
  | "U"
  | "U'"
  | "U2"
  | "R"
  | "R'"
  | "R2"
  | "F"
  | "F'"
  | "F2"
  | "D"
  | "D'"
  | "D2"
  | "L"
  | "L'"
  | "L2"
  | "B"
  | "B'"
  | "B2";

export type RubiksCubeVector = readonly [number, number, number];
export type RubiksCubeBasis = readonly [RubiksCubeVector, RubiksCubeVector, RubiksCubeVector];

export interface RubiksCubeSticker {
  readonly face: RubiksCubeFace;
  readonly normal: RubiksCubeVector;
}

export interface RubiksCubeCubieRenderState {
  readonly id: string;
  readonly position: RubiksCubeVector;
  readonly basis: RubiksCubeBasis;
  readonly stickers: readonly RubiksCubeSticker[];
}

export interface RubiksCubeActiveMove {
  readonly move: RubiksCubeMove;
  readonly axis: RubiksCubeAxis;
  readonly layer: -1 | 1;
  readonly quarterTurns: number;
  readonly startedAt: number;
  readonly durationMs: number;
}

export interface RubiksCubeRenderSnapshot {
  readonly revision: number;
  readonly cubies: readonly RubiksCubeCubieRenderState[];
  readonly activeMove?: RubiksCubeActiveMove;
}

export interface RubiksCubeSnapshot {
  readonly schemaVersion: 1;
  readonly algorithmVersion: "browsermcp-rubiks-v1";
  readonly cubeSize: 3;
  readonly faceletOrder: "URFDLB";
  readonly facelets: Readonly<Record<RubiksCubeFace, string>>;
  readonly faceletString: string;
  readonly stateId: string;
  readonly revision: number;
  readonly moveCount: number;
  readonly entropy: number;
  readonly isSolved: boolean;
  readonly phase: "idle" | "animating";
  readonly activeMove: null | {
    readonly move: RubiksCubeMove;
    readonly progress: number;
    readonly durationMs: number;
  };
  readonly queuedMoves: number;
  readonly lastMove: RubiksCubeMove | null;
  readonly recentMoves: readonly RubiksCubeMove[];
  readonly autoplay: {
    readonly enabled: boolean;
    readonly active: boolean;
    readonly intervalMs: number;
  };
  readonly scramble: {
    readonly seed: string;
    readonly length: number;
    readonly moves: readonly RubiksCubeMove[];
  };
}

export interface RubiksCubeBenchmarkOptions {
  readonly initialScrambleLength?: number;
  readonly initialSeed?: string;
  readonly random?: () => number;
  readonly animationDurationMs?: number;
  readonly autoplayIntervalMs?: number;
  readonly now?: () => number;
}

export interface RubiksCubeApplyOptions {
  readonly animated?: boolean;
  readonly signal?: AbortSignal;
  readonly expectedRevision?: number;
}

export interface RubiksCubeScrambleOptions extends RubiksCubeApplyOptions {
  readonly length?: number;
  readonly seed?: string;
}

export interface RubiksCubeResetOptions {
  readonly mode: "solved" | "scrambled";
  readonly seed?: string;
  readonly length?: number;
}

export interface RubiksCubeAutoplayOptions {
  readonly enabled: boolean;
  readonly intervalMs?: number;
}

interface MutableCubie {
  readonly id: string;
  position: RubiksCubeVector;
  basis: RubiksCubeBasis;
  readonly stickers: readonly RubiksCubeSticker[];
}

interface MoveDefinition {
  readonly axis: RubiksCubeAxis;
  readonly layer: -1 | 1;
  readonly clockwiseQuarterTurns: -1 | 1;
}

interface QueueEntry {
  readonly move: RubiksCubeMove;
  readonly durationMs: number;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  readonly signal?: AbortSignal;
  abortListener?: () => void;
}

const ALL_MOVES = [
  "U",
  "U'",
  "U2",
  "R",
  "R'",
  "R2",
  "F",
  "F'",
  "F2",
  "D",
  "D'",
  "D2",
  "L",
  "L'",
  "L2",
  "B",
  "B'",
  "B2",
] as const satisfies readonly RubiksCubeMove[];

const MOVE_SET = new Set<string>(ALL_MOVES);
const MOVE_TOKEN = /^[URFDLB](?:2|')?$/u;
const MAX_ENGINE_SEQUENCE = 20_000;
const MAX_SCRAMBLE_LENGTH = 100;
const RECENT_MOVE_LIMIT = 48;
const LOG2_FACE_COUNT = Math.log2(RUBIKS_CUBE_FACES.length);

const MOVE_DEFINITIONS: Readonly<Record<RubiksCubeFace, MoveDefinition>> = {
  U: { axis: "y", layer: 1, clockwiseQuarterTurns: -1 },
  R: { axis: "x", layer: 1, clockwiseQuarterTurns: -1 },
  F: { axis: "z", layer: 1, clockwiseQuarterTurns: -1 },
  D: { axis: "y", layer: -1, clockwiseQuarterTurns: 1 },
  L: { axis: "x", layer: -1, clockwiseQuarterTurns: 1 },
  B: { axis: "z", layer: -1, clockwiseQuarterTurns: 1 },
};

const IDENTITY_BASIS: RubiksCubeBasis = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const createAbortError = (): Error => {
  if (typeof DOMException === "function")
    return new DOMException("Cube operation aborted.", "AbortError");
  const error = new Error("Cube operation aborted.");
  error.name = "AbortError";
  return error;
};

const assertIntegerRange = (
  value: number,
  minimum: number,
  maximum: number,
  name: string,
): void => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
};

const normalizedRandom = (random: () => number): number => {
  const value = random();
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(0.999_999_999, Math.max(0, value));
};

const browserRandom = (): number => {
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const value = new Uint32Array(1);
    globalThis.crypto.getRandomValues(value);
    return (value[0] ?? 0) / 0x1_0000_0000;
  }
  return Math.random();
};

const randomSeed = (random: () => number): string => {
  const words = Array.from({ length: 4 }, () =>
    Math.floor(normalizedRandom(random) * 0x1_0000_0000)
      .toString(16)
      .padStart(8, "0"),
  );
  return `bmcp-${words.join("")}`;
};

const seededRandom = (seed: string): (() => number) => {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
};

const vectorForAxis = (axis: RubiksCubeAxis): RubiksCubeVector =>
  axis === "x" ? [1, 0, 0] : axis === "y" ? [0, 1, 0] : [0, 0, 1];

const axisIndex = (axis: RubiksCubeAxis): 0 | 1 | 2 => (axis === "x" ? 0 : axis === "y" ? 1 : 2);

const rotateVectorPositiveQuarter = (
  vector: RubiksCubeVector,
  axis: RubiksCubeAxis,
): RubiksCubeVector => {
  const [x, y, z] = vector;
  if (axis === "x") return [x, -z, y];
  if (axis === "y") return [z, y, -x];
  return [-y, x, z];
};

const rotateVector = (
  vector: RubiksCubeVector,
  axis: RubiksCubeAxis,
  quarterTurns: number,
): RubiksCubeVector => {
  let result = vector;
  const turns = ((quarterTurns % 4) + 4) % 4;
  for (let index = 0; index < turns; index += 1) {
    result = rotateVectorPositiveQuarter(result, axis);
  }
  return result;
};

const rotateBasis = (
  basis: RubiksCubeBasis,
  axis: RubiksCubeAxis,
  quarterTurns: number,
): RubiksCubeBasis => [
  rotateVector(basis[0], axis, quarterTurns),
  rotateVector(basis[1], axis, quarterTurns),
  rotateVector(basis[2], axis, quarterTurns),
];

const applyBasis = (basis: RubiksCubeBasis, vector: RubiksCubeVector): RubiksCubeVector => {
  const [x, y, z] = vector;
  return [
    basis[0][0] * x + basis[1][0] * y + basis[2][0] * z,
    basis[0][1] * x + basis[1][1] * y + basis[2][1] * z,
    basis[0][2] * x + basis[1][2] * y + basis[2][2] * z,
  ];
};

const moveDefinition = (move: RubiksCubeMove): RubiksCubeActiveMove => {
  const face = move[0] as RubiksCubeFace;
  const definition = MOVE_DEFINITIONS[face];
  const suffix = move.slice(1);
  const quarterTurns =
    suffix === "2"
      ? definition.clockwiseQuarterTurns * 2
      : suffix === "'"
        ? -definition.clockwiseQuarterTurns
        : definition.clockwiseQuarterTurns;
  return {
    move,
    axis: definition.axis,
    layer: definition.layer,
    quarterTurns,
    startedAt: 0,
    durationMs: 0,
  };
};

const rotateCubies = (cubies: MutableCubie[], move: RubiksCubeMove): void => {
  const definition = moveDefinition(move);
  const coordinateIndex = axisIndex(definition.axis);
  for (const cubie of cubies) {
    if (cubie.position[coordinateIndex] !== definition.layer) continue;
    cubie.position = rotateVector(cubie.position, definition.axis, definition.quarterTurns);
    cubie.basis = rotateBasis(cubie.basis, definition.axis, definition.quarterTurns);
  }
};

const stickersForPosition = (position: RubiksCubeVector): readonly RubiksCubeSticker[] => {
  const [x, y, z] = position;
  const stickers: RubiksCubeSticker[] = [];
  if (y === 1) stickers.push({ face: "U", normal: [0, 1, 0] });
  if (x === 1) stickers.push({ face: "R", normal: [1, 0, 0] });
  if (z === 1) stickers.push({ face: "F", normal: [0, 0, 1] });
  if (y === -1) stickers.push({ face: "D", normal: [0, -1, 0] });
  if (x === -1) stickers.push({ face: "L", normal: [-1, 0, 0] });
  if (z === -1) stickers.push({ face: "B", normal: [0, 0, -1] });
  return stickers;
};

const createSolvedCubies = (): MutableCubie[] => {
  const cubies: MutableCubie[] = [];
  for (let x = -1; x <= 1; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -1; z <= 1; z += 1) {
        if (x === 0 && y === 0 && z === 0) continue;
        const position: RubiksCubeVector = [x, y, z];
        cubies.push({
          id: `${x}:${y}:${z}`,
          position,
          basis: IDENTITY_BASIS,
          stickers: stickersForPosition(position),
        });
      }
    }
  }
  return cubies;
};

const cloneCubies = (cubies: readonly MutableCubie[]): MutableCubie[] =>
  cubies.map((cubie) => ({
    ...cubie,
    position: [...cubie.position] as unknown as RubiksCubeVector,
    basis: cubie.basis.map((basisVector) => [...basisVector]) as unknown as RubiksCubeBasis,
  }));

const faceFromNormal = (normal: RubiksCubeVector): RubiksCubeFace => {
  const [x, y, z] = normal;
  if (y === 1) return "U";
  if (x === 1) return "R";
  if (z === 1) return "F";
  if (y === -1) return "D";
  if (x === -1) return "L";
  if (z === -1) return "B";
  throw new Error("Sticker normal is not aligned to a cube face.");
};

const faceletIndex = (face: RubiksCubeFace, position: RubiksCubeVector): number => {
  const [x, y, z] = position;
  if (face === "U") return (z + 1) * 3 + (x + 1);
  if (face === "D") return (1 - z) * 3 + (x + 1);
  if (face === "F") return (1 - y) * 3 + (x + 1);
  if (face === "B") return (1 - y) * 3 + (1 - x);
  if (face === "R") return (1 - y) * 3 + (1 - z);
  return (1 - y) * 3 + (z + 1);
};

const faceletsForCubies = (
  cubies: readonly MutableCubie[],
): Readonly<Record<RubiksCubeFace, string>> => {
  const result: Record<RubiksCubeFace, string[]> = {
    U: Array<string>(9).fill("?"),
    R: Array<string>(9).fill("?"),
    F: Array<string>(9).fill("?"),
    D: Array<string>(9).fill("?"),
    L: Array<string>(9).fill("?"),
    B: Array<string>(9).fill("?"),
  };
  for (const cubie of cubies) {
    for (const sticker of cubie.stickers) {
      const currentFace = faceFromNormal(applyBasis(cubie.basis, sticker.normal));
      result[currentFace][faceletIndex(currentFace, cubie.position)] = sticker.face;
    }
  }
  const serialized = Object.fromEntries(
    RUBIKS_CUBE_FACES.map((face) => {
      if (result[face].some((value) => value === "?")) {
        throw new Error(`Cube state is missing facelets for ${face}.`);
      }
      return [face, result[face].join("")];
    }),
  ) as Record<RubiksCubeFace, string>;
  return serialized;
};

const entropyForFacelets = (facelets: Readonly<Record<RubiksCubeFace, string>>): number => {
  let entropy = 0;
  for (const face of RUBIKS_CUBE_FACES) {
    const counts = new Map<string, number>();
    for (const sticker of facelets[face]) counts.set(sticker, (counts.get(sticker) ?? 0) + 1);
    for (const count of counts.values()) {
      const probability = count / 9;
      entropy -= probability * Math.log2(probability);
    }
  }
  return entropy / (RUBIKS_CUBE_FACES.length * LOG2_FACE_COUNT);
};

const hashFacelets = (faceletString: string): string => {
  let hash = 2_166_136_261;
  for (let index = 0; index < faceletString.length; index += 1) {
    hash ^= faceletString.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `cube-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const isSolvedFacelets = (facelets: Readonly<Record<RubiksCubeFace, string>>): boolean =>
  RUBIKS_CUBE_FACES.every((face) => facelets[face] === face.repeat(9));

const moveFace = (move: RubiksCubeMove): RubiksCubeFace => move[0] as RubiksCubeFace;

const chooseEntropyMove = (
  cubies: readonly MutableCubie[],
  random: () => number,
  previousMove: RubiksCubeMove | undefined,
): RubiksCubeMove => {
  const candidates = ALL_MOVES.filter(
    (candidate) => previousMove === undefined || moveFace(candidate) !== moveFace(previousMove),
  );
  const scored = candidates.map((move) => {
    const simulated = cloneCubies(cubies);
    rotateCubies(simulated, move);
    return { move, entropy: entropyForFacelets(faceletsForCubies(simulated)) };
  });
  const bestEntropy = Math.max(...scored.map(({ entropy }) => entropy));
  const nearBest = scored.filter(({ entropy }) => entropy >= bestEntropy - 0.0125);
  const index = Math.floor(normalizedRandom(random) * nearBest.length);
  return (nearBest[index] ?? scored[0] ?? { move: "U" as const }).move;
};

const createScramble = (
  from: readonly MutableCubie[],
  length: number,
  seed: string,
): readonly RubiksCubeMove[] => {
  const random = seededRandom(seed);
  const simulated = cloneCubies(from);
  const moves: RubiksCubeMove[] = [];
  let previous: RubiksCubeMove | undefined;
  for (let index = 0; index < length; index += 1) {
    const move = chooseEntropyMove(simulated, random, previous);
    moves.push(move);
    rotateCubies(simulated, move);
    previous = move;
  }
  return moves;
};

const validateMoves = (moves: readonly string[]): readonly RubiksCubeMove[] => {
  if (moves.length === 0) throw new Error("At least one cube move is required.");
  if (moves.length > MAX_ENGINE_SEQUENCE) {
    throw new Error(`Cube move sequence exceeds ${MAX_ENGINE_SEQUENCE} moves.`);
  }
  for (const move of moves) {
    if (!MOVE_SET.has(move)) throw new Error(`Unsupported cube move: ${move}`);
  }
  return moves as readonly RubiksCubeMove[];
};

export const parseCubeMoves = (notation: string): readonly RubiksCubeMove[] => {
  if (typeof notation !== "string") throw new Error("Cube moves must be a string.");
  const trimmed = notation.trim();
  if (trimmed === "") throw new Error("At least one cube move is required.");
  const tokens = trimmed.split(/\s+/u);
  if (tokens.some((token) => !MOVE_TOKEN.test(token))) {
    throw new Error("Moves must use canonical U R F D L B notation with optional ' or 2 suffixes.");
  }
  return validateMoves(tokens);
};

export class RubiksCubeBenchmark {
  readonly #listeners = new Set<(snapshot: RubiksCubeSnapshot) => void>();
  readonly #random: () => number;
  readonly #now: () => number;
  readonly #animationDurationMs: number;
  #cubies = createSolvedCubies();
  #revision = 0;
  #moveCount = 0;
  #recentMoves: RubiksCubeMove[] = [];
  #lastMove: RubiksCubeMove | undefined;
  #queue: QueueEntry[] = [];
  #activeEntry: QueueEntry | undefined;
  #activeMove: RubiksCubeActiveMove | undefined;
  #activeTimer: ReturnType<typeof setTimeout> | undefined;
  #autoplayTimer: ReturnType<typeof setTimeout> | undefined;
  #autoplayEnabled = true;
  #autoplayIntervalMs: number;
  #viewReferences = 0;
  #reducedMotion = false;
  #scramble: { seed: string; moves: readonly RubiksCubeMove[] };

  public constructor(options: RubiksCubeBenchmarkOptions = {}) {
    this.#random = options.random ?? browserRandom;
    this.#now = options.now ?? (() => performance.now());
    this.#animationDurationMs = options.animationDurationMs ?? 420;
    this.#autoplayIntervalMs = options.autoplayIntervalMs ?? 1_450;
    assertIntegerRange(this.#animationDurationMs, 0, 10_000, "animationDurationMs");
    assertIntegerRange(this.#autoplayIntervalMs, 500, 30_000, "autoplayIntervalMs");
    const initialScrambleLength = options.initialScrambleLength ?? 24;
    assertIntegerRange(initialScrambleLength, 0, MAX_SCRAMBLE_LENGTH, "initialScrambleLength");
    const seed = options.initialSeed ?? randomSeed(this.#random);
    const moves = createScramble(this.#cubies, initialScrambleLength, seed);
    this.#scramble = { seed, moves };
    for (const move of moves) this.#commitMove(move);
  }

  public getSnapshot(): RubiksCubeSnapshot {
    const facelets = faceletsForCubies(this.#cubies);
    const faceletString = RUBIKS_CUBE_FACES.map((face) => facelets[face]).join("");
    const active = this.#activeMove;
    const activeProgress =
      active === undefined
        ? 0
        : active.durationMs === 0
          ? 1
          : Math.min(1, Math.max(0, (this.#now() - active.startedAt) / active.durationMs));
    return {
      schemaVersion: 1,
      algorithmVersion: "browsermcp-rubiks-v1",
      cubeSize: 3,
      faceletOrder: "URFDLB",
      facelets,
      faceletString,
      stateId: hashFacelets(faceletString),
      revision: this.#revision,
      moveCount: this.#moveCount,
      entropy: Number(entropyForFacelets(facelets).toFixed(6)),
      isSolved: isSolvedFacelets(facelets),
      phase: active === undefined ? "idle" : "animating",
      activeMove:
        active === undefined
          ? null
          : {
              move: active.move,
              progress: Number(activeProgress.toFixed(4)),
              durationMs: active.durationMs,
            },
      queuedMoves: this.#queue.length,
      lastMove: this.#lastMove ?? null,
      recentMoves: [...this.#recentMoves],
      autoplay: {
        enabled: this.#autoplayEnabled,
        active: this.#autoplayEnabled && this.#viewReferences > 0 && !this.#reducedMotion,
        intervalMs: this.#autoplayIntervalMs,
      },
      scramble: {
        seed: this.#scramble.seed,
        length: this.#scramble.moves.length,
        moves: [...this.#scramble.moves],
      },
    };
  }

  public getRenderSnapshot(): RubiksCubeRenderSnapshot {
    return {
      revision: this.#revision,
      cubies: this.#cubies,
      ...(this.#activeMove === undefined ? {} : { activeMove: this.#activeMove }),
    };
  }

  public subscribe(listener: (snapshot: RubiksCubeSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.#listeners.delete(listener);
  }

  public acquireView(reducedMotion = false): () => void {
    this.#viewReferences += 1;
    this.#reducedMotion = reducedMotion;
    this.#scheduleAutoplay(500);
    this.#emit();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#viewReferences = Math.max(0, this.#viewReferences - 1);
      if (this.#viewReferences === 0) this.#clearAutoplayTimer();
      this.#emit();
    };
  }

  public async applyMoves(
    notation: string | readonly RubiksCubeMove[],
    options: RubiksCubeApplyOptions = {},
  ): Promise<RubiksCubeSnapshot> {
    const moves =
      typeof notation === "string" ? parseCubeMoves(notation) : validateMoves([...notation]);
    if (
      options.expectedRevision !== undefined &&
      (options.expectedRevision !== this.#revision ||
        this.#activeEntry !== undefined ||
        this.#queue.length > 0)
    ) {
      throw new Error(
        `Cube revision conflict: expected ${options.expectedRevision}, current ${this.#revision}${this.#activeEntry === undefined && this.#queue.length === 0 ? "" : " with pending moves"}.`,
      );
    }
    options.signal?.throwIfAborted();
    this.#clearAutoplayTimer();
    const animated = (options.animated ?? true) && !this.#reducedMotion;
    if (!animated && this.#activeEntry === undefined && this.#queue.length === 0) {
      for (const move of moves) {
        options.signal?.throwIfAborted();
        this.#commitMove(move);
      }
      this.#emit();
      this.#scheduleAutoplay();
      return this.getSnapshot();
    }
    await Promise.all(
      moves.map(
        async (move) =>
          await this.#enqueueMove(move, animated ? this.#animationDurationMs : 0, options.signal),
      ),
    );
    return this.getSnapshot();
  }

  public async scramble(options: RubiksCubeScrambleOptions = {}): Promise<RubiksCubeSnapshot> {
    const length = options.length ?? 24;
    assertIntegerRange(length, 1, MAX_SCRAMBLE_LENGTH, "length");
    const seed = options.seed ?? randomSeed(this.#random);
    this.#replaceWithSolvedState();
    const moves = createScramble(this.#cubies, length, seed);
    this.#scramble = { seed, moves };
    this.#emit();
    return await this.applyMoves(moves, options);
  }

  public reset(options: RubiksCubeResetOptions): RubiksCubeSnapshot {
    this.#cancelAll(createAbortError());
    this.#replaceWithSolvedState();
    if (options.mode === "scrambled") {
      const length = options.length ?? 24;
      assertIntegerRange(length, 1, MAX_SCRAMBLE_LENGTH, "length");
      const seed = options.seed ?? randomSeed(this.#random);
      const moves = createScramble(this.#cubies, length, seed);
      this.#scramble = { seed, moves };
      for (const move of moves) this.#commitMove(move);
    } else {
      this.#scramble = { seed: options.seed ?? "solved", moves: [] };
    }
    this.#emit();
    this.#scheduleAutoplay();
    return this.getSnapshot();
  }

  public setAutoplay(options: RubiksCubeAutoplayOptions): RubiksCubeSnapshot {
    if (options.intervalMs !== undefined) {
      assertIntegerRange(options.intervalMs, 500, 30_000, "intervalMs");
      this.#autoplayIntervalMs = options.intervalMs;
    }
    this.#autoplayEnabled = options.enabled;
    if (options.enabled) this.#scheduleAutoplay(350);
    else this.#clearAutoplayTimer();
    this.#emit();
    return this.getSnapshot();
  }

  #replaceWithSolvedState(): void {
    this.#cancelAll(createAbortError());
    this.#cubies = createSolvedCubies();
    this.#revision += 1;
    this.#moveCount = 0;
    this.#recentMoves = [];
    this.#lastMove = undefined;
  }

  #commitMove(move: RubiksCubeMove): void {
    rotateCubies(this.#cubies, move);
    this.#revision += 1;
    this.#moveCount += 1;
    this.#lastMove = move;
    this.#recentMoves.push(move);
    if (this.#recentMoves.length > RECENT_MOVE_LIMIT) {
      this.#recentMoves.splice(0, this.#recentMoves.length - RECENT_MOVE_LIMIT);
    }
  }

  #enqueueMove(
    move: RubiksCubeMove,
    durationMs: number,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    if (signal?.aborted === true) return Promise.reject(createAbortError());
    return new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = {
        move,
        durationMs,
        resolve,
        reject,
        ...(signal === undefined ? {} : { signal }),
      };
      if (signal !== undefined) {
        entry.abortListener = () => this.#abortEntry(entry);
        signal.addEventListener("abort", entry.abortListener, { once: true });
      }
      this.#queue.push(entry);
      this.#startNextMove();
    });
  }

  #startNextMove(): void {
    if (this.#activeEntry !== undefined) return;
    const entry = this.#queue.shift();
    if (entry === undefined) {
      this.#scheduleAutoplay();
      return;
    }
    if (entry.signal?.aborted === true) {
      this.#removeAbortListener(entry);
      entry.reject(createAbortError());
      this.#startNextMove();
      return;
    }
    const definition = moveDefinition(entry.move);
    this.#activeEntry = entry;
    this.#activeMove = {
      ...definition,
      startedAt: this.#now(),
      durationMs: entry.durationMs,
    };
    this.#emit();
    if (entry.durationMs === 0) {
      this.#finishActiveMove();
      return;
    }
    this.#activeTimer = setTimeout(() => this.#finishActiveMove(), entry.durationMs);
  }

  #finishActiveMove(): void {
    const entry = this.#activeEntry;
    if (entry === undefined) return;
    this.#clearActiveTimer();
    this.#commitMove(entry.move);
    this.#activeEntry = undefined;
    this.#activeMove = undefined;
    this.#removeAbortListener(entry);
    entry.resolve();
    this.#emit();
    this.#startNextMove();
  }

  #abortEntry(entry: QueueEntry): void {
    if (this.#activeEntry === entry) {
      this.#clearActiveTimer();
      this.#activeEntry = undefined;
      this.#activeMove = undefined;
      this.#removeAbortListener(entry);
      entry.reject(createAbortError());
      this.#emit();
      this.#startNextMove();
      return;
    }
    const index = this.#queue.indexOf(entry);
    if (index < 0) return;
    this.#queue.splice(index, 1);
    this.#removeAbortListener(entry);
    entry.reject(createAbortError());
  }

  #cancelAll(error: Error): void {
    this.#clearActiveTimer();
    const active = this.#activeEntry;
    this.#activeEntry = undefined;
    this.#activeMove = undefined;
    if (active !== undefined) {
      this.#removeAbortListener(active);
      active.reject(error);
    }
    const queued = this.#queue.splice(0);
    for (const entry of queued) {
      this.#removeAbortListener(entry);
      entry.reject(error);
    }
  }

  #removeAbortListener(entry: QueueEntry): void {
    if (entry.signal !== undefined && entry.abortListener !== undefined) {
      entry.signal.removeEventListener("abort", entry.abortListener);
      delete entry.abortListener;
    }
  }

  #clearActiveTimer(): void {
    if (this.#activeTimer === undefined) return;
    clearTimeout(this.#activeTimer);
    this.#activeTimer = undefined;
  }

  #clearAutoplayTimer(): void {
    if (this.#autoplayTimer === undefined) return;
    clearTimeout(this.#autoplayTimer);
    this.#autoplayTimer = undefined;
  }

  #scheduleAutoplay(delayMs?: number): void {
    this.#clearAutoplayTimer();
    if (
      !this.#autoplayEnabled ||
      this.#reducedMotion ||
      this.#viewReferences === 0 ||
      this.#activeEntry !== undefined ||
      this.#queue.length > 0
    ) {
      return;
    }
    const delay =
      delayMs ??
      Math.round(this.#autoplayIntervalMs * (0.74 + normalizedRandom(this.#random) * 0.52));
    this.#autoplayTimer = setTimeout(() => {
      this.#autoplayTimer = undefined;
      const move = chooseEntropyMove(this.#cubies, this.#random, this.#lastMove);
      void this.applyMoves([move], { animated: true }).catch(() => undefined);
    }, delay);
  }

  #emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }
}

export const rubiksCubeBenchmark = new RubiksCubeBenchmark();

export const rubiksCubeAxisVector = (axis: RubiksCubeAxis): RubiksCubeVector => vectorForAxis(axis);
