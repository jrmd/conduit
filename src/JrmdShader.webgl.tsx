/* @jrmd · OpenShaders · https://openshaders.com/@jrmd
 * User-supplied halftone shader. Field and halftone parameters preserved.
 * Lifecycle adapted for Conduit's new-thread backdrop, including context-loss fallback.
 */
import { useEffect, useRef, useState } from 'react';
const VERTEX_SHADER = `#version 300 es
void main() {
 vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
 gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}`;
const FIELD_SHADER = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform vec3 uDarkBackground;
uniform vec3 uLightBackground;
uniform float uLightMode;
out vec4 fragColor;
const float HUE = 0.905928731;
const float HUE_SPREAD = -0.330840468;
const float HUE_TRAVEL = 1.400949;
const float CHROMA = 0.0844921991;
const float LIGHTNESS = 0.566073835;
const float COLOUR_CYCLE = 0.108391777;
const float THETA = 2.14708757;
const float SHEAR = 0.966016948;
const float SHRINK = 0.953788698;
const float LAYERS = 93.0;
const float WARP_FREQ_X = 0.451549113;
const float WARP_FREQ_Y = 2.77531958;
const float WARP_AMP_X = 0.112794265;
const float WARP_AMP_Y = 0.0312084351;
const float ASPECT_X = 2.0928638;
const float ASPECT_Y = 0.188876957;
const float OFFSET_X = 0.399539709;
const float OFFSET_Y = -0.00909353141;
const float TILT = -1.16349947;
const float ZOOM = 1.18533862;
const float CENTRE_X = -0.0302693062;
const float CENTRE_Y = -0.676248193;
const float GLOW_SIZE = 0.00304264831;
const float FALLOFF = 0.341206491;
const float VIGNETTE = 0.0206823479;
const float FLOW_SPEED = 0.60003221;
const float FLOW_DIRECTION = 1.0;
const float BREATH_RATE = 0.356001377;
const float BREATH_AMOUNT = 0.101082064;
const float PHASE = 44.9445114;
const float ECHO = 0.413858533;
const float ECHO_SHIFT = 0.166739494;
const float SOFTNESS = 0.00268205511;
const float LIGHT_SWING = 0.150057271;
const float TAU = 6.28318530718;
vec3 oklchToLinear(float L, float C, float h) {
 float a = C * cos(h), b = C * sin(h);
 float l_ = L + 0.3963377774 * a + 0.2158037573 * b;
 float m_ = L - 0.1055613458 * a - 0.0638541728 * b;
 float s_ = L - 0.0894841775 * a - 1.2914855480 * b;
 vec3 lms = vec3(l_, m_, s_); lms = lms * lms * lms;
 return mat3(4.0767416621, -1.2684380046, -0.0041960863,
 -3.3077115913, 2.6097574011, -0.7034186147,
 0.2309699292, -0.3413193965, 1.7076147010) * lms;
}
float blueNoise(vec2 p, float frame) {
 p += 5.588238 * mod(frame, 64.0);
 return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
}
void main() {
 vec2 R = iResolution.xy;
 vec2 pos = (gl_FragCoord.xy - 0.5 * R) / R.y;
 float t = iTime * FLOW_SPEED * FLOW_DIRECTION + PHASE;
 float breath = (-sin(iTime * BREATH_RATE * 1.5) + sin(iTime * BREATH_RATE + 1.0)) * 0.25 + 0.5;
 vec2 u = (pos - vec2(CENTRE_X, CENTRE_Y)) * (ZOOM - breath * BREATH_AMOUNT);
 float ct = cos(TILT), st = sin(TILT);
 u = mat2(ct, st, -st, ct) * u;
 mat2 fold = mat2(cos(THETA), sin(THETA), -SHEAR, cos(THETA));
 float hue0 = HUE * TAU;
 float hue1 = hue0 + HUE_SPREAD * TAU;
 vec3 color = vec3(0.0);
 for (float i = 1.0; i <= 96.0; i += 1.0) {
  if (i > LAYERS) break;
  u.x += -sin(u.y * WARP_FREQ_X + t + i * 0.007) * WARP_AMP_X;
  u.y += -sin(u.x * WARP_FREQ_Y - t + i * 0.02) * WARP_AMP_Y;
  u = fold * u * SHRINK;
  vec2 q = u - vec2(OFFSET_X + breath * 0.1, OFFSET_Y);
  vec2 s = vec2(q.x * ASPECT_X, q.y * ASPECT_Y);
  float glow = GLOW_SIZE / (dot(s, s) + SOFTNESS);
  vec2 e = vec2((q.x - ECHO_SHIFT) * ASPECT_X, s.y);
  glow += ECHO * GLOW_SIZE / (dot(e, e) + SOFTNESS);
  glow *= 0.25 + breath * 0.4;
  float r = length(u);
  float k = sin(i * COLOUR_CYCLE + t * 1.2 + r * HUE_TRAVEL) * 0.5 + 0.5;
  vec3 tint = clamp(oklchToLinear(LIGHTNESS + LIGHT_SWING * k, CHROMA * (0.75 + 0.35 * k), mix(hue0, hue1, k)), 0.0, 1.0);
  color += glow * tint * exp2(-r * FALLOFF);
 }
 vec3 x = max(color, 0.0);
 color = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
 color = pow(clamp(color, 0.0, 1.0), vec3(0.85, 0.92, 0.98));
 float edge = smoothstep(0.5, 1.6, length(pos));
 color *= 1.0 - edge * VIGNETTE;
 vec3 dark = uDarkBackground + color * (1.0 - uDarkBackground);
 float strength = max(color.r, max(color.g, color.b));
 vec3 light = uLightBackground * (1.0 - strength) + color * 0.96;
 color = mix(dark, light, uLightMode);
 color += (blueNoise(gl_FragCoord.xy, floor(iTime * 24.0)) - 0.5) / 255.0;
 fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;
const RARITY_SHADER = `#version 300 es
precision highp float;
uniform sampler2D tScene;
uniform vec2 iResolution;
uniform float iTime;
uniform vec3 uDarkBackground;
uniform vec3 uLightBackground;
uniform float uLightMode;
uniform float uPixelRatio;
out vec4 fragColor;
const float uStrength = 0.94645685;
const float uScale = 1.0494405;
const float uSeed = 0.724083722;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 sceneInk(vec2 uv) { vec3 c = texture(tScene, clamp(uv, 0.0, 1.0)).rgb; return mix(c - uDarkBackground, uLightBackground - c, uLightMode); }
float blueNoise(vec2 p, float frame) {
 p += 5.588238 * mod(frame, 64.0);
 return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
}
vec3 halftone(vec2 frag) {
 float cell = max(3.0, uScale * 3.6 * uPixelRatio);
 float angle = 0.26 + uSeed * 0.3;
 mat2 turn = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
 vec2 rotated = turn * frag;
 vec2 grid = floor(rotated / cell);
 vec2 centre = (grid + 0.5) * cell;
 vec2 source = transpose(turn) * centre;
 vec3 soft = sceneInk(frag / iResolution);
 vec3 ink = sceneInk(source / iResolution);
 float level = clamp(dot(ink, LUMA), 0.0, 1.0);
 float radius = cell * sqrt(pow(level, 0.9) / 3.14159265);
 float dist = length(rotated - centre);
 float aa = 0.7 * uPixelRatio;
 float dot_ = 1.0 - smoothstep(radius - aa, radius + aa, dist);
 vec3 dots = ink * min(0.8 / max(level, 1e-3), 2.2) * dot_;
 float presence = smoothstep(0.03, 0.16, level) * (0.3 + 0.14 * uStrength);
 return mix(soft, dots, presence);
}
void main() {
 vec2 frag = gl_FragCoord.xy;
 vec3 ink = halftone(frag);
 vec3 color = mix(uDarkBackground + clamp(ink, 0.0, 1.0), uLightBackground - clamp(ink, 0.0, 1.0), uLightMode);
 color += (blueNoise(frag, floor(iTime * 24.0)) - 0.5) / 255.0;
 fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}`;

export function JrmdShader({ theme = 'dark' }: { theme?: 'dark' | 'light' }) {
 const canvas = useRef<HTMLCanvasElement>(null);
 const [failed,setFailed] = useState(false);
 useEffect(()=>{
  const element=canvas.current;
  if(!element)return;
  setFailed(false);
  const gl=element.getContext('webgl2',{alpha:false,antialias:false,depth:false,stencil:false});
  if(!gl){setFailed(true);return;}
  let disposed=false,frame=0,visible=true,elapsed=0,previous=0,lastDraw=0;
  const programs:WebGLProgram[]=[], shaders:WebGLShader[]=[];
  let framebuffer:WebGLFramebuffer|null=null, scene:WebGLTexture|null=null;
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const release=()=>{programs.forEach(p=>gl.deleteProgram(p));shaders.forEach(s=>gl.deleteShader(s));gl.deleteFramebuffer(framebuffer);gl.deleteTexture(scene)};
  function compile(source:string) {
   const program=gl!.createProgram();if(!program)throw new Error('WebGL program unavailable');programs.push(program);
   for(const [type,text] of [[gl!.VERTEX_SHADER,VERTEX_SHADER],[gl!.FRAGMENT_SHADER,source]] as const){
    const shader=gl!.createShader(type);if(!shader)throw new Error('WebGL shader unavailable');shaders.push(shader);
    gl!.shaderSource(shader,text);gl!.compileShader(shader);
    if(!gl!.getShaderParameter(shader,gl!.COMPILE_STATUS))throw new Error('Shader compilation failed');
    gl!.attachShader(program,shader);
   }
   gl!.linkProgram(program);if(!gl!.getProgramParameter(program,gl!.LINK_STATUS))throw new Error('Shader link failed');
   return {program,uniforms:Object.fromEntries(['iResolution','iTime','uDarkBackground','uLightBackground','uLightMode','uPixelRatio','tScene'].map(name=>[name,gl!.getUniformLocation(program,name)]))};
  }
  let draw:(time:number)=>void;
  try{
   const field=compile(FIELD_SHADER),post=compile(RARITY_SHADER);
   framebuffer=gl.createFramebuffer();scene=gl.createTexture();if(!framebuffer||!scene)throw new Error('WebGL allocation failed');
   gl.bindTexture(gl.TEXTURE_2D,scene);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
   let textureWidth=0,textureHeight=0;
   const limit=Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
   draw=(time)=>{
    const width=element.clientWidth,height=element.clientHeight;if(!width||!height)return;
    const ratio=Math.min(devicePixelRatio||1,2,Math.sqrt(2400000/(width*height)),limit/width,limit/height);
    const w=Math.max(1,Math.floor(width*ratio)),h=Math.max(1,Math.floor(height*ratio));
    if(element.width!==w||element.height!==h){element.width=w;element.height=h;}
    gl.viewport(0,0,w,h);
    if(textureWidth!==w||textureHeight!==h){
     gl.bindTexture(gl.TEXTURE_2D,scene);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
     gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,scene,0);
     if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Incomplete framebuffer');
     textureWidth=w;textureHeight=h;
    }
    for(const pass of [field,post]){
     gl.bindFramebuffer(gl.FRAMEBUFFER,pass===field?framebuffer:null);gl.useProgram(pass.program);
     gl.uniform2f(pass.uniforms.iResolution,w,h);gl.uniform1f(pass.uniforms.iTime,time);gl.uniform3f(pass.uniforms.uDarkBackground,7/255,12/255,21/255);gl.uniform3f(pass.uniforms.uLightBackground,248/255,249/255,251/255);gl.uniform1f(pass.uniforms.uLightMode,theme === 'light' ? 1 : 0);
     if(pass===post){gl.uniform1f(pass.uniforms.uPixelRatio,w/width);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,scene);gl.uniform1i(pass.uniforms.tScene,0);}
     gl.drawArrays(gl.TRIANGLES,0,3);
    }
   };
  }catch{release();setFailed(true);return;}
  function tick(now:number){
   frame=0;if(disposed||document.hidden||!visible)return;
   // Keep this decorative 93-layer shader to 30 fps; input rendering remains independent.
   if(!motion.matches&&lastDraw&&now-lastDraw<1000/30){frame=requestAnimationFrame(tick);return;}
   if(previous&&!motion.matches)elapsed+=Math.min((now-previous)/1000,.1);
   previous=now;lastDraw=now;
   try{draw(elapsed);}catch{disposed=true;release();setFailed(true);return;}
   if(!motion.matches)frame=requestAnimationFrame(tick);
  }
  function refresh(){cancelAnimationFrame(frame);frame=0;previous=0;lastDraw=0;if(!disposed&&!document.hidden&&visible)frame=requestAnimationFrame(tick);}
  const resize=new ResizeObserver(refresh),intersection=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;refresh()});
  const lost=(event:Event)=>{event.preventDefault();disposed=true;cancelAnimationFrame(frame);setFailed(true)};
  resize.observe(element);intersection.observe(element);motion.addEventListener('change',refresh);document.addEventListener('visibilitychange',refresh);window.addEventListener('resize',refresh);element.addEventListener('webglcontextlost',lost);refresh();
  return()=>{disposed=true;cancelAnimationFrame(frame);resize.disconnect();intersection.disconnect();motion.removeEventListener('change',refresh);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('resize',refresh);element.removeEventListener('webglcontextlost',lost);release();};
 },[theme]);
 return <canvas ref={canvas} className={`new-thread-shader${failed?' shader-fallback':''}`} aria-hidden="true"/>;
}
