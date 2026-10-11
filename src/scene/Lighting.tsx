// 시뮬레이션 시각에 연동되는 낮·밤 조명 + 가로등/벽등
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import * as L from '../sim/layout'
import type { Site } from '../sim/engine'
import { useUi, world } from '../store'
import type { LightMode, Weather } from '../store'
import { P } from './palette'
import { nightMats } from './nightMats'
import { box, cyl, merged, vcMat } from './merge'

const sstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function daylight(t: number): number {
  const h = (((t % 86400) + 86400) % 86400) / 3600
  return sstep(5.4, 7.0, h) * (1 - sstep(18.2, 19.8, h))
}

// 해·달 조명의 겨냥점과 위치. Sky가 같은 방향에 해·달 원반을 그리도록 공유한다
export const lightTargetZ = (Lg: Site['layout']) => (Lg.wall.z0 + 30) / 2

export function sunAngle(t: number): number {
  const h = (((t % 86400) + 86400) % 86400) / 3600
  return Math.max(0.2, Math.min(Math.PI - 0.2, ((h - 6) / 12) * Math.PI))
}

export type SunKind = 'sun' | 'noon' | 'moon'

export function sunPose(t: number, mode: LightMode, Lg: Site['layout'], out: THREE.Vector3): SunKind {
  if (mode === 'auto' && daylight(t) > 0.02) {
    const th = sunAngle(t)
    out.set(Math.cos(th) * 150, 50 + Math.sin(th) * 120, 90 + lightTargetZ(Lg))
    return 'sun'
  }
  if (mode === 'day') {
    out.set(70, 150, 90)
    return 'noon'
  }
  out.set(-80, 130, 60)
  return 'moon'
}

// 날씨에 따른 조명 세기 배율 (흐리면 조금, 비 오면 더 어둡게)
export const weatherDim = (w: Weather) => (w === 'rain' ? 0.7 : w === 'cloudy' ? 0.85 : 1)

const C = {
  bgDay: new THREE.Color(P.bg),
  bgNight: new THREE.Color('#121a27'),
  skyDay: new THREE.Color('#f4f8ff'),
  skyNight: new THREE.Color('#7f95bd'),
  gndDay: new THREE.Color('#a9bf93'),
  gndNight: new THREE.Color('#1f2630'),
  sunDay: new THREE.Color('#ffffff'),
  sunDusk: new THREE.Color('#ffd2a6'),
  moon: new THREE.Color('#b4c6e6'),
  lampOff: new THREE.Color('#d8d8d4'),
  lampOn: new THREE.Color('#fff1d0'),
}

