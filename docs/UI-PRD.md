# UI PRD — "The Mind": an immersive 3D AI-persona chat

## 1. Vision
Turn the functional chat into a **jaw-dropping, cinematic experience** that *feels like
talking to a living AI*. A deep-space canvas with a reactive, glowing **AI presence
orb** floating in a slowly swirling **particle nebula**, fronted by a frosted-glass
chat that streams replies **token-by-token like ChatGPT**. The orb visibly **reacts to
the conversation** — calm when idle, energized while thinking, rippling while speaking.

Inspiration vibe (immersive, dreamy, 3D depth — but original, not a clone):
awwwards-style WebGL hero scenes. We build our own scene, not anyone else's.

## 2. Design language
- **Mood:** dark, deep, premium. Near-black background (#05060a) with depth.
- **Palette:** indigo `#6366f1` → violet `#a855f7` → cyan `#22d3ee` gradient accents on
  black; warm white text `#e9edf7`; muted `#8a93a8`.
- **Typeface:** system UI stack, tight tracking on headings; comfortable 15px body.
- **Surfaces:** glassmorphism — `backdrop-filter: blur(20px)`, 1px hairline gradient
  border, soft inner highlight, large soft shadow. Rounded 18–22px.
- **Motion:** everything eases in (cubic-bezier), nothing pops. Framer Motion for
  message entry, caret blink, state transitions. 60fps target.
- **Glow:** bloom post-processing on the 3D layer; CSS vignette + faint film grain
  overlay for cinematic finish.

## 3. The 3D scene (the "wow")
React Three Fiber canvas, fixed full-viewport, behind the chat (`z-index: 0`).
1. **Particle nebula** — ~3,000–6,000 GPU points (BufferGeometry + custom
   vertex/fragment shader), additive blending, slow curl/sine drift, gradient-colored,
   soft round sprites. Adaptive count by device.
2. **AI presence orb** — an icosahedron with **vertex-displacement** noise (organic
   "breathing" blob) + **fresnel rim glow**. Drives emotion via a `state` uniform:
   - `idle` → slow breathe, gentle hue.
   - `thinking` → faster, higher distortion, brighter, hue shifts toward cyan.
   - `streaming` → outward ripples / pulse synced to tokens.
3. **Bloom** (`@react-three/postprocessing`) for the glow halo — the jaw-drop factor.
4. **Mouse parallax** — camera/orb drift toward cursor (lerped, subtle).
5. **Cinematic depth** — slight fog, vignette.

## 4. Streaming chat (the "real AI" feel)
- **Transport:** Server-Sent Events from `POST /api/chat/stream`. SSE chosen over
  WebSocket (one-way server→client; simpler, resilient).
- **Events:** `token` (text delta), `status` (e.g. "Checking my calendar…" during a
  tool call), `done` (citations, injectionFlagged), `error`.
- **Server:** `lib/generate.ts → chatStream()` async generator. Keeps our Groq→
  OpenRouter **fallback** and **tool-calling** (booking) intact: streams the final
  text; when the model calls a tool, emit a `status` event, run it, continue.
- **Client:** read the stream, **batch** token appends via `requestAnimationFrame` to
  avoid render storms; render a **blinking caret** while streaming; auto-scroll.
- **Markdown:** render replies with `react-markdown` + `remark-gfm` (bold, lists,
  code blocks with subtle styling) — ChatGPT-grade legibility.

## 5. Components
```
app/page.tsx                 orchestrator: state (idle|thinking|streaming), history
components/Scene3D.tsx        R3F <Canvas> (dynamic import, ssr:false) — orb+particles+bloom
components/Orb.tsx            displaced icosahedron + fresnel + state uniform
components/Particles.tsx      GPU points nebula
components/ChatPanel.tsx      glass panel, message list, composer
components/Message.tsx        bubble + avatar + markdown + streaming caret
components/lib/shaders.ts     GLSL strings (orb + particles)
lib/useChatStream.ts         client hook: SSE read, rAF-batched tokens, state
```

## 6. Performance budget (must stay live on free tier)
- `dpr` clamped `[1, 1.75]`; particle count scales down on mobile / low cores.
- **Pause render loop when tab hidden** and when reduced-motion is set.
- 3D canvas **lazy-loaded** (`next/dynamic`, `ssr:false`) so SSR/first paint isn't
  blocked and there's a graceful no-WebGL fallback (static gradient).
- `prefers-reduced-motion`: freeze orb, static nebula, instant (non-streamed render OK).
- Target: ≥50fps mid-range laptop; no layout shift; first paint < 1s (chat usable even
  before WebGL warms up).

## 7. Accessibility & fallback
- Respect `prefers-reduced-motion`. Keyboard: Enter to send, Shift+Enter newline.
- Chat is fully usable with WebGL disabled (background degrades to CSS gradient).
- Sufficient contrast for text over the dark scene; focus rings on inputs/buttons.

## 8. Acceptance criteria
- [ ] 3D nebula + reactive orb render with bloom; orb changes with idle/thinking/streaming.
- [ ] Replies stream token-by-token with a caret; markdown renders cleanly.
- [ ] Booking still works (tool-call → status pill → streamed confirmation).
- [ ] Citations + injection-flag still surface.
- [ ] Smooth on a laptop; degrades gracefully on mobile / reduced-motion / no-WebGL.
- [ ] `next build` green; no SSR crash; deploys to Vercel free tier.
- [ ] Provider fallback (Groq→OpenRouter) preserved through streaming.

## 9. Explicit non-goals
- No login/accounts, no multi-room, no persistence beyond the session.
- Not chasing pixel-cloning the inspiration link; we want *our* identity.
