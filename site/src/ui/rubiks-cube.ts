import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PointLight,
  Quaternion,
  Scene,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  type RubiksCubeActiveMove,
  type RubiksCubeCubieRenderState,
  type RubiksCubeFace,
  type RubiksCubeMove,
  type RubiksCubeSnapshot,
  type RubiksCubeSticker,
  rubiksCubeAxisVector,
  rubiksCubeBenchmark,
} from "../runtime/rubiks-cube.js";

export type RubiksCubeViewVariant = "hero" | "connection";

interface StickerInstance {
  readonly cubieId: string;
  readonly sticker: RubiksCubeSticker;
}

const ELEMENT_NAME = "browsermcp-rubiks-cube";
const CUBIE_SPACING = 1.035;
const BODY_SIZE = 0.965;
const STICKER_OFFSET = 0.501;
const STICKER_SIZE = 0.39;
const STICKER_RADIUS = 0.075;
const Z_AXIS = new Vector3(0, 0, 1);

const FACE_COLORS: Readonly<Record<RubiksCubeFace, number>> = {
  U: 0xcbc3ae,
  R: 0x74263b,
  F: 0x0b624b,
  D: 0xa56b29,
  L: 0x493562,
  B: 0x17486f,
};

const createRoundedStickerGeometry = (): ShapeGeometry => {
  const size = STICKER_SIZE;
  const radius = STICKER_RADIUS;
  const shape = new Shape();
  shape.moveTo(-size + radius, -size);
  shape.lineTo(size - radius, -size);
  shape.quadraticCurveTo(size, -size, size, -size + radius);
  shape.lineTo(size, size - radius);
  shape.quadraticCurveTo(size, size, size - radius, size);
  shape.lineTo(-size + radius, size);
  shape.quadraticCurveTo(-size, size, -size, size - radius);
  shape.lineTo(-size, -size + radius);
  shape.quadraticCurveTo(-size, -size, -size + radius, -size);
  return new ShapeGeometry(shape, 4);
};

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const easeTurn = (progress: number): number => {
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped * clamped * (3 - 2 * clamped);
};

const matrixForCubie = (cubie: RubiksCubeCubieRenderState): Matrix4 => {
  const matrix = new Matrix4().makeBasis(
    new Vector3(...cubie.basis[0]),
    new Vector3(...cubie.basis[1]),
    new Vector3(...cubie.basis[2]),
  );
  matrix.setPosition(
    cubie.position[0] * CUBIE_SPACING,
    cubie.position[1] * CUBIE_SPACING,
    cubie.position[2] * CUBIE_SPACING,
  );
  return matrix;
};

const localStickerMatrix = (sticker: RubiksCubeSticker): Matrix4 => {
  const normal = new Vector3(...sticker.normal);
  const quaternion = new Quaternion().setFromUnitVectors(Z_AXIS, normal);
  return new Matrix4().compose(
    normal.multiplyScalar(STICKER_OFFSET),
    quaternion,
    new Vector3(1, 1, 1),
  );
};

const activeRotation = (active: RubiksCubeActiveMove, now: number): Matrix4 => {
  const rawProgress =
    active.durationMs === 0
      ? 1
      : Math.min(1, Math.max(0, (now - active.startedAt) / active.durationMs));
  const axis = new Vector3(...rubiksCubeAxisVector(active.axis));
  return new Matrix4().makeRotationAxis(
    axis,
    active.quarterTurns * (Math.PI / 2) * easeTurn(rawProgress),
  );
};

const cubieIsActive = (
  cubie: RubiksCubeCubieRenderState,
  active: RubiksCubeActiveMove,
): boolean => {
  const index = active.axis === "x" ? 0 : active.axis === "y" ? 1 : 2;
  return cubie.position[index] === active.layer;
};

