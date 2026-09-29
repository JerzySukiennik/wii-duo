// One composite pass: scene → HDR render target → ACES + grading + grain + vignette +
// chromatic aberration + proximity interference + flashes. Render targets are linear, so
// tone mapping and the sRGB encode happen here, by hand.
import * as THREE from 'three';

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.u = {
      tScene: { value: this.rt.texture }, uRes: { value: new THREE.Vector2(size.x, size.y) },
      uTime: { value: 0 }, uExposure: { value: 1.0 }, uFear: { value: 0 }, uStatic: { value: 0 },
      uFlash: { value: 0 }, uRed: { value: 0 }, uBlack: { value: 0 }, uCA: { value: 0 }, uGrain: { value: 1 },
      uDistort: { value: 0 }, uPulse: { value: 0 }, uBlur: { value: 0 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.u, depthTest: false, depthWrite: false, toneMapped: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tScene; uniform vec2 uRes;
        uniform float uTime, uExposure, uFear, uStatic, uFlash, uRed, uBlack, uCA, uGrain, uDistort, uPulse, uBlur;
        float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
        vec3 aces(vec3 x){ const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0., 1.); }
        vec3 samp(vec2 uv, vec2 c, float ca){
          vec3 col;
          col.r = texture2D(tScene, uv + c*ca).r;
          col.g = texture2D(tScene, uv).g;
          col.b = texture2D(tScene, uv - c*ca).b;
          return col;
        }
        void main(){
          vec2 c = vUv - .5;
          float r2 = dot(c, c);
          vec2 uv = .5 + c*(1. - 0.035 + r2*(0.07 + uDistort*0.9));
          uv += vec2(sin(uv.y*40. + uTime*30.), cos(uv.x*37. + uTime*25.)) * uDistort * 0.006;
          // interference tearing when it is near
          float line = floor(uv.y*uRes.y/4.);
          float gate = step(1. - uStatic*0.35, hash(vec2(floor(uTime*18.), line*0.013)));
          uv.x += (hash(vec2(line, floor(uTime*24.))) - .5) * uStatic * 0.06 * gate;
          float ca = (0.0012 + uFear*0.0035 + uCA*0.02 + uStatic*0.008) * (0.25 + r2*4.);
          vec3 col = samp(uv, c, ca);
          if (uBlur > 0.001) {
            vec3 acc = col; float k = uBlur*0.006;
            acc += samp(uv + vec2(k,0.), c, ca) + samp(uv - vec2(k,0.), c, ca) + samp(uv + vec2(0.,k), c, ca) + samp(uv - vec2(0.,k), c, ca);
            col = acc/5.;
          }
          col *= uExposure;
          col = aces(col);
          float l = dot(col, vec3(.2126, .7152, .0722));
          // cold, drained grade; fear drains more
          col = mix(col, vec3(l), 0.22 + uFear*0.4);
          col *= mix(vec3(1.0), vec3(0.92, 0.98, 1.06), 1. - smoothstep(0., .25, l));
          col = pow(max(col, 0.), vec3(1./2.2));
          // film grain, heavier in the dark
          float g = hash(vUv*uRes + fract(uTime*7.13)*371.) - .5;
          col += g * uGrain * (0.035 + 0.07*(1. - smoothstep(0., .5, l)) + uFear*0.03);
          // interference snow
          float sn = hash(floor(vUv*uRes/2.) + floor(uTime*30.)*vec2(3.1, 7.7));
          col = mix(col, vec3(sn*0.8), uStatic*(0.18 + 0.5*gate*uStatic));
          // vignette tightens with fear and throbs with the heartbeat
          float asp = uRes.x/uRes.y;
          float vd = length(c*vec2(asp, 1.)*0.85);
          float vig = 1. - smoothstep(0.2 - uFear*0.1, 0.95 - uFear*0.28 - uPulse*0.06, vd);
          col *= mix(0.12, 1., vig);
          col = mix(col, vec3(0.45, 0.0, 0.0), uRed*0.55);
          col = mix(col, vec3(1.), clamp(uFlash, 0., 1.));
          col *= 1. - uBlack;
          gl_FragColor = vec4(col, 1.);
        }`,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  setSize(w, h) {
    this.rt.setSize(w, h);
    this.u.uRes.value.set(w, h);
  }
  render(scene, camera, t) {
    const r = this.renderer;
    this.u.uTime.value = t;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }
}
