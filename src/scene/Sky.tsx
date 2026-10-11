// 하늘: 시각·날씨에 맞춰 해, 달, 별, 떠다니는 구름, 비를 그린다
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Site } from '../sim/engine'
import type { Weather } from '../store'
import { useUi, world } from '../store'
import { cityPlan } from './cityPlan'
import { daylight, lightTargetZ, sunAngle, sunPose } from './Lighting'

// 카메라가 최대로 기울여도 지평선 위 1도 남짓만 보이므로, 해·달은 방위각은 조명과 같게 두고
// 고도만 지평선 근처로 눌러 화면 위쪽에 걸리게 한다
const SKY_R = 2000
const ELEV_BASE = 0.02
const ELEV_SQUASH = 0.1

// 날씨별 값: 구름 개수, 흐림 정도(해·별 가림), 구름 낮 색, 바람 세기
const WX: Record<Weather, { clouds: number; overcast: number; tint: string; wind: number }> = {
  clear: { clouds: 10, overcast: 0, tint: '#ffffff', wind: 3.5 },
  cloudy: { clouds: 36, overcast: 0.65, tint: '#dde2e9', wind: 5 },
  rain: { clouds: 46, overcast: 1, tint: '#8c949f', wind: 7.5 },
}
const CLOUD_NIGHT = new THREE.Color('#34405a')
const SUN_NOON = new THREE.Color('#fffaf0')
const SUN_DUSK = new THREE.Color('#ffa65c')
const MOON = new THREE.Color('#e4ecfa')
const RAIN_DAY = new THREE.Color('#c9d6e6')
const RAIN_NIGHT = new THREE.Color('#7d8ba3')

// ---------- 해·달 텍스처: 또렷한 원반 + 부드러운 빛무리를 한 장에 ----------
function glowTexture(core: number, glow: number, craters: boolean): THREE.CanvasTexture {
  const n = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = n
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(n, n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5
      const dy = (y + 0.5) / n - 0.5
      const r = Math.hypot(dx, dy)
      // 원반 가장자리는 한 픽셀 정도 부드럽게 잘라 계단을 없앤다
      const disc = Math.max(0, Math.min(1, (core - r) * n))
      const halo = r < 0.5 ? glow * Math.exp(-Math.max(0, r - core) / 0.07) * (1 - r * 2) : 0
      let shade = 1
      if (craters && disc > 0) {
        const s = Math.sin(dx * 90) * Math.sin(dy * 70 + 1.3)
        shade = 0.9 + 0.1 * s
      }
      const i = (y * n + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(255 * shade)
      img.data[i + 3] = Math.round(255 * Math.min(1, disc + halo))
    }
  }
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function skySprite(map: THREE.Texture): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false, toneMapped: false })
}

// ---------- 구름: 납작한 아이코스피어 몇 개를 합친 로우폴리 덩어리 ----------
const CLOUD_TOP = new THREE.Color('#ffffff')
const CLOUD_BOTTOM = new THREE.Color('#c3cfe2')

function cloudGeometry(seed: number): THREE.BufferGeometry {
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
  const parts: THREE.BufferGeometry[] = []
  const puffs = 4 + Math.floor(rnd() * 3)
  const len = 34 + rnd() * 26
  for (let i = 0; i < puffs; i++) {
    const t = puffs === 1 ? 0.5 : i / (puffs - 1)
    // 가운데 덩어리가 크고 양끝이 작아야 뭉게구름 실루엣이 난다
    const r = (8 + rnd() * 5) * (0.65 + 0.55 * Math.sin(t * Math.PI))
    const g = new THREE.IcosahedronGeometry(r, 1) // 다면체 지오메트리는 원래 인덱스가 없다
    const p = g.getAttribute('position') as THREE.BufferAttribute
    for (let k = 0; k < p.count; k++) {
      // 밑면을 평평하게 눌러 장난감 같은 구름 바닥을 만든다
      p.setY(k, Math.max(p.getY(k), -0.3 * r) * 0.62)
    }
    g.translate((t - 0.5) * len, r * 0.18, (rnd() - 0.5) * 12)
    parts.push(g)
  }
  const out = mergeGeometries(parts, false)!
  parts.forEach((g) => g.dispose())
  out.deleteAttribute('uv')
  out.deleteAttribute('normal')
  // 면마다 한 색: 위는 흰색, 아래는 푸른 그늘 (조명과 무관하게 일정한 토이 톤)
  const pos = out.getAttribute('position') as THREE.BufferAttribute
  const col = new Float32Array(pos.count * 3)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const tmp = new THREE.Color()
  for (let f = 0; f < pos.count; f += 3) {
    a.fromBufferAttribute(pos, f)
    b.fromBufferAttribute(pos, f + 1)
    c.fromBufferAttribute(pos, f + 2)
    c.sub(b)
    b.sub(a)
    const nrm = b.cross(c).normalize()
    const k = Math.max(0, Math.min(1, 0.5 + 0.5 * nrm.y + 0.08 * nrm.x))
    tmp.copy(CLOUD_BOTTOM).lerp(CLOUD_TOP, k)
    for (let v = 0; v < 3; v++) tmp.toArray(col, (f + v) * 3)
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3))
  out.computeVertexNormals()
  return out
}

