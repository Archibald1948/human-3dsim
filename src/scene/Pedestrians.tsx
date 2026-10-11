// 도시 보행자: 보도·횡단보도·단지 길·공원을 걸어 다니는 사람들. 몸통·머리·다리·우산 InstancedMesh 4개 (드로우콜 4)
// 작업자(People)와 같은 비율로 만들되 안전모 대신 머리카락, 작업복 색(노랑·주황)은 쓰지 않는다
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Site } from '../sim/engine'
import { Rng } from '../sim/rng'
import { useUi } from '../store'
import { P } from './palette'
import { box, cyl, merged } from './merge'
import { cityPlan } from './cityPlan'
import { buildPedGraph, spawnPeds, stepPeds } from './pedPaths'

const CLOTHES = ['#F4F5F7', '#24272C', '#46536B', '#2F62E8', '#B8BEC6', '#2B9A64', '#C8B79A', '#7C8590', '#1499AE', '#8E5C4A', '#6F4BC9', '#E7D7A8', '#D8DCE1', '#3B4A3F']
const PANTS = ['#2C2F36', '#24272C', '#3A4A66', '#5B6575', '#8A7F6E', '#2F3B52']
const UMBRELLAS = ['#24272C', '#2F62E8', '#1499AE', '#2B9A64', '#F4F5F7', '#46536B', '#6F4BC9', '#24272C']

const bodyGeo = (() => {
  const g = new THREE.CapsuleGeometry(0.22, 0.5, 4, 10)
  g.translate(0, 0.95, 0)
  return g
})()
const headGeo = merged('ped-head', () => {
  const head = new THREE.SphereGeometry(0.15, 12, 10)
  const hair = new THREE.SphereGeometry(0.158, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)
  return [
    { geo: head, pos: [0, 1.57, 0], color: P.skin },
    { geo: hair, pos: [0, 1.585, -0.01], color: '#3A2E27' },
  ]
})
// 다리 하나: 원점이 엉덩이라 x축으로 돌리면 앞뒤로 흔들린다
const legGeo = (() => {
  const g = new THREE.BoxGeometry(0.14, 0.5, 0.16)
  g.translate(0, -0.25, 0)
  return g
})()
const umbrellaGeo = merged('ped-umbrella', () => [
  { geo: new THREE.ConeGeometry(0.62, 0.26, 8), pos: [0.06, 2.06, 0.04], color: '#ffffff' },
  { geo: cyl(0.018, 0.8, 5), pos: [0.2, 1.6, 0.04], color: '#55595F' },
  { geo: box(0.05, 0.05, 0.05), pos: [0.06, 2.21, 0.04], color: '#55595F' },
])

const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.8 })
const headMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })
const legMat = new THREE.MeshStandardMaterial({ roughness: 0.9 })
const umbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 })

const tmp = new THREE.Object3D()
const leg = new THREE.Object3D()
leg.rotation.order = 'YXZ' // 몸 방향(y)으로 돌린 뒤 다리를 앞뒤(x)로
const col = new THREE.Color()

export function Pedestrians({ site }: { site: Site }) {
  const plan = cityPlan(site)
  const C = site.layout.campus
  const g = useMemo(() => buildPedGraph(plan, C), [plan, C])
  const max = g.base * 2 // 보행자 배율 최대 2
  const peds = useMemo(() => spawnPeds(g, max, site.cfg.seed * 53 + 11), [g, max, site])
  const body = useRef<THREE.InstancedMesh>(null)
  const head = useRef<THREE.InstancedMesh>(null)
  const legs = useRef<THREE.InstancedMesh>(null)
  const umb = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const r = new Rng(site.cfg.seed * 59 + 3)
    const b = body.current!
    const l = legs.current!
    const u = umb.current!
    for (let i = 0; i < max; i++) {
      b.setColorAt(i, col.set(r.pick(CLOTHES)))
      col.set(r.pick(PANTS))
      l.setColorAt(i * 2, col)
      l.setColorAt(i * 2 + 1, col)
      // 우산 색은 칸마다 고정 (우산 든 사람 순서대로 칸을 채운다)
      u.setColorAt(i, col.set(r.pick(UMBRELLAS)))
    }
    // 도시 전체를 덮는 경계 구 (움직이는 인스턴스라 매번 다시 계산하지 않음)
    const B = plan.bounds
    const sphere = new THREE.Sphere(new THREE.Vector3((B.x0 + B.x1) / 2, 0, (B.z0 + B.z1) / 2), Math.hypot(B.x1 - B.x0, B.z1 - B.z0) / 2 + 20)
    for (const m of [b, head.current!, l, u]) {
      if (m.instanceColor) m.instanceColor.needsUpdate = true
      m.boundingSphere = sphere
      m.count = 0
    }
  }, [plan, max, site])

  useFrame((_, dt) => {
    const b = body.current
    const h = head.current
    const l = legs.current
    const u = umb.current
    if (!b || !h || !l || !u) return
    // 시뮬레이션 배속·일시정지와 무관하게 실제 시간으로 걷는다
    const step = Math.min(dt, 0.1)
    const { crowd, weather } = useUi.getState()
    const rain = weather === 'rain'
    // 비 오면 밖에 나온 사람이 조금 줄고, 60%가 우산을 쓴다
    const n = Math.min(max, Math.round(g.base * crowd * (rain ? 0.85 : 1)))
    stepPeds(g, peds, n, step)
    let k = 0
    for (let i = 0; i < n; i++) {
      const sc = peds.sc[i]
      const ph = peds.ph[i]
      const hd = peds.hd[i]
      const x = peds.px[i]
      const z = peds.pz[i]
      tmp.position.set(x, Math.abs(Math.sin(ph)) * 0.05, z)
      tmp.rotation.set(0, hd, 0)
      tmp.scale.setScalar(sc)
      tmp.updateMatrix()
      b.setMatrixAt(i, tmp.matrix)
      h.setMatrixAt(i, tmp.matrix)
      if (rain && peds.umb[i] < 0.6) u.setMatrixAt(k++, tmp.matrix)
      // 다리 둘: 엉덩이 위치에서 서로 반대로 흔든다
      const swing = Math.sin(ph) * 0.5
      const cx = Math.cos(hd) * 0.1 * sc
      const sz = Math.sin(hd) * 0.1 * sc
      leg.scale.setScalar(sc)
      for (let s = -1; s <= 1; s += 2) {
        leg.position.set(x + s * cx, 0.5 * sc, z - s * sz)
        leg.rotation.set(s * swing, hd, 0)
        leg.updateMatrix()
        l.setMatrixAt(i * 2 + (s + 1) / 2, leg.matrix)
      }
    }
    b.count = n
    h.count = n
    l.count = n * 2
    u.count = k
    b.instanceMatrix.needsUpdate = true
    h.instanceMatrix.needsUpdate = true
    l.instanceMatrix.needsUpdate = true
    u.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh ref={body} args={[bodyGeo, bodyMat, max]} castShadow />
      <instancedMesh ref={head} args={[headGeo, headMat, max]} />
      <instancedMesh ref={legs} args={[legGeo, legMat, max * 2]} />
      <instancedMesh ref={umb} args={[umbrellaGeo, umbMat, max]} castShadow />
    </group>
  )
}