export function Lighting({ site }: { site: Site }) {
  const hemi = useRef<THREE.HemisphereLight>(null)
  const sun = useRef<THREE.DirectionalLight>(null)
  const scene = useThree((s) => s.scene)
  const tmp = useMemo(() => new THREE.Color(), [])
  const dayRef = useRef(-1)
  const dim = useRef(1)
  const Lg = site.layout
  const half = Math.max(Lg.width / 2 + 45, 70)

  useEffect(() => {
    const s = sun.current
    if (!s) return
    const cam = s.shadow.camera
    cam.left = -half
    cam.right = half
    cam.top = half * 0.8
    cam.bottom = -half * 0.8
    cam.far = 420
    cam.updateProjectionMatrix()
    s.target.position.set(0, 0, lightTargetZ(Lg))
    s.target.updateMatrixWorld()
  }, [half, Lg])

  useFrame((_, dt) => {
    const { lightMode: mode, weather } = useUi.getState()
    const day = mode === 'day' ? 1 : daylight(world.time)
    // 날씨가 바뀌면 조명이 툭 끊기지 않게 서서히 따라간다
    dim.current += (weatherDim(weather) - dim.current) * Math.min(1, Math.min(dt, 0.1) * 1.5)
    if (scene.background instanceof THREE.Color) scene.background.copy(C.bgNight).lerp(C.bgDay, day)
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(C.bgNight).lerp(C.bgDay, day)
    if (hemi.current) {
      hemi.current.intensity = (0.55 + 1.15 * day) * dim.current
      hemi.current.color.copy(C.skyNight).lerp(C.skyDay, day)
      hemi.current.groundColor.copy(C.gndNight).lerp(C.gndDay, day)
    }
    if (sun.current) {
      const s = sun.current
      const kind = sunPose(world.time, mode, Lg, s.position)
      if (kind === 'sun') {
        const dusk = 1 - Math.sin(sunAngle(world.time))
        tmp.copy(C.sunDay).lerp(C.sunDusk, dusk * 0.8)
        s.color.copy(C.moon).lerp(tmp, day)
      } else if (kind === 'noon') {
        s.color.copy(C.sunDay)
      } else {
        s.color.copy(C.moon)
      }
      s.intensity = (0.38 + 1.72 * day) * dim.current
    }
    const night = 1 - day
    if (Math.abs(night - dayRef.current) > 0.002) {
      dayRef.current = night
      nightMats.window.emissiveIntensity = night * 1.1
      nightMats.lampHead.color.copy(C.lampOff).lerp(C.lampOn, night)
      nightMats.pool.opacity = night * 0.55
      nightMats.interior.opacity = night * 0.16
      nightMats.skylight.emissiveIntensity = night * 0.7
      nightMats.sign.emissiveIntensity = night * 0.85
      nightMats.cityPunch.emissiveIntensity = night * 0.9
      nightMats.cityRibbon.emissiveIntensity = night * 0.75
    }
  })

  return (
    <>
      <hemisphereLight ref={hemi} args={['#f4f8ff', '#a9bf93', 1.7]} />
      <directionalLight
        ref={sun}
        castShadow
        position={[42, 86, 52]}
        intensity={2.1}
        shadow-mapSize-width={4096}
        shadow-mapSize-height={4096}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-near={10}
        shadow-camera-far={420}
        shadow-bias={-0.0004}
        shadow-normalBias={0.05}
      />
    </>
  )
}

export function YardLights({ site }: { site: Site }) {
  const Lg = site.layout
  const key = site.cfg.id
  const poles = useMemo(() => {
    const xs: number[] = []
    for (let x = Lg.exitX + 20; x <= Lg.spawnX - 20; x += 24) xs.push(x)
    return xs
  }, [Lg])
  const interior = useMemo(() => {
    const pts: [number, number][] = []
    const nx = Math.max(2, Math.round(Lg.width / 14))
    const nz = Math.max(2, Math.round(Lg.depth / 13))
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) pts.push([Lg.wall.x0 + ((i + 0.5) * Lg.width) / nx, Lg.wall.z0 + ((j + 0.5) * Lg.depth) / nz])
    return pts
  }, [Lg])
  const poleGeo = merged(`poles-${key}`, () =>
    poles.flatMap((x) => [
      { geo: cyl(0.14, 9, 8), pos: [x, 4.5, 44.2] as [number, number, number], color: P.frame },
      { geo: box(0.18, 0.14, 2.8), pos: [x, 9.0, 42.9] as [number, number, number], color: P.frame },
    ]),
  )
  // 도크 벽등은 건물 외피(Building)에 붙어 있다
  const headGeo = merged(`lampheads-${key}`, () => poles.map((x) => ({ geo: box(0.6, 0.12, 0.9), pos: [x, 8.88, 41.7] as [number, number, number], color: '#fff' })))
  const pool = (w: number, d: number) => {
    const g = new THREE.PlaneGeometry(w, d)
    g.rotateX(-Math.PI / 2)
    return g
  }
  const poolGeo = merged(`pools-${key}`, () => [
    ...poles.map((x) => ({ geo: pool(20, 17), pos: [x, 0.03, 39.2] as [number, number, number], color: '#fff' })),
    ...site.docks.map((d) => ({ geo: pool(11, 13), pos: [d.x, 0.035, L.DOCK_WALL_Z + 6] as [number, number, number], color: '#fff' })),
  ])
  const interiorGeo = merged(`interior-${key}`, () => interior.map(([x, z]) => ({ geo: pool(17, 15), pos: [x, 0.025, z] as [number, number, number], color: '#fff' })))
  return (
    <group>
      <mesh geometry={poleGeo} material={vcMat} castShadow />
      <mesh geometry={headGeo} material={nightMats.lampHead} />
      <mesh geometry={poolGeo} material={nightMats.pool} renderOrder={1} />
      <mesh geometry={interiorGeo} material={nightMats.interior} renderOrder={1} />
    </group>
  )
}