const CLOUD_VARIANTS = 3
const CLOUD_MAX = 48
const PER_VARIANT = CLOUD_MAX / CLOUD_VARIANTS

let cloudGeos: THREE.BufferGeometry[] | null = null
const getCloudGeos = () => (cloudGeos ??= [11, 4271, 90001].map(cloudGeometry))

function cloudMaterial(): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true })
  // 카메라 바로 앞을 지나는 구름은 투명해져서 물류센터를 가리지 않는다
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCamD;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCamD = -mvPosition.z;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCamD;')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a *= smoothstep(25.0, 110.0, vCamD);')
  }
  return m
}

// ---------- 비: 셰이더가 떨어뜨리고 감싸 도는 선분 (버퍼 갱신 없음) ----------
const RAIN_N = 5000
const RAIN_W = 320
const RAIN_H = 220

function rainGeometry(): THREE.BufferGeometry {
  const off = new Float32Array(RAIN_N * 2 * 3)
  const tip = new Float32Array(RAIN_N * 2)
  const spd = new Float32Array(RAIN_N * 2)
  for (let i = 0; i < RAIN_N; i++) {
    const x = Math.random() * RAIN_W
    const y = Math.random() * RAIN_H
    const z = Math.random() * RAIN_W
    const sp = 0.8 + Math.random() * 0.4
    for (let v = 0; v < 2; v++) {
      const j = i * 2 + v
      off[j * 3] = x
      off[j * 3 + 1] = y
      off[j * 3 + 2] = z
      tip[j] = v
      spd[j] = sp
    }
  }
  const g = new THREE.BufferGeometry()
  // position은 컬링 계산용 자리만 채운다 (실제 위치는 셰이더가 정함)
  g.setAttribute('position', new THREE.BufferAttribute(off, 3))
  g.setAttribute('aOff', new THREE.BufferAttribute(off, 3))
  g.setAttribute('aTip', new THREE.BufferAttribute(tip, 1))
  g.setAttribute('aSpd', new THREE.BufferAttribute(spd, 1))
  return g
}

const RAIN_VS = /* glsl */ `
attribute vec3 aOff;
attribute float aTip;
attribute float aSpd;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uVel;
uniform float uLen;
uniform float uAmount;
varying float vA;
void main() {
  vec3 v = uVel * aSpd;
  vec3 p = aOff + v * uTime;
  p.y = mod(p.y, ${RAIN_H.toFixed(1)});
  p.xz = mod(p.xz - uCenter.xz + ${(RAIN_W / 2).toFixed(1)}, ${RAIN_W.toFixed(1)}) - ${(RAIN_W / 2).toFixed(1)};
  // 상자 가장자리는 흐리게 해서 빗줄기 덩어리의 경계가 보이지 않게 한다
  float edge = 1.0 - smoothstep(${(RAIN_W * 0.28).toFixed(1)}, ${(RAIN_W * 0.5).toFixed(1)}, length(p.xz));
  vec3 w = vec3(uCenter.x + p.x, p.y, uCenter.z + p.z) - normalize(v) * uLen * aTip;
  vA = edge * uAmount * mix(0.75, 0.15, aTip);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`
