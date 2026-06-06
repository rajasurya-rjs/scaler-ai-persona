"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { orbVertex, orbFragment, orbGlowVertex, orbGlowFragment } from "./shaders";

export type AgentState = "idle" | "thinking" | "streaming";

export function Orb({ state = "idle" }: { state?: AgentState }) {
  const coreMat = useRef<THREE.ShaderMaterial>(null);
  const glowMat = useRef<THREE.ShaderMaterial>(null);
  const group = useRef<THREE.Group>(null);
  const cur = useRef(0); // smoothed uState

  const coreUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uState: { value: 0 },
      uPulse: { value: 0 },
      uColorA: { value: new THREE.Color("#241a52") },
      uColorB: { value: new THREE.Color("#a855f7") },
      uColorHot: { value: new THREE.Color("#22d3ee") },
    }),
    [],
  );

  const glowUniforms = useMemo(
    () => ({
      uState: { value: 0 },
      uGlow: { value: new THREE.Color("#6d5bff") },
      uGlowHot: { value: new THREE.Color("#22d3ee") },
    }),
    [],
  );

  useFrame((st, delta) => {
    const target = state === "thinking" ? 1 : state === "streaming" ? 0.6 : 0;
    cur.current += (target - cur.current) * Math.min(1, delta * 3);

    if (coreMat.current) {
      const u = coreMat.current.uniforms;
      u.uTime.value += delta;
      u.uState.value = cur.current;
      const pulseTarget = state === "streaming" ? Math.sin(st.clock.elapsedTime * 5.0) * 0.5 + 0.5 : 0;
      u.uPulse.value += (pulseTarget - u.uPulse.value) * Math.min(1, delta * 4);
    }
    if (glowMat.current) glowMat.current.uniforms.uState.value = cur.current;

    if (group.current) {
      group.current.rotation.y += delta * (0.06 + cur.current * 0.16);
      group.current.rotation.x += delta * 0.02;
      // gentle breathing scale
      const s = 1 + Math.sin(st.clock.elapsedTime * 0.8) * 0.015 + cur.current * 0.03;
      group.current.scale.setScalar(s);
    }
  });

  return (
    <group ref={group}>
      {/* plasma core */}
      <mesh>
        <icosahedronGeometry args={[2.0, 6]} />
        <shaderMaterial ref={coreMat} uniforms={coreUniforms} vertexShader={orbVertex} fragmentShader={orbFragment} />
      </mesh>
      {/* atmospheric glow halo (back-faced, additive) */}
      <mesh scale={1.22}>
        <icosahedronGeometry args={[2.0, 3]} />
        <shaderMaterial
          ref={glowMat}
          uniforms={glowUniforms}
          vertexShader={orbGlowVertex}
          fragmentShader={orbGlowFragment}
          side={THREE.BackSide}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}