class RubiksCubeScene {
  readonly #host: HTMLElement;
  readonly #scene = new Scene();
  readonly #camera = new PerspectiveCamera(31, 1, 0.1, 100);
  readonly #renderer: WebGLRenderer;
  readonly #root = new Group();
  readonly #bodyGeometry = new RoundedBoxGeometry(BODY_SIZE, BODY_SIZE, BODY_SIZE, 4, 0.075);
  readonly #bodyMaterial = new MeshPhysicalMaterial({
    color: 0x060908,
    roughness: 0.2,
    metalness: 0.14,
    clearcoat: 1,
    clearcoatRoughness: 0.13,
  });
  readonly #stickerGeometry = createRoundedStickerGeometry();
  readonly #stickerMaterials = new Map<RubiksCubeFace, MeshPhysicalMaterial>();
  readonly #bodyMesh: InstancedMesh;
  readonly #stickerMeshes = new Map<RubiksCubeFace, InstancedMesh>();
  readonly #stickerInstances = new Map<RubiksCubeFace, readonly StickerInstance[]>();
  readonly #cubieById = new Map<string, RubiksCubeCubieRenderState>();
  readonly #resizeObserver: ResizeObserver | undefined;
  readonly #intersectionObserver: IntersectionObserver | undefined;
  #frame: number | undefined;
  #visible = true;
  #documentVisible = document.visibilityState !== "hidden";
  #width = 0;
  #height = 0;
  #yaw: number;
  #pitch: number;
  #pointer:
    | {
        readonly id: number;
        readonly startX: number;
        readonly startY: number;
        readonly yaw: number;
        readonly pitch: number;
      }
    | undefined;

  public constructor(host: HTMLElement, canvas: HTMLCanvasElement, variant: RubiksCubeViewVariant) {
    this.#host = host;
    this.#yaw = variant === "hero" ? -0.52 : 0.44;
    this.#pitch = variant === "hero" ? -0.34 : -0.24;
    this.#renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    this.#renderer.setClearColor(new Color(0x000000), 0);
    this.#renderer.setPixelRatio(Math.min(devicePixelRatio, variant === "hero" ? 1.8 : 1.5));
    this.#renderer.outputColorSpace = SRGBColorSpace;
    this.#renderer.toneMapping = ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = variant === "hero" ? 1.2 : 1.08;

    const renderState = rubiksCubeBenchmark.getRenderSnapshot();
    this.#bodyMesh = new InstancedMesh(
      this.#bodyGeometry,
      this.#bodyMaterial,
      renderState.cubies.length,
    );
    this.#bodyMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.#bodyMesh.frustumCulled = false;
    this.#root.add(this.#bodyMesh);

    for (const face of ["U", "R", "F", "D", "L", "B"] as const) {
      const instances = renderState.cubies.flatMap((cubie) =>
        cubie.stickers
          .filter((sticker) => sticker.face === face)
          .map((sticker) => ({ cubieId: cubie.id, sticker })),
      );
      const material = new MeshPhysicalMaterial({
        color: FACE_COLORS[face],
        roughness: 0.25,
        metalness: 0.02,
        clearcoat: 0.78,
        clearcoatRoughness: 0.16,
      });
      const mesh = new InstancedMesh(this.#stickerGeometry, material, instances.length);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.#stickerMaterials.set(face, material);
      this.#stickerMeshes.set(face, mesh);
      this.#stickerInstances.set(face, instances);
      this.#root.add(mesh);
    }

    this.#scene.add(this.#root);
    this.#scene.add(new HemisphereLight(0xd8fff0, 0x030605, 2.5));
    const key = new DirectionalLight(0xfff2dc, 4.8);
    key.position.set(5.5, 7.5, 6.5);
    this.#scene.add(key);
    const mintRim = new PointLight(0x66ffbb, 17, 18, 1.7);
    mintRim.position.set(-5.2, 1.8, 3.8);
    this.#scene.add(mintRim);
    const violetRim = new PointLight(0x7655c7, 13, 16, 1.8);
    violetRim.position.set(4.5, -2.5, -4.5);
    this.#scene.add(violetRim);

    this.#camera.position.set(0, 0.15, variant === "hero" ? 10.4 : 10.8);
    this.#camera.lookAt(0, 0, 0);
    this.#root.scale.setScalar(variant === "hero" ? 1.09 : 0.92);

    canvas.addEventListener("pointerdown", this.#onPointerDown);
    canvas.addEventListener("pointermove", this.#onPointerMove);
    canvas.addEventListener("pointerup", this.#onPointerUp);
    canvas.addEventListener("pointercancel", this.#onPointerUp);
    document.addEventListener("visibilitychange", this.#onVisibilityChange);
    canvas.addEventListener("webglcontextlost", this.#onContextLost);
    canvas.addEventListener("webglcontextrestored", this.#onContextRestored);

    if (typeof ResizeObserver === "function") {
      this.#resizeObserver = new ResizeObserver(() => this.#resize());
      this.#resizeObserver.observe(host);
    }
    if (typeof IntersectionObserver === "function") {
      this.#intersectionObserver = new IntersectionObserver(
        ([entry]) => {
          this.#visible = entry?.isIntersecting ?? true;
          if (this.#visible) this.#start();
          else this.#stop();
        },
        { rootMargin: "120px" },
      );
      this.#intersectionObserver.observe(host);
    }
    this.#resize();
    this.#start();
  }

  public dispose(): void {
    this.#stop();
    this.#resizeObserver?.disconnect();
    this.#intersectionObserver?.disconnect();
    const canvas = this.#renderer.domElement;
    canvas.removeEventListener("pointerdown", this.#onPointerDown);
    canvas.removeEventListener("pointermove", this.#onPointerMove);
    canvas.removeEventListener("pointerup", this.#onPointerUp);
    canvas.removeEventListener("pointercancel", this.#onPointerUp);
    canvas.removeEventListener("webglcontextlost", this.#onContextLost);
    canvas.removeEventListener("webglcontextrestored", this.#onContextRestored);
    document.removeEventListener("visibilitychange", this.#onVisibilityChange);
    this.#bodyGeometry.dispose();
    this.#bodyMaterial.dispose();
    this.#stickerGeometry.dispose();
    for (const material of this.#stickerMaterials.values()) material.dispose();
    this.#renderer.dispose();
  }

  readonly #onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.#pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      yaw: this.#yaw,
      pitch: this.#pitch,
    };
    this.#renderer.domElement.setPointerCapture(event.pointerId);
    this.#host.classList.add("is-dragging");
  };

  readonly #onPointerMove = (event: PointerEvent): void => {
    const pointer = this.#pointer;
    if (pointer === undefined || pointer.id !== event.pointerId) return;
    this.#yaw = pointer.yaw + (event.clientX - pointer.startX) * 0.009;
    this.#pitch = Math.min(
      0.9,
      Math.max(-0.9, pointer.pitch + (event.clientY - pointer.startY) * 0.007),
    );
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    if (this.#pointer?.id !== event.pointerId) return;
    this.#pointer = undefined;
    this.#host.classList.remove("is-dragging");
    if (this.#renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.#renderer.domElement.releasePointerCapture(event.pointerId);
    }
  };

  readonly #onVisibilityChange = (): void => {
    this.#documentVisible = document.visibilityState !== "hidden";
    if (this.#documentVisible && this.#visible) this.#start();
    else this.#stop();
  };

  readonly #onContextLost = (event: Event): void => {
    event.preventDefault();
    this.#host.classList.add("is-context-lost");
    this.#stop();
  };

  readonly #onContextRestored = (): void => {
    this.#host.classList.remove("is-context-lost");
    this.#start();
  };

  #resize(): void {
    const bounds = this.#host.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    if (width === this.#width && height === this.#height) return;
    this.#width = width;
    this.#height = height;
    this.#renderer.setSize(width, height, false);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
  }

  #start(): void {
    if (this.#frame !== undefined || !this.#visible || !this.#documentVisible) return;
    this.#frame = requestAnimationFrame(this.#render);
  }

  #stop(): void {
    if (this.#frame === undefined) return;
    cancelAnimationFrame(this.#frame);
    this.#frame = undefined;
  }

  readonly #render = (time: number): void => {
    this.#frame = undefined;
    this.#resize();
    const renderState = rubiksCubeBenchmark.getRenderSnapshot();
    this.#cubieById.clear();
    for (const cubie of renderState.cubies) this.#cubieById.set(cubie.id, cubie);
    const rotation =
      renderState.activeMove === undefined
        ? undefined
        : activeRotation(renderState.activeMove, time);
    const bodyMatrix = new Matrix4();
    for (const [index, cubie] of renderState.cubies.entries()) {
      bodyMatrix.copy(matrixForCubie(cubie));
      if (
        rotation !== undefined &&
        cubieIsActive(cubie, renderState.activeMove as RubiksCubeActiveMove)
      ) {
        bodyMatrix.premultiply(rotation);
      }
      this.#bodyMesh.setMatrixAt(index, bodyMatrix);
    }
    this.#bodyMesh.instanceMatrix.needsUpdate = true;

    for (const [face, mesh] of this.#stickerMeshes) {
      const instances = this.#stickerInstances.get(face) ?? [];
      for (const [index, instance] of instances.entries()) {
        const cubie = this.#cubieById.get(instance.cubieId);
        if (cubie === undefined) continue;
        const stickerMatrix = matrixForCubie(cubie).multiply(localStickerMatrix(instance.sticker));
        if (
          rotation !== undefined &&
          cubieIsActive(cubie, renderState.activeMove as RubiksCubeActiveMove)
        ) {
          stickerMatrix.premultiply(rotation);
        }
        mesh.setMatrixAt(index, stickerMatrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const float = reducedMotion ? 0 : Math.sin(time * 0.00065) * 0.055;
    const ambientYaw =
      reducedMotion || this.#pointer !== undefined ? 0 : Math.sin(time * 0.00014) * 0.045;
    this.#root.position.y = float;
    this.#root.rotation.set(this.#pitch, this.#yaw + ambientYaw, 0.035);
    this.#renderer.render(this.#scene, this.#camera);
    this.#start();
  };
}

class RubiksCubeElement extends HTMLElement {
  #scene: RubiksCubeScene | undefined;
  #unsubscribe: (() => void) | undefined;
  #releaseView: (() => void) | undefined;
  #stateValue: HTMLElement | undefined;
  #entropyValue: HTMLElement | undefined;
  #revisionValue: HTMLElement | undefined;
  #moveValue: HTMLElement | undefined;
  #autoplayButton: HTMLButtonElement | undefined;

  public connectedCallback(): void {
    if (this.#scene !== undefined) return;
    const variant: RubiksCubeViewVariant =
      this.getAttribute("variant") === "connection" ? "connection" : "hero";
    this.className = `cube-view cube-view--${variant}`;
    this.tabIndex = variant === "hero" ? 0 : -1;
    this.setAttribute("role", "group");
    this.setAttribute(
      "aria-label",
      variant === "hero"
        ? "Interactive Rubik's Cube MCP benchmark"
        : "Synchronized Rubik's Cube connection state",
    );

    const canvas = element("canvas", "cube-view__canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.touchAction = "pan-y";
    const glow = element("div", "cube-view__glow");
    const grid = element("div", "cube-view__grid");
    const chrome = element("div", "cube-view__chrome");
    const top = element("div", "cube-view__topline");
    const label = element(
      "span",
      "cube-view__eyebrow",
      variant === "hero" ? "BENCHMARK / CUBE_01" : "SHARED STATE / LIVE",
    );
    const mcp = element("span", "cube-view__mcp", "MCP READY");
    top.append(label, mcp);

    const telemetry = element("div", "cube-view__telemetry");
    this.#stateValue = element("strong", "cube-view__state", "--------");
    const stateMetric = element("span", "cube-view__metric");
    stateMetric.append(element("small", undefined, "STATE"), this.#stateValue);
    this.#entropyValue = element("strong", undefined, "0%");
    const entropyMetric = element("span", "cube-view__metric");
    entropyMetric.append(element("small", undefined, "ENTROPY"), this.#entropyValue);
    this.#revisionValue = element("strong", undefined, "0");
    const revisionMetric = element("span", "cube-view__metric");
    revisionMetric.append(element("small", undefined, "REV"), this.#revisionValue);
    this.#moveValue = element("strong", undefined, "—");
    const moveMetric = element("span", "cube-view__metric");
    moveMetric.append(element("small", undefined, "MOVE"), this.#moveValue);
    telemetry.append(stateMetric, entropyMetric, revisionMetric, moveMetric);
    chrome.append(top, telemetry);

    const fallback = element("div", "cube-view__fallback", "WebGL context unavailable");
    this.replaceChildren(glow, grid, canvas, chrome, fallback);

    if (variant === "hero") {
      const controls = element("div", "cube-view__controls");
      const scrambleButton = element("button", "cube-view__control", "scramble");
      scrambleButton.type = "button";
      scrambleButton.addEventListener("click", this.#scramble);
      this.#autoplayButton = element("button", "cube-view__control", "pause");
      this.#autoplayButton.type = "button";
      this.#autoplayButton.addEventListener("click", this.#toggleAutoplay);
      controls.append(scrambleButton, this.#autoplayButton);
      const hint = element("p", "cube-view__hint", "drag to orbit · R U F D L B to turn");
      this.append(controls, hint);
      this.addEventListener("keydown", this.#onKeyDown);
    }

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.#releaseView = rubiksCubeBenchmark.acquireView(reducedMotion);
    this.#unsubscribe = rubiksCubeBenchmark.subscribe((snapshot) => this.#update(snapshot));
    try {
      this.#scene = new RubiksCubeScene(this, canvas, variant);
    } catch {
      this.classList.add("is-context-lost");
    }
  }

  public disconnectedCallback(): void {
    this.#scene?.dispose();
    this.#scene = undefined;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#releaseView?.();
    this.#releaseView = undefined;
    this.removeEventListener("keydown", this.#onKeyDown);
  }

  readonly #scramble = (): void => {
    rubiksCubeBenchmark.reset({ mode: "scrambled", length: 24 });
  };

  readonly #toggleAutoplay = (): void => {
    const snapshot = rubiksCubeBenchmark.getSnapshot();
    rubiksCubeBenchmark.setAutoplay({ enabled: !snapshot.autoplay.enabled });
  };

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLButtonElement) return;
    const face = event.key.toUpperCase();
    if (!/^[URFDLB]$/u.test(face)) return;
    event.preventDefault();
    const move = `${face}${event.shiftKey ? "'" : ""}` as RubiksCubeMove;
    void rubiksCubeBenchmark.applyMoves([move], { animated: true }).catch(() => undefined);
  };

  #update(snapshot: RubiksCubeSnapshot): void {
    this.dataset.phase = snapshot.phase;
    if (this.#stateValue !== undefined) {
      this.#stateValue.textContent = snapshot.stateId.replace("cube-", "").toUpperCase();
    }
    if (this.#entropyValue !== undefined) {
      this.#entropyValue.textContent = `${Math.round(snapshot.entropy * 100)}%`;
    }
    if (this.#revisionValue !== undefined)
      this.#revisionValue.textContent = String(snapshot.revision);
    if (this.#moveValue !== undefined) {
      this.#moveValue.textContent = snapshot.activeMove?.move ?? snapshot.lastMove ?? "—";
    }
    if (this.#autoplayButton !== undefined) {
      this.#autoplayButton.textContent = snapshot.autoplay.enabled ? "pause" : "resume";
      this.#autoplayButton.setAttribute("aria-pressed", String(!snapshot.autoplay.enabled));
    }
  }
}

if (customElements.get(ELEMENT_NAME) === undefined) {
  customElements.define(ELEMENT_NAME, RubiksCubeElement);
}

export const createRubiksCubeView = (variant: RubiksCubeViewVariant): HTMLElement => {
  const cube = document.createElement(ELEMENT_NAME);
  cube.setAttribute("variant", variant);
  return cube;
};