const RAIN_FS = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  gl_FragColor = vec4(uColor, vA);
}
`

// ---------- 별 ----------
function starGeometry(): THREE.BufferGeometry {
  const n = 700
  const arr = new Float32Array(n * 3)
  const lo = Math.sin(-0.03)
  const hi = Math.sin(0.9)
  for (let i = 0; i < n; i++) {
    const sy = lo + Math.random() * (hi - lo)
    const ang = Math.random() * Math.PI * 2
    const rh = Math.sqrt(1 - sy * sy)
    arr[i * 3] = Math.cos(ang) * rh * (SKY_R + 300)
    arr[i * 3 + 1] = sy * (SKY_R + 300)
    arr[i * 3 + 2] = Math.sin(ang) * rh * (SKY_R + 300)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
  return g
}

// 조명 위치에서 방향을 뽑아 고도만 눌러 둔 하늘 위치로 바꾼다
function skyDir(pos: THREE.Vector3, tz: number, out: THREE.Vector3): THREE.Vector3 {
  out.set(pos.x, pos.y, pos.z - tz).normalize()
  const elev = Math.asin(Math.max(-1, Math.min(1, out.y)))
  const h = Math.hypot(out.x, out.z) || 1
  const e = ELEV_BASE + elev * ELEV_SQUASH
  out.set((out.x / h) * Math.cos(e), Math.sin(e), (out.z / h) * Math.cos(e))
  return out
}

interface Cloud {
  x: number
  y: number
  z: number
  s: number
  ry: number
  vis: number
  rank: number
}

export function Sky({ site }: { site: Site }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3 } | null
  const Lg = site.layout
  const b = useMemo(() => cityPlan(site).bounds, [site])

  const sunTex = useMemo(() => glowTexture(0.045, 0.55, false), [])
  const moonTex = useMemo(() => glowTexture(0.035, 0.22, true), [])
  const sunMat = useMemo(() => skySprite(sunTex), [sunTex])
  const moonMat = useMemo(() => skySprite(moonTex), [moonTex])
  const starMat = useMemo(
    () => new THREE.PointsMaterial({ color: '#f2f5ff', size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false, toneMapped: false }),
    [],
  )
  const stars = useMemo(starGeometry, [])
  const cloudMats = useMemo(() => Array.from({ length: CLOUD_VARIANTS }, cloudMaterial), [])
  const rain = useMemo(rainGeometry, [])
  const rainMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: RAIN_VS,
        fragmentShader: RAIN_FS,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uCenter: { value: new THREE.Vector3() },
          uVel: { value: new THREE.Vector3(3, -42, 1.2) },
          uLen: { value: 3.2 },
          uAmount: { value: 0 },
          uColor: { value: RAIN_DAY.clone() },
        },
      }),
    [],
  )

  // 구름 배치는 도시 범위를 덮고, 보이는 순서(rank)를 섞어 개수가 줄어도 고르게 남게 한다
  const clouds = useMemo<Cloud[]>(() => {
    const out: Cloud[] = []
    const ranks = Array.from({ length: CLOUD_MAX }, (_, i) => i).sort(() => Math.random() - 0.5)
    for (let i = 0; i < CLOUD_MAX; i++) {
      out.push({
        x: b.x0 + Math.random() * (b.x1 - b.x0),
        y: 110 + Math.random() * 80,
        z: b.z0 + Math.random() * (b.z1 - b.z0),
        s: 0.8 + Math.random() * 0.8,
        ry: (Math.random() - 0.5) * 0.6,
        vis: 0,
        rank: ranks[i],
      })
    }
    return out
  }, [b])

  const sky = useRef<THREE.Group>(null)
  const sun = useRef<THREE.Sprite>(null)
  const moon = useRef<THREE.Sprite>(null)
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([])
  const rainObj = useRef<THREE.LineSegments>(null)
  const st = useRef({ overcast: 0, rain: 0, wind: 3.5, t: 0, init: false })
  const tmp = useMemo(
    () => ({
      p: new THREE.Vector3(),
      d: new THREE.Vector3(),
      m: new THREE.Matrix4(),
      q: new THREE.Quaternion(),
      e: new THREE.Euler(),
      s: new THREE.Vector3(),
      tint: new THREE.Color(),
    }),
    [],
  )

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1)
    const { lightMode: mode, weather } = useUi.getState()
    const wx = WX[weather]
    const s = st.current
    const k = s.init ? Math.min(1, dt * 0.8) : 1
    s.init = true
    s.overcast += (wx.overcast - s.overcast) * k
    s.rain += ((weather === 'rain' ? 1 : 0) - s.rain) * k
    s.wind += (wx.wind - s.wind) * k
    s.t += dt
    const day = mode === 'day' ? 1 : daylight(world.time)
    const tz = lightTargetZ(Lg)

    // 해·달·별은 카메라를 따라다녀 무한히 먼 것처럼 보인다
    if (sky.current) sky.current.position.copy(camera.position)
    if (sun.current) {
      const kind = sunPose(world.time, mode, Lg, tmp.p)
      const vis = kind === 'moon' ? 0 : day * (1 - 0.85 * s.overcast)
      sun.current.visible = vis > 0.01
      if (sun.current.visible) {
        sun.current.position.copy(skyDir(tmp.p, tz, tmp.d)).multiplyScalar(SKY_R)
        const dusk = kind === 'sun' ? 1 - Math.sin(sunAngle(world.time)) : 0
        sunMat.color.copy(SUN_NOON).lerp(SUN_DUSK, Math.min(1, dusk * 1.3))
        sunMat.opacity = vis
        sun.current.scale.setScalar(SKY_R * (0.42 + 0.18 * dusk))
      }
    }
    const night = 1 - day
    if (moon.current) {
      const vis = mode === 'day' ? 0 : night * (1 - 0.8 * s.overcast)
      moon.current.visible = vis > 0.01
      if (moon.current.visible) {
        // 달은 Lighting의 밤 조명(달빛) 위치와 같은 방향에 둔다
        sunPose(world.time, 'auto', Lg, tmp.p)
        if (day > 0.02) tmp.p.set(-80, 130, 60)
        moon.current.position.copy(skyDir(tmp.p, tz, tmp.d)).multiplyScalar(SKY_R)
        moonMat.color.copy(MOON)
        moonMat.opacity = vis
        moon.current.scale.setScalar(SKY_R * 0.3)
      }
    }
    starMat.opacity = mode === 'day' ? 0 : night * night * (1 - 0.95 * s.overcast)

    // 구름: 바람 따라 흐르고 도시 범위를 벗어나면 반대편에서 다시 들어온다
    const m = 60
    const W = b.x1 - b.x0 + m * 2
    const D = b.z1 - b.z0 + m * 2
    const vx = s.wind * dt
    const vz = s.wind * 0.35 * dt
    tmp.tint.set(wx.tint).lerp(CLOUD_NIGHT, night * 0.85)
    for (let v = 0; v < CLOUD_VARIANTS; v++) {
      const mat = cloudMats[v]
      mat.color.copy(tmp.tint)
    }
    for (let i = 0; i < CLOUD_MAX; i++) {
      const c = clouds[i]
      c.x += vx
      c.z += vz
      if (c.x > b.x1 + m) c.x -= W
      if (c.z > b.z1 + m) c.z -= D
      const want = c.rank < wx.clouds ? 1 : 0
      c.vis += (want - c.vis) * Math.min(1, dt * 0.6)
      const mesh = meshes.current[i % CLOUD_VARIANTS]
      if (!mesh) continue
      // 비 오는 날은 구름이 더 크고 넓게 퍼진다
      const sc = c.s * Math.max(0.001, c.vis) * (1 + 0.35 * s.overcast)
      tmp.s.set(sc * 1.15, sc, sc)
      tmp.q.setFromEuler(tmp.e.set(0, c.ry, 0))
      tmp.m.compose(tmp.p.set(c.x, c.y - 15 * s.overcast, c.z), tmp.q, tmp.s)
      mesh.setMatrixAt(Math.floor(i / CLOUD_VARIANTS), tmp.m)
    }
    for (const mesh of meshes.current) if (mesh) mesh.instanceMatrix.needsUpdate = true

    // 비
    const r = rainObj.current
    if (r) {
      r.visible = s.rain > 0.01
      if (r.visible) {
        const u = rainMat.uniforms
        u.uTime.value = s.t
        u.uAmount.value = s.rain
        ;(u.uVel.value as THREE.Vector3).set(s.wind * 0.6, -42, s.wind * 0.22)
        ;(u.uColor.value as THREE.Color).copy(RAIN_NIGHT).lerp(RAIN_DAY, day)
        const c = controls ? controls.target : camera.position
        ;(u.uCenter.value as THREE.Vector3).set(c.x, 0, c.z)
      }
    }
  })

  return (
    <>
      <group ref={sky}>
        <points geometry={stars} material={starMat} frustumCulled={false} renderOrder={-3} />
        <sprite ref={moon} material={moonMat} frustumCulled={false} renderOrder={-2} />
        <sprite ref={sun} material={sunMat} frustumCulled={false} renderOrder={-2} />
      </group>
      {getCloudGeos().map((g, v) => (
        <instancedMesh
          key={v}
          ref={(el) => {
            meshes.current[v] = el
          }}
          args={[g, cloudMats[v], PER_VARIANT]}
          frustumCulled={false}
          castShadow={false}
          receiveShadow={false}
        />
      ))}
      <lineSegments ref={rainObj} geometry={rain} material={rainMat} frustumCulled={false} visible={false} />
    </>
  )
}
