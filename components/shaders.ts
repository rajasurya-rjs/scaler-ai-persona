// GLSL shader sources for the 3D scene. Kept as strings so they compile in the
// browser only (the canvas is dynamically imported, ssr:false).

// Classic Ashima 3D simplex noise (Stefan Gustavson / Ian McEwan), used by both
// the particle drift and the orb displacement.
const SIMPLEX_NOISE = /* glsl */ `
vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

// ---- Particle nebula -------------------------------------------------------
export const particleVertex = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uIntensity; // 0 idle .. 1 active
attribute float aScale;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;
${SIMPLEX_NOISE}
void main(){
  vColor = aColor;
  vec3 p = position;
  // slow swirling drift driven by noise
  float t = uTime * 0.06;
  float n1 = snoise(p * 0.18 + vec3(t, 0.0, 0.0));
  float n2 = snoise(p * 0.22 + vec3(0.0, t, 10.0));
  float n3 = snoise(p * 0.20 + vec3(5.0, 0.0, t));
  vec3 drift = vec3(n1, n2, n3) * (0.55 + uIntensity * 0.6);
  p += drift;
  // gentle global rotation
  float a = uTime * 0.02;
  mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
  p.xz = rot * p.xz;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * aScale * (1.0 + uIntensity * 0.4) * (300.0 / -mv.z);
  vAlpha = smoothstep(0.0, 1.0, aScale) * (0.32 + uIntensity * 0.4);
}
`;

export const particleFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main(){
  // soft round sprite
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float alpha = smoothstep(0.5, 0.0, d);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(vColor, alpha * vAlpha);
}
`;

// ---- AI presence orb -------------------------------------------------------
// fbm + domain warping for an organic, liquid/plasma surface (not a smooth blob).
const FBM = /* glsl */ `
float fbm(vec3 p){
  float v = 0.0; float a = 0.5;
  for(int i = 0; i < 5; i++){ v += a * snoise(p); p *= 2.0; a *= 0.5; }
  return v;
}
float warp(vec3 p, float t){
  vec3 q = vec3(fbm(p + vec3(0.0, 0.0, t)), fbm(p + vec3(5.2, 1.3, t)), fbm(p + vec3(1.7, 9.2, t)));
  return fbm(p + 1.6 * q);
}
`;

const HSV = /* glsl */ `
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
`;

export const orbVertex = /* glsl */ `
uniform float uTime;
uniform float uState;   // 0 idle .. 1 thinking
uniform float uPulse;   // transient burst while streaming
varying vec3 vNormal;
varying vec3 vView;
varying float vDisp;
${SIMPLEX_NOISE}
${FBM}
void main(){
  float speed = mix(0.22, 0.6, uState);
  float amp = mix(0.10, 0.22, uState) + uPulse * 0.12;
  float t = uTime * speed;
  float w = warp(normal * 1.7 + vec3(0.0, 0.0, t * 0.5), t);
  vDisp = w;
  vec3 p = position + normal * (w * amp);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

export const orbFragment = /* glsl */ `
uniform float uTime;
uniform float uState;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorHot;
varying vec3 vNormal;
varying vec3 vView;
varying float vDisp;
${HSV}
void main(){
  float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.6);
  // iridescent / holographic hue driven by view angle, surface flow and time
  float hue = 0.63 + vDisp * 0.10 + fres * 0.16 + sin(uTime * 0.25) * 0.02;
  vec3 irid = hsv2rgb(vec3(fract(hue), 0.5, 1.0));
  vec3 base = mix(uColorA, uColorB, smoothstep(-0.35, 0.35, vDisp));
  vec3 col = base * 0.42 + irid * fres * (0.75 + uState * 0.5);
  // hot cyan core influence while thinking
  col += uColorHot * fres * uState * 0.45;
  gl_FragColor = vec4(col, 1.0);
}
`;

// Atmospheric glow shell — a slightly larger back-faced sphere rendered additive
// so its fresnel rim wraps the core in a soft volumetric halo.
export const orbGlowVertex = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

export const orbGlowFragment = /* glsl */ `
uniform float uState;
uniform vec3 uGlow;
uniform vec3 uGlowHot;
varying vec3 vNormal;
varying vec3 vView;
void main(){
  float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.2);
  float a = fres * (0.55 + uState * 0.4);
  vec3 c = mix(uGlow, uGlowHot, uState);
  // boost rim brightness so it crosses the bloom threshold into a soft halo
  gl_FragColor = vec4(c * a * 1.5, a);
}
`;
