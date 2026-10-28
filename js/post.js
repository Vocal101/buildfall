'use strict';
// Post-processing: the scene renders into a multisampled half-float target, then a bloom chain
// (threshold, 5-level dual-filter blur) and a final pass with filmic tone mapping, colour grading,
// vignette, a red damage pulse and dithering.

const Post = (() => {
  // shared GLSL: the tone curve (Narkowicz ACES fit, per channel) and its inverse
  const GLSL = `
    vec3 tone(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
    vec3 invTone(vec3 y){
      y = clamp(y, 0.0, 0.985);
      vec3 a = 2.51 - 2.43*y, b = 0.03 - 0.59*y, c = -0.14*y;
      return (-b + sqrt(b*b - 4.0*a*c)) / (2.0*a);
    }
    vec3 toLin(vec3 c){ return pow(max(c, 0.0), vec3(2.2)); }
  `;
  let renderer, main = null, downs = [], ups = [], qScene, qCam, quad;
  let mBright, mDown, mUp, mFinal;
  let enabled = true, bloomOn = true, w = 1, h = 1;
  const LEVELS = 5;
  const uniforms = { exposure: 0.8, bloom: 0.5, vignette: 0.3, sat: 1.0, contrast: 1.08, hurt: 0, storm: 0 };

  const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  function mat(fs, u) { return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false }); }

  function init(r) {
    renderer = r;
    qScene = new THREE.Scene(); qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quad.frustumCulled = false; qScene.add(quad);
    mBright = mat(`uniform sampler2D src; uniform vec2 texel; uniform float thr; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(src, vUv + texel*vec2(-1,-1)).rgb + texture2D(src, vUv + texel*vec2(1,-1)).rgb + texture2D(src, vUv + texel*vec2(-1,1)).rgb + texture2D(src, vUv + texel*vec2(1,1)).rgb;
        c *= 0.25;
        float br = max(c.r, max(c.g, c.b));
        float soft = clamp(br - thr + 0.5, 0.0, 1.0); soft = soft*soft*0.5;
        float k = max(soft, br - thr) / max(br, 1e-4);
        gl_FragColor = vec4(min(c * k, vec3(40.0)), 1.0);
      }`, { src: { value: null }, texel: { value: new THREE.Vector2() }, thr: { value: 1.0 } });
    mDown = mat(`uniform sampler2D src; uniform vec2 texel; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(src, vUv).rgb * 4.0;
        c += texture2D(src, vUv + texel*vec2(-1,-1)).rgb + texture2D(src, vUv + texel*vec2(1,-1)).rgb;
        c += texture2D(src, vUv + texel*vec2(-1,1)).rgb + texture2D(src, vUv + texel*vec2(1,1)).rgb;
        gl_FragColor = vec4(c / 8.0, 1.0);
      }`, { src: { value: null }, texel: { value: new THREE.Vector2() } });
    mUp = mat(`uniform sampler2D src; uniform sampler2D cur; uniform vec2 texel; uniform float k; varying vec2 vUv;
      void main(){
        vec3 c = vec3(0.0);
        c += texture2D(src, vUv + texel*vec2(-2,0)).rgb + texture2D(src, vUv + texel*vec2(2,0)).rgb;
        c += texture2D(src, vUv + texel*vec2(0,-2)).rgb + texture2D(src, vUv + texel*vec2(0,2)).rgb;
        c += (texture2D(src, vUv + texel*vec2(-1,-1)).rgb + texture2D(src, vUv + texel*vec2(1,-1)).rgb + texture2D(src, vUv + texel*vec2(-1,1)).rgb + texture2D(src, vUv + texel*vec2(1,1)).rgb) * 2.0;
        gl_FragColor = vec4(texture2D(cur, vUv).rgb + c / 12.0 * k, 1.0);
      }`, { src: { value: null }, cur: { value: null }, texel: { value: new THREE.Vector2() }, k: { value: 1 } });
    mFinal = mat(GLSL + `uniform sampler2D scene; uniform sampler2D bloomT; uniform float bloom, exposure, vignette, sat, contrast, hurt, storm, time; uniform vec2 res;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec3 c = texture2D(scene, vUv).rgb;
        c += texture2D(bloomT, vUv).rgb * bloom;
        c = tone(c * exposure);
        // linear -> sRGB
        c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(vec3(l), c, sat);
        c = (c - 0.5) * contrast + 0.5;
        // gentle split toning: warm highlights, cool shadows
        c += vec3(0.02, 0.01, -0.015) * smoothstep(0.5, 1.0, l) + vec3(-0.01, 0.0, 0.02) * (1.0 - smoothstep(0.0, 0.4, l));
        vec2 q = vUv - 0.5; q.x *= res.x / res.y;
        float d = length(q);
        c *= 1.0 - vignette * smoothstep(0.45, 1.05, d);
        c = mix(c, vec3(0.62, 0.05, 0.04), hurt * smoothstep(0.35, 0.95, d) * 0.7);
        c = mix(c, c * vec3(0.85, 0.7, 1.08), storm * 0.15);
        c += (hash(vUv * res + time) - 0.5) / 255.0;
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`, { scene: { value: null }, bloomT: { value: null }, bloom: { value: 0.5 }, exposure: { value: 1 }, vignette: { value: 0.3 }, sat: { value: 1.1 }, contrast: { value: 1.05 }, hurt: { value: 0 }, storm: { value: 0 }, time: { value: 0 }, res: { value: new THREE.Vector2(1, 1) } });
  }

  function setSize(W, H, quality) {
    w = Math.max(1, W | 0); h = Math.max(1, H | 0);
    bloomOn = quality !== 'low';
    const samples = quality === 'low' ? 0 : quality === 'medium' ? 2 : 4;
    if (main) main.dispose();
    main = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthBuffer: true });
    for (const t of downs.concat(ups)) t.dispose();
    downs = []; ups = [];
    let bw = w >> 1, bh = h >> 1;
    for (let i = 0; i < LEVELS; i++) {
      const o = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
      downs.push(new THREE.WebGLRenderTarget(Math.max(1, bw), Math.max(1, bh), o));
      ups.push(new THREE.WebGLRenderTarget(Math.max(1, bw), Math.max(1, bh), o));
      bw >>= 1; bh >>= 1;
    }
    mFinal.uniforms.res.value.set(w, h);
  }

  function pass(m, target) {
    quad.material = m;
    renderer.setRenderTarget(target);
    renderer.render(qScene, qCam);
  }

  function render(scene, camera, time) {
    if (!enabled || !main) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }
    renderer.setRenderTarget(main);
    renderer.render(scene, camera);
    let bloomTex = null;
    if (bloomOn) {
      mBright.uniforms.src.value = main.texture; mBright.uniforms.texel.value.set(1 / w, 1 / h);
      pass(mBright, downs[0]);
      for (let i = 1; i < LEVELS; i++) {
        mDown.uniforms.src.value = downs[i - 1].texture; mDown.uniforms.texel.value.set(1 / downs[i - 1].width, 1 / downs[i - 1].height);
        pass(mDown, downs[i]);
      }
      // walk back up: each level adds the blurred level below it
      let prev = downs[LEVELS - 1];
      for (let i = LEVELS - 2; i >= 0; i--) {
        mUp.uniforms.src.value = prev.texture; mUp.uniforms.cur.value = downs[i].texture;
        mUp.uniforms.texel.value.set(1 / prev.width, 1 / prev.height); mUp.uniforms.k.value = 1.0;
        pass(mUp, ups[i]);
        prev = ups[i];
      }
      bloomTex = ups[0].texture;
    }
    const u = mFinal.uniforms;
    u.scene.value = main.texture; u.bloomT.value = bloomTex || main.texture; u.bloom.value = bloomTex ? uniforms.bloom : 0;
    u.exposure.value = uniforms.exposure; u.vignette.value = uniforms.vignette; u.sat.value = uniforms.sat; u.contrast.value = uniforms.contrast;
    u.hurt.value = uniforms.hurt; u.storm.value = uniforms.storm; u.time.value = (time || 0) % 100;
    pass(mFinal, null);
  }

  return { init, setSize, render, GLSL, uniforms, set enabled(v) { enabled = v; }, get enabled() { return enabled; } };
})();
