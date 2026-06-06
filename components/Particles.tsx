"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { particleVertex, particleFragment } from "./shaders";

const PALETTE = [
  new THREE.Color("#6366f1"), // indigo
  new THREE.Color("#a855f7"), // violet
  new THREE.Color("#22d3ee"), // cyan
  new THREE.Color("#8b5cf6"), // purple
];

export function Particles({ count = 4000, intensity = 0 }: { count?: number; intensity?: number }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const smoothIntensity = useRef(0);

  const { positions, scales, colors } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // distribute in a flattened sphere shell for a galaxy-ish nebula
      const r = 6 + Math.pow(Math.random(), 0.7) * 16;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi) * 0.55; // flatten vertically
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      scales[i] = 0.3 + Math.random() * Math.random() * 1.4;

      const c = PALETTE[Math.floor(Math.random() * PALETTE.length)].clone();
      c.multiplyScalar(0.4 + Math.random() * 0.35);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    return { positions, scales, colors };
  }, [count]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSize: { value: 11 },
      uIntensity: { value: 0 },
    }),
    [],
  );

  useFrame((_, delta) => {
    if (!matRef.current) return;
    smoothIntensity.current += (intensity - smoothIntensity.current) * Math.min(1, delta * 2.5);
    matRef.current.uniforms.uTime.value += delta;
    matRef.current.uniforms.uIntensity.value = smoothIntensity.current;
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aScale" args={[scales, 1]} />
        <bufferAttribute attach="attributes-aColor" args={[colors, 3]} />
      </bufferGeometry>
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={particleVertex}
        fragmentShader={particleFragment}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
