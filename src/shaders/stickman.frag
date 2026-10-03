// テクスチャなし・単色・フラット寄り（PROGRESS §6: GPU負荷ほぼゼロ）
uniform vec3 uLightDir;

varying vec3 vColor;
varying vec3 vNormal;

void main() {
  float d = max(dot(normalize(vNormal), normalize(uLightDir)), 0.0);
  gl_FragColor = vec4(vColor * (0.58 + 0.42 * d), 1.0);
  #include <colorspace_fragment>
}
