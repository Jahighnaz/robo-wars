// Shaders and procedural textures for the neon 3D look.
import * as THREE from 'three';
import { ICONS } from '../icons';

/**
 * Neon block material: dark body, bright glowing edges on every face, optional
 * icon on the top face from an atlas. Works with InstancedMesh (per-instance
 * colour, icon index). Edge colour is pushed above 1.0 so the bloom pass picks it up.
 */
export function neonMaterial(opts: { edge?: number; glow?: number; body?: number; atlas?: THREE.Texture | null; iconCount?: number } = {}) {
  const atlas = opts.atlas ?? null;
  return new THREE.ShaderMaterial({
    defines: atlas ? { USE_ATLAS: '' } : {},
    uniforms: {
      uEdge: { value: opts.edge ?? 0.09 },
      uGlow: { value: opts.glow ?? 2.2 },
      uBody: { value: opts.body ?? 0.22 },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uAtlas: { value: atlas },
      uIcons: { value: opts.iconCount ?? 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aIcon;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vCol;
      varying float vIcon;
      uniform vec3 uColor;
      void main() {
        vUv = uv;
        #ifdef USE_INSTANCING
          mat4 m = modelMatrix * instanceMatrix;
        #else
          mat4 m = modelMatrix;
        #endif
        vN = normalize(mat3(m) * normal);
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = uColor;
        #endif
        #ifdef USE_ATLAS
          vIcon = aIcon;
        #else
          vIcon = -1.0;
        #endif
        gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uEdge;
      uniform float uGlow;
      uniform float uBody;
      uniform sampler2D uAtlas;
      uniform float uIcons;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vCol;
      varying float vIcon;
      void main() {
        vec2 d = min(vUv, 1.0 - vUv);
        float e = min(d.x, d.y);
        float edge = 1.0 - smoothstep(uEdge * 0.55, uEdge, e);
        float light = 0.45 + 0.4 * max(vN.y, 0.0) + 0.3 * max(dot(vN, normalize(vec3(-0.5, 0.7, 0.6))), 0.0);
        vec3 col = mix(vCol * uBody * light, vCol * uGlow, edge);
        #ifdef USE_ATLAS
          if (vN.y > 0.5 && vIcon >= 0.0) {
            vec2 iuv = vec2((vIcon + clamp(vUv.x, 0.0, 1.0)) / uIcons, vUv.y);
            float a = texture2D(uAtlas, iuv).a;
            col = mix(col, vCol * uGlow * 0.9, a);
          }
        #endif
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Unlit emissive material (projectiles, beams, sparks); instance colour × intensity. */
export function glowMaterial(intensity = 3, additive = false) {
  return new THREE.ShaderMaterial({
    uniforms: { uI: { value: intensity } },
    transparent: additive,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !additive,
    vertexShader: /* glsl */ `
      varying vec3 vCol;
      void main() {
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0);
        #endif
        #ifdef USE_INSTANCING
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
        #endif
      }`,
    fragmentShader: /* glsl */ `
      uniform float uI;
      varying vec3 vCol;
      void main() {
        gl_FragColor = vec4(vCol * uI, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Flat additive decal (glows, halos, rings) using a texture's alpha; instance colour tints. */
export function decalMaterial(tex: THREE.Texture, intensity = 1.4) {
  return new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex }, uI: { value: intensity } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vCol;
      void main() {
        vUv = uv;
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0);
        #endif
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex;
      uniform float uI;
      varying vec2 vUv;
      varying vec3 vCol;
      void main() {
        float a = texture2D(uTex, vUv).a;
        gl_FragColor = vec4(vCol * uI * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** Procedural ground: dark floor with a two-level neon grid that fades with distance. */
export function groundMaterial(bg: THREE.Color, grid: THREE.Color) {
  return new THREE.ShaderMaterial({
    uniforms: { uBg: { value: bg }, uGrid: { value: grid }, uCam: { value: new THREE.Vector3() } },
    extensions: {} as THREE.ShaderMaterial['extensions'],
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBg;
      uniform vec3 uGrid;
      uniform vec3 uCam;
      varying vec3 vW;
      float gridLine(vec2 p, float size, float w) {
        vec2 g = abs(fract(p / size - 0.5) - 0.5) * size;
        vec2 fw = fwidth(p);
        vec2 l = 1.0 - smoothstep(vec2(w) - fw, vec2(w) + fw, g);
        return max(l.x, l.y);
      }
      void main() {
        float minor = gridLine(vW.xz, 64.0, 0.45);
        float major = gridLine(vW.xz, 256.0, 0.9);
        float dist = length(vW.xz - uCam.xz);
        float fade = 1.0 - smoothstep(500.0, 1500.0, dist);
        vec3 col = uBg + uGrid * (minor * 0.045 + major * 0.14) * (0.35 + 0.65 * fade);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------- textures
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export const radialTexture = () => canvasTex(128, 128, g => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
});

export const ringTexture = () => canvasTex(128, 128, g => {
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 7;
  g.shadowColor = '#fff'; g.shadowBlur = 10;
  g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
});

/** Atlas of block icons (white strokes on transparent), one 64px cell per block type. */
export function iconAtlas(types: string[]): THREE.CanvasTexture {
  const S = 128;
  const tex = canvasTex(S * types.length, S, g => {
    types.forEach((t, i) => {
      g.save();
      g.translate(i * S + S * 0.2, S * 0.2);
      g.scale((S * 0.6) / 24, (S * 0.6) / 24);
      g.strokeStyle = '#fff'; g.lineWidth = 2.3; g.lineJoin = 'round'; g.lineCap = 'round';
      g.stroke(new Path2D(ICONS[t] || ICONS.cab));
      g.restore();
    });
  });
  tex.flipY = true;
  tex.anisotropy = 4;
  return tex;
}

export function hazardTexture(color: string, edge: string, kind: string): THREE.CanvasTexture {
  const hexA = (hex: string, a: number) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  const W = 256, o = W / 2;
  return canvasTex(W, W, g => {
    const gr = g.createRadialGradient(o, o, 0, o, o, o);
    gr.addColorStop(0, hexA(color, kind === 'ice' ? 0.35 : 0.75));
    gr.addColorStop(0.85, hexA(color, kind === 'ice' ? 0.25 : 0.5));
    gr.addColorStop(1, hexA(color, 0));
    g.fillStyle = gr; g.beginPath(); g.arc(o, o, o, 0, Math.PI * 2); g.fill();
    g.strokeStyle = hexA(edge, 0.9); g.lineWidth = 4; g.setLineDash([12, 9]);
    g.beginPath(); g.arc(o, o, o * 0.9, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    if (kind === 'ice') {
      g.strokeStyle = hexA(edge, 0.6); g.lineWidth = 2;
      for (let i = 0; i < 10; i++) {
        let x = o + (rnd() - 0.5) * o, y = o + (rnd() - 0.5) * o;
        g.beginPath(); g.moveTo(x, y);
        for (let j = 0; j < 4; j++) { x += (rnd() - 0.5) * 60; y += (rnd() - 0.5) * 60; g.lineTo(x, y); }
        g.stroke();
      }
    } else {
      for (let i = 0; i < 30; i++) {
        const a = rnd() * Math.PI * 2, rr = rnd() * o * 0.75;
        g.fillStyle = hexA(kind === 'lava' ? '#ffd27a' : edge, kind === 'lava' ? 0.55 : 0.3);
        g.beginPath(); g.arc(o + Math.cos(a) * rr, o + Math.sin(a) * rr, 3 + rnd() * 9, 0, Math.PI * 2); g.fill();
      }
    }
  });
}

/** Circular saw blade (white on transparent), tinted by the decal shader. */
export const sawTexture = () => canvasTex(128, 128, g => {
  const o = 64, teeth = 18;
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2, a1 = ((i + 0.6) / teeth) * Math.PI * 2;
    g.lineTo(o + Math.cos(a0) * 50, o + Math.sin(a0) * 50);
    g.lineTo(o + Math.cos(a1) * 62, o + Math.sin(a1) * 62);
  }
  g.closePath(); g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(o, o, 34, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.beginPath(); g.arc(o, o, 34, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,1)';
  g.beginPath(); g.arc(o, o, 9, 0, Math.PI * 2); g.fill();
});
