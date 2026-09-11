const worldBgShader = `
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uShift;      // camera offset — nudged on each route change
uniform float uSteps;     // per-device march budget (≤ MAX_STEPS) — perf tier
uniform float uBright;    // glow brightness — dimmed off-home / below the fold
uniform float uFocusY;    // vertical placement in uv units (+ = up) — phone hero gap

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG  — a slow-turning volumetric KIFS fractal, lit in the site's amber/ember.
// Tweak the whole mood from here.
// ─────────────────────────────────────────────────────────────────────────────
const float CAM_ROT_X = 0.06;    // how fast the structure tumbles (slow = calm)
const float CAM_ROT_Y = 0.04;
const float GRAIN     = 0.045;   // film grain — the "window" texture

// Framing adapts to aspect ratio (computed in main): on a wide desktop the
// structure is pushed well to the right and a touch brighter; on a tall phone
// it's pulled back toward centre and dimmed harder so foreground text stays
// readable. (.x = portrait/mobile, .y = landscape/desktop)
const vec2 DIM      = vec2(0.34, 0.62);   // overall brightness
// Rightward shift (+ = right). Portrait is a fraction of screen width, so the
// structure stays centre-right on narrow phones instead of hanging off the
// edge; landscape is in screen heights.
const vec2 OFFSET_X = vec2(0.14, 0.38);

// Palette — warm amber → ember, pulled from the site accent (--site-accent).
const vec3 COL_HOT   = vec3(1.000, 0.820, 0.420);  // bright gold core
const vec3 COL_AMBER = vec3(0.961, 0.620, 0.043);  // #f59e0b accent
const vec3 COL_EMBER = vec3(0.620, 0.180, 0.030);  // deep rust ember
const vec3 NAVY      = vec3(0.039, 0.051, 0.078);  // #0a0d14 page background

// Fractal shaping (baked from the lil-gui defaults).
const float WARP_FREQ   = 56.3;
const float WARP_AMP    = 0.29;
const vec3  FOLD        = vec3(0.5, 0.4, 0.4);
const vec3  ROT         = vec3(0.2, 1.6, -2.9);
const float SCALE_MULT  = 2.65;
const float SCALE_ACCUM = 7.48;
const vec3  RAYS        = vec3(0.30, 0.25, 0.55);

// Orbit-trap data, written by map(), read for colouring.
vec3 orbitTrap;

// Field rotation for this frame. It depends only on uniforms, so main()
// computes it once per pixel instead of map() redoing the sin/cos every step.
mat2 fieldRotXZ;
mat2 fieldRotXY;

// High-quality, artifact-free spatial hash.
float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c);
}

// Distance function: asymmetric KIFS fold + domain warp, smooth-merged into rays.
float map(vec3 p) {
    // Slow rotation of the whole field (see main()).
    p.xz *= fieldRotXZ;
    p.xy *= fieldRotXY;

    vec3 q = p;
    float scale = 0.26;
    orbitTrap = vec3(1000.0);

    for (int i = 0; i < 1; i++) {
        q += sin(q.zxy * WARP_FREQ) * WARP_AMP;   // domain warp
        q = abs(q) - FOLD;                          // asymmetric fold

        q.xy *= rot(ROT.x);
        q.xz *= rot(ROT.y);
        q.yz *= rot(ROT.z);

        q *= SCALE_MULT;
        scale *= SCALE_ACCUM;

        orbitTrap = min(orbitTrap, abs(q));
    }

    // Three cylinders acting as intersecting rays.
    float raysX = length(q.yz) - RAYS.x;
    float raysY = length(q.xz) - RAYS.y;
    float raysZ = length(q.xy) - RAYS.z;

    float k = 0.1;

    float h1 = clamp(6.7 + 0.1 * (raysX - raysY) / k, 0.1, 0.4);
    float mergedRays = mix(raysX, raysY, h1) - k * h1 * (1.0 - h1);

    float h2 = clamp(0.1 + 0.1 * (mergedRays - raysZ) / k, 0.0, 0.8);
    mergedRays = mix(mergedRays, raysZ, h2) - k * h2 * (-7.3 - h2);

    float core = length(p) - 0.44;        // central glowing nucleus
    mergedRays /= scale;

    float h3 = clamp(0.5 + 0.5 * (core - mergedRays) / 0.3, 0.0, 1.0);
    float d = mix(core, mergedRays, h3) - 0.3 * h3 * (1.0 - h3);

    return d * 0.3;
}

void main() {
    // Slow rotation of the whole field. uShift gently reorients on route changes.
    fieldRotXZ = rot(uTime * CAM_ROT_X + uShift.x * 0.02);
    fieldRotXY = rot(uTime * CAM_ROT_Y + uShift.y * 0.02);

    vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;

    // 0 = portrait phone, 1 = wide desktop — drives framing + brightness.
    float aspect  = uResolution.x / uResolution.y;
    float land    = smoothstep(0.85, 1.35, aspect);
    float offsetX = mix(OFFSET_X.x * aspect, OFFSET_X.y, land);
    float dim     = mix(DIM.x, DIM.y, land);

    uv.x -= offsetX;   // shift the view so the structure sits right of centre
    uv.y -= uFocusY;   // and up/down onto the spot the page leaves free for it

    vec3 ro = vec3(0.0, 0.0, -4.5);
    vec3 rd = normalize(vec3(uv, 1.0));

    // Dither the ray start to break up banding in the volume.
    float t = hash(gl_FragCoord.xy + mod(uTime, 100.0) * 10.0) * 0.05;

    vec3 glow = vec3(0.0);

    // MAX_STEPS is constant (GLSL ES 1.00 needs a constant bound); uSteps trims
    // the real budget per device. Two early-outs: leaving the volume, and the
    // glow reaching effective saturation (cheap on the expensive bright core).
    const int MAX_STEPS = 90;
    for (int i = 0; i < MAX_STEPS; i++) {
        if (i >= int(uSteps)) break;

        vec3 p = ro + rd * t;
        float d = map(p);

        // Colour by orbit-trap: gold core → amber → deep ember.
        vec3 stepColor = mix(COL_HOT, COL_AMBER, smoothstep(0.0, 1.0, orbitTrap.x));
        stepColor = mix(stepColor, COL_EMBER, smoothstep(0.0, 1.0, orbitTrap.y));

        glow += stepColor * (0.0035 / (abs(d) + 0.005));

        t += abs(d) * 0.45 + 0.015;
        if (t > 10.0) break;

        // Once glow*dim*uBright is past the ACES knee the pixel is already
        // white — further steps can't change the result, so bail. (Folding in
        // uBright keeps dimmed pages from breaking before they're meant to.)
        if (max(glow.r, max(glow.g, glow.b)) * dim * uBright > 4.0) break;
    }

    // Vignette so the structure sits in a pool of dark and never fights the text.
    float vignette = 1.0 - dot(uv, uv) * 0.55;
    glow *= vignette * dim * uBright;

    // ACES tonemap.
    glow = (glow * (2.38 * glow - 0.04)) / (glow * (2.35 * glow + 1.52) + 0.14);

    // Composite the glow over the page's navy so the canvas blends seamlessly.
    vec3 color = NAVY + glow;

    // Film grain — the texture of the "window" onto this world.
    float grain = hash(gl_FragCoord.xy + mod(uTime, 1000.0) * 15.0);
    color += (grain - 0.5) * GRAIN;

    // Break up 8-bit banding.
    color += (hash(gl_FragCoord.xy + 123.456) * 2.0 - 1.0) / 255.0;

    gl_FragColor = vec4(color, 1.0);
}
`;

export default worldBgShader;
