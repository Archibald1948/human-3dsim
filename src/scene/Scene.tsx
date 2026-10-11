import { useEffect, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useUi, world } from '../store'
import { Ground } from './Ground'
import { Building } from './Building'
import { City } from './City'
import { Racks } from './Racks'
import { Docks } from './Docks'
import { Trucks } from './Trucks'
import { Forklifts } from './Forklifts'
import { Surroundings } from './Surroundings'
import { Lighting, YardLights } from './Lighting'
import { HeatLayer } from './Heat'
import { SelectionLayer, selAnchor } from './Selection'
import { P } from './palette'

import type { Site } from '../sim/engine'
import { People } from './People'

const BASE_OFFSET = new THREE.Vector3(47, 56, 74)

export function siteView(site: Site, aspect: number) {
  const Lg = site.layout
  const s = Math.max(1, Lg.width / 58)
  const far = aspect < 0.8 ? 1.7 : aspect < 1.3 ? 1.25 : 1
  const target = new THREE.Vector3(Lg.width * 0.05, 0, (Lg.wall.z0 + 26) / 2)
  const pos = BASE_OFFSET.clone().multiplyScalar(s * far).add(target)
  return { target, pos, scale: s }
}

// 미니맵이 읽는 카메라 상태 (매 프레임 갱신)
export const camState = { tx: 0, tz: 0, px: 0, pz: 0, dist: 100 }

function SimDriver() {
  useFrame((_, dt) => world.advance(dt), -1)
  return null
}

function CameraRig() {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const camera = useThree((s) => s.camera)
  const siteId = useUi((s) => s.siteId)
  const nonce = useUi((s) => s.focusNonce)
  const fly = useUi((s) => s.fly)
  const anim = useRef<{ from: THREE.Vector3; to: THREE.Vector3 | null; t: number } | null>(null)
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height))

  useEffect(() => {
    if (!controls) return
    const v = siteView(world.site(siteId), aspect)
    camera.position.copy(v.pos)
    controls.target.copy(v.target)
    controls.update()
    anim.current = null
    // 화면 비율이 바뀔 때마다 리셋하지 않도록 aspect는 의존성에서 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, controls, camera])

  useEffect(() => {
    if (!controls || !nonce) return
    anim.current = { from: controls.target.clone(), to: null, t: 0 }
  }, [nonce, controls])

  useEffect(() => {
    if (!controls || !fly) return
    anim.current = { from: controls.target.clone(), to: new THREE.Vector3(fly.x, 0, fly.z), t: 0 }
  }, [fly, controls])

  useFrame((_, dt) => {
    if (!controls) return
    const { sel, follow } = useUi.getState()
    const site = world.site(useUi.getState().siteId)
    const a = sel ? selAnchor(site, sel, world.time) : null
    let desired: THREE.Vector3 | null = null
    const k = anim.current
    const goal = k ? (k.to ?? (a ? new THREE.Vector3(a.x, 0, a.z) : null)) : null
    if (k && goal) {
      k.t = Math.min(1, k.t + dt / 0.9)
      const e = k.t < 0.5 ? 4 * k.t ** 3 : 1 - (-2 * k.t + 2) ** 3 / 2
      desired = k.from.clone().lerp(goal, e)
      if (k.t >= 1) anim.current = null
    } else if (follow && a && sel && (sel.kind === 'truck' || sel.kind === 'forklift' || sel.kind === 'shipment' || sel.kind === 'worker')) {
      desired = new THREE.Vector3(a.x, 0, a.z)
    } else {
      anim.current = null
    }
    if (desired) {
      const delta = desired.sub(controls.target)
      controls.target.add(delta)
      camera.position.add(delta)
      controls.update()
    }
    camState.tx = controls.target.x
    camState.tz = controls.target.z
    camState.px = camera.position.x
    camState.pz = camera.position.z
    camState.dist = camera.position.distanceTo(controls.target)
  })
  return null
}

export function Scene() {
  const siteId = useUi((s) => s.siteId)
  const select = useUi((s) => s.select)
  const setHover = useUi((s) => s.setHover)
  const site = world.site(siteId)
  const hover = useUi((s) => s.hover)
  const viewMode = useUi((s) => s.viewMode)
  const view = siteView(site, 1.6)

  useEffect(() => {
    document.body.style.cursor = hover ? 'pointer' : ''
  }, [hover])

  return (
    <Canvas
      shadows
      flat
      dpr={[1, 1.75]}
      // 패널을 접고 펼 때 무대 폭이 매 프레임 바뀌므로 크기를 지연 없이 따라간다
      resize={{ debounce: 0 }}
      camera={{ position: view.pos.toArray(), fov: 30, near: 1, far: 2600 }}
      onPointerMissed={(e) => {
        // 3D 위에 떠 있는 HTML 라벨(도크·시설 태그)을 누른 클릭은 빈 곳 클릭으로 보지 않는다
        if (e.type === 'click' && e.target instanceof HTMLCanvasElement) select(null, false)
      }}
      onPointerLeave={() => setHover(null)}
    >
      <color attach="background" args={[P.bg]} />
      <fog attach="fog" args={[P.bg, 260 * view.scale, 820 * view.scale]} />
      <SimDriver />
      <Lighting site={site} />
      <group key={siteId}>
        <Ground site={site} />
        <Building site={site} />
        <Surroundings site={site} />
        <City site={site} />
        <YardLights site={site} />
        {viewMode === 'traffic' && <HeatLayer site={site} />}
        <Racks site={site} />
        <Docks site={site} />
        <Trucks site={site} />
        <Forklifts site={site} />
        <People site={site} />
        <SelectionLayer site={site} />
      </group>
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={22} maxDistance={360 * view.scale} maxPolarAngle={1.32} target={view.target.toArray()} />
      <CameraRig />
    </Canvas>
  )
}
