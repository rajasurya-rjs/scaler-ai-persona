"use client";

import { useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { Particles } from "./Particles";
import { Orb, type AgentState } from "./Orb";

// Camera drifts toward the cursor for subtle parallax depth.
function CursorParallax() {
  useFrame((state, delta) => {
    const tx = state.pointer.x * 0.7;
    const ty = state.pointer.y * 0.45;
    const k = Math.min(1, delta * 1.4);
    state.camera.position.x += (tx - state.camera.position.x) * k;
    state.camera.position.y += (ty - state.camera.position.y) * k;
    state.camera.lookAt(0, 0, 0);
  });
  return null;
}

function adaptiveParticleCount(): number {
  if (typeof window === "undefined") return 2600;
  const w = window.innerWidth;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (w < 768) return 1400;
  if (cores <= 4) return 2400;
  return 3400;
}

export default function Scene3D({ state = "idle" }: { state?: AgentState }) {
  const count = useMemo(adaptiveParticleCount, []);
  const intensity = state === "thinking" ? 1 : state === "streaming" ? 0.7 : 0.22;

  return (
    <Canvas
      // Fixed dpr (no AdaptiveDpr) — dynamic dpr resizes the post-processing
      // render targets and causes the black flicker.
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 10], fov: 52 }}
      // Opaque canvas with its own clear colour = stable, no compositing flicker.
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance", stencil: false, depth: true }}
      style={{ position: "fixed", inset: 0, zIndex: 0 }}
    >
      <color attach="background" args={["#05060a"]} />
      <fog attach="fog" args={["#05060a", 13, 32]} />
      <CursorParallax />
      <Orb state={state} />
      <Particles count={count} intensity={intensity} />
      <EffectComposer multisampling={0}>
        {/* Bloom tuned so the orb's halo + iridescent rim glow, not the whole screen. */}
        <Bloom intensity={0.62} luminanceThreshold={0.45} luminanceSmoothing={0.26} mipmapBlur radius={0.62} />
        <Vignette eskil={false} offset={0.3} darkness={0.74} />
      </EffectComposer>
    </Canvas>
  );
}
