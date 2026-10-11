// 캠퍼스 주변: 나무(호버하면 흔들림, 도시 가로수 포함), 울타리, 사무동·정비동·경비실, 주차장, 게이트 차단기
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import * as L from '../sim/layout'
import type { Site } from '../sim/engine'
import { Rng } from '../sim/rng'
import { useUi, world } from '../store'
import { CAR_COLORS, CONE_COLORS, P, TREE_COLORS } from './palette'
import { nightMats } from './nightMats'
import { box, cyl, merged, vcMatMatte, type Part } from './merge'
import { cityPlan, inRiver } from './cityPlan'

const tmp = new THREE.Object3D()
const OFFICE_WHITE = '#F3F4F6'

interface Tree {
  x: number
  z: number
  s: number
  kind: 0 | 1
}

function inRect(x: number, z: number, r: { x0: number; x1: number; z0: number; z1: number }, pad = 0) {
  return x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad
}

function useTrees(site: Site): Tree[] {
  return useMemo(() => {
    const Lg = site.layout
    const C = Lg.campus
    const r = new Rng(site.cfg.seed * 7 + 3)
    const out: Tree[] = []
    const add = (x: number, z: number, s = r.range(0.8, 1.35)) => out.push({ x: x + r.range(-0.8, 0.8), z: z + r.range(-0.8, 0.8), s, kind: r.chance(0.3) ? 1 : 0 })
    // 울타리 안쪽 가로수
    for (let x = C.x0 + 4; x < C.x1 - 4; x += 7) add(x, C.z0 + 3.5)
    for (let z = C.z0 + 9; z < 27; z += 7) {
      add(C.x0 + 3.5, z)
      if (!inRect(C.x1 - 3.5, z, { x0: Lg.facilities.shop.x - 12, x1: Lg.facilities.shop.x + 12, z0: Lg.facilities.shop.z - 9, z1: Lg.facilities.shop.z + 9 })) add(C.x1 - 3.5, z)
    }
    for (let x = C.x0 + 4; x < C.x1 - 4; x += 8) add(x, 45.5)
    // 사무동 앞 정원
    const o = Lg.facilities.office
    for (let i = 0; i < 5; i++) add(o.x - o.w / 2 + 2 + i * 3.6, o.z - o.d / 2 - 3.5, r.range(0.7, 1))
    // 도시 가로수·공원·단지 조경
    for (const t of cityPlan(site).trees) out.push({ x: t.x, z: t.z, s: t.s, kind: t.cone ? 1 : 0 })
    // 도시 바깥 숲: 군집
    const B = cityPlan(site).bounds
    for (let c = 0; c < 40; c++) {
      const side = r.int(0, 3)
      const cx = side === 0 ? r.range(B.x0 - 120, B.x0 - 10) : side === 1 ? r.range(B.x1 + 10, B.x1 + 120) : r.range(B.x0 - 120, B.x1 + 120)
      const cz = side === 2 ? r.range(B.z0 - 110, B.z0 - 10) : side === 3 ? r.range(B.z1 + 10, B.z1 + 110) : r.range(B.z0, B.z1)
      const n = r.int(6, 14)
      for (let i = 0; i < n; i++) {
        const x = cx + r.range(-16, 16)
        const z = cz + r.range(-16, 16)
        if (inRect(x, z, B) || (z > 27 && z < 48) || inRiver(cityPlan(site).river, x, z, 3)) continue
        add(x, z, r.range(0.9, 1.6))
      }
    }
    return out
  }, [site])
}

function Trees({ site }: { site: Site }) {
  const trees = useTrees(site)
  const crownR = useRef<THREE.InstancedMesh>(null)
  const crownC = useRef<THREE.InstancedMesh>(null)
  const trunk = useRef<THREE.InstancedMesh>(null)
  const wobble = useRef(new Map<number, number>())
  const roundIdx = useMemo(() => trees.map((t, i) => (t.kind === 0 ? i : -1)).filter((i) => i >= 0), [trees])
  const coneIdx = useMemo(() => trees.map((t, i) => (t.kind === 1 ? i : -1)).filter((i) => i >= 0), [trees])

  const place = (ti: number, sway: number) => {
    const t = trees[ti]
    const isCone = t.kind === 1
    const list = isCone ? coneIdx : roundIdx
    const k = list.indexOf(ti)
    tmp.position.set(t.x, (isCone ? 3.2 : 2.7) * t.s, t.z)
    tmp.rotation.set(sway * 0.5, 0, sway)
    tmp.scale.setScalar(t.s)
    tmp.updateMatrix()
    ;(isCone ? crownC : crownR).current!.setMatrixAt(k, tmp.matrix)
  }

  useLayoutEffect(() => {
    // 나무마다 조금씩 다른 초록
    const tc = new THREE.Color()
    roundIdx.forEach((ti, k) => crownR.current!.setColorAt(k, tc.set(TREE_COLORS[(ti * 7 + 3) % TREE_COLORS.length])))
    coneIdx.forEach((ti, k) => crownC.current!.setColorAt(k, tc.set(CONE_COLORS[(ti * 5 + 1) % CONE_COLORS.length])))
    for (const m of [crownR, crownC]) if (m.current!.instanceColor) m.current!.instanceColor.needsUpdate = true
    trees.forEach((t, i) => {
      place(i, 0)
      tmp.position.set(t.x, 0.9 * t.s, t.z)
      tmp.rotation.set(0, 0, 0)
      tmp.scale.setScalar(t.s)
      tmp.updateMatrix()
      trunk.current!.setMatrixAt(i, tmp.matrix)
    })
    for (const m of [crownR, crownC, trunk]) {
      m.current!.instanceMatrix.needsUpdate = true
      m.current!.computeBoundingSphere()
    }
    // place는 trees·인덱스만 사용
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trees])

  useFrame(() => {
    if (!wobble.current.size) return
    const now = performance.now() / 1000
    for (const [ti, t0] of wobble.current) {
      const u = now - t0
      const sway = u > 1.6 ? 0 : Math.sin(u * 14) * 0.22 * Math.exp(-u * 2.4)
      place(ti, sway)
      if (u > 1.6) wobble.current.delete(ti)
    }
    crownR.current!.instanceMatrix.needsUpdate = true
    crownC.current!.instanceMatrix.needsUpdate = true
  })

  const shake = (list: number[]) => (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    if (e.instanceId == null) return
    const ti = list[e.instanceId]
    const prev = wobble.current.get(ti)
    const now = performance.now() / 1000
    if (prev == null || now - prev > 0.8) wobble.current.set(ti, now)
  }

  return (
    <group>
      <instancedMesh ref={crownR} args={[undefined, undefined, roundIdx.length]} castShadow receiveShadow onPointerOver={shake(roundIdx)} onClick={shake(roundIdx)}>
        <icosahedronGeometry args={[1.7, 1]} />
        <meshStandardMaterial color="#ffffff" roughness={0.95} flatShading />
      </instancedMesh>
      <instancedMesh ref={crownC} args={[undefined, undefined, coneIdx.length]} castShadow receiveShadow onPointerOver={shake(coneIdx)} onClick={shake(coneIdx)}>
        <coneGeometry args={[1.5, 4.2, 7]} />
        <meshStandardMaterial color="#ffffff" roughness={0.95} flatShading />
      </instancedMesh>
      <instancedMesh ref={trunk} args={[undefined, undefined, trees.length]} castShadow>
        <cylinderGeometry args={[0.12, 0.17, 1.8, 6]} />
        <meshStandardMaterial color={P.trunk} roughness={1} />
      </instancedMesh>
    </group>
  )
}

function Fence({ site }: { site: Site }) {
  const C = site.layout.campus
  const posts = useMemo(() => {
    const out: [number, number][] = []
    const gapZ = (z: number) => z > 29.8 && z < 43.8
    for (let x = C.x0; x <= C.x1; x += 3) out.push([x, C.z0], [x, C.z1])
    for (let z = C.z0 + 3; z < C.z1; z += 3) {
      if (!gapZ(z)) out.push([C.x0, z], [C.x1, z])
    }
    return out
  }, [C])
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    posts.forEach(([x, z], i) => {
      tmp.position.set(x, 1.0, z)
      tmp.rotation.set(0, 0, 0)
      tmp.scale.set(1, 1, 1)
      tmp.updateMatrix()
      ref.current!.setMatrixAt(i, tmp.matrix)
    })
    ref.current!.instanceMatrix.needsUpdate = true
    ref.current!.computeBoundingSphere()
  }, [posts])
  const rails = useMemo(() => {
    const w = C.x1 - C.x0
    const segs: Part[] = []
    for (const y of [0.55, 1.8]) {
      segs.push({ geo: box(w, 0.05, 0.05), pos: [(C.x0 + C.x1) / 2, y, C.z0], color: P.fence })
      segs.push({ geo: box(w, 0.05, 0.05), pos: [(C.x0 + C.x1) / 2, y, C.z1], color: P.fence })
      for (const x of [C.x0, C.x1]) {
        segs.push({ geo: box(0.05, 0.05, 29.8 - C.z0), pos: [x, y, (C.z0 + 29.8) / 2], color: P.fence })
        segs.push({ geo: box(0.05, 0.05, C.z1 - 43.8), pos: [x, y, (43.8 + C.z1) / 2], color: P.fence })
      }
    }
    return segs
  }, [C])
  return (
    <group>
      <instancedMesh ref={ref} args={[undefined, undefined, posts.length]} castShadow>
        <boxGeometry args={[0.1, 2.0, 0.1]} />
        <meshStandardMaterial color={P.fence} roughness={0.7} />
      </instancedMesh>
      <mesh geometry={merged(`rails-${site.cfg.id}`, () => rails)} material={vcMatMatte} />
    </group>
  )
}

// 정적 건물들을 사이트별 지오메트리 하나로
function campusStatic(site: Site) {
  return merged(`campus-${site.cfg.id}`, () => {
    const Lg = site.layout
    const o = Lg.facilities.office
    const sh = Lg.facilities.shop
    const g = Lg.facilities.gate
    const parts: Part[] = []
    // 사무동 (3층): 흰 몸체 + 파란 지붕띠 + 주황 계단실 + 층마다 색 띠
    parts.push({ geo: box(o.w, o.h, o.d), pos: [o.x, o.h / 2, o.z], color: OFFICE_WHITE })
    parts.push({ geo: box(o.w + 0.4, 0.7, o.d + 0.4), pos: [o.x, o.h + 0.15, o.z], color: P.wall })
    parts.push({ geo: box(3.0, o.h + 1.4, 4.6), pos: [o.x - o.w / 2 - 1.3, (o.h + 1.4) / 2, o.z - 1.5], color: '#EE8424' })
    parts.push({ geo: box(0.08, o.h - 1.2, 1.2), pos: [o.x - o.w / 2 - 2.82, (o.h - 1.2) / 2 + 0.6, o.z - 1.5], color: P.glassWall })
    for (let f = 0; f < 3; f++) {
      parts.push({ geo: box(o.w + 0.1, 0.32, o.d + 0.1), pos: [o.x, 0.9 + f * 3.4, o.z], color: f === 1 ? '#2B9A64' : '#D9DDE3' })
    }
    // 옥상 실외기
    for (let i = 0; i < 3; i++) parts.push({ geo: box(1.4, 0.9, 1.0), pos: [o.x - 4 + i * 3, o.h + 0.95, o.z + 2], color: '#C9CED6' })
    parts.push({ geo: box(3.6, 0.2, 3.2), pos: [o.x + o.w / 2 + 1.6, 3.1, o.z + 2], color: P.frame })
    parts.push({ geo: box(0.12, 3.0, 0.12), pos: [o.x + o.w / 2 + 3.2, 1.5, o.z + 0.6], color: P.frame })
    parts.push({ geo: box(0.12, 3.0, 0.12), pos: [o.x + o.w / 2 + 3.2, 1.5, o.z + 3.4], color: P.frame })
    for (let f = 0; f < 3; f++) parts.push({ geo: box(0.3, 0.2, 2.2), pos: [o.x + o.w / 2 + 0.05, 2.6 + f * 3.4, o.z + 2], color: '#2A2A2A' })
    // 정비동: 밝은 회색 벽 + 파란 지붕띠 + 롤업 셔터 3개
    parts.push({ geo: box(sh.w, sh.h, sh.d), pos: [sh.x, sh.h / 2, sh.z], color: '#E6E9ED' })
    parts.push({ geo: box(sh.w + 0.4, 0.6, sh.d + 0.4), pos: [sh.x, sh.h + 0.1, sh.z], color: P.roofDeck })
    parts.push({ geo: box(sh.w + 0.5, 0.5, 0.3), pos: [sh.x, sh.h + 0.15, sh.z + sh.d / 2 + 0.1], color: P.wall })
    parts.push({ geo: box(sh.w + 0.5, 0.5, 0.3), pos: [sh.x, sh.h + 0.15, sh.z - sh.d / 2 - 0.1], color: P.wall })
    for (let i = 0; i < 3; i++) {
      const x = sh.x - sh.w / 2 + 3.6 + i * 6.4
      parts.push({ geo: box(4.2, 4.6, 0.1), pos: [x, 2.3, sh.z + sh.d / 2 + 0.03], color: P.door })
      parts.push({ geo: box(4.6, 0.3, 0.2), pos: [x, 4.75, sh.z + sh.d / 2 + 0.05], color: P.trim })
    }
    parts.push({ geo: cyl(2.6, 7, 20), pos: [sh.x + sh.w / 2 + 5, 3.5, sh.z - 3], color: '#F2F4F6' })
    parts.push({ geo: cyl(2.65, 0.4, 20), pos: [sh.x + sh.w / 2 + 5, 5.2, sh.z - 3], color: P.wall })
    parts.push({ geo: box(2.2, 1.8, 1.6), pos: [sh.x + sh.w / 2 + 5, 0.9, sh.z + 3.5], color: '#8C939D' })
    // 정문 경비실 + 캐노피
    parts.push({ geo: box(g.w, g.h, g.d), pos: [g.x, g.h / 2, g.z], color: OFFICE_WHITE })
    parts.push({ geo: box(g.w + 0.8, 0.2, g.d + 0.8), pos: [g.x, g.h + 0.1, g.z], color: P.wall })
    parts.push({ geo: box(0.35, 1.1, 0.35), pos: [g.x + 1.6, 0.55, L.LANE_IN - 3.2], color: P.frame })
    for (const z of [30.6, 43]) parts.push({ geo: box(0.4, 6.4, 0.4), pos: [g.x + 6, 3.2, z], color: P.frame })
    parts.push({ geo: box(1.2, 0.8, 13), pos: [g.x + 6, 6.6, 36.8], color: P.frame })
    // 후문(출구) 경비실
    parts.push({ geo: box(2.6, 2.8, 2.6), pos: [Lg.exitGateX, 1.4, 45.4], color: OFFICE_WHITE })
    parts.push({ geo: box(3.2, 0.2, 3.2), pos: [Lg.exitGateX, 2.9, 45.4], color: P.wall })
    parts.push({ geo: box(0.35, 1.1, 0.35), pos: [Lg.exitGateX - 1.6, 0.55, 42.6], color: P.frame })
    return parts
  })
}

function campusGlass(site: Site) {
  return merged(`campus-glass-${site.cfg.id}`, () => {
    const o = site.layout.facilities.office
    const parts: Part[] = []
    for (let f = 0; f < 3; f++) {
      const y = 1.9 + f * 3.4
      parts.push({ geo: box(o.w - 1.2, 1.5, 0.06), pos: [o.x, y, o.z + o.d / 2 + 0.01], color: '#fff' })
      parts.push({ geo: box(o.w - 1.2, 1.5, 0.06), pos: [o.x, y, o.z - o.d / 2 - 0.01], color: '#fff' })
      parts.push({ geo: box(0.06, 1.5, o.d - 1.2), pos: [o.x - o.w / 2 - 0.01, y, o.z], color: '#fff' })
      parts.push({ geo: box(0.06, 1.5, o.d - 4.4), pos: [o.x + o.w / 2 + 0.01, y, o.z - 1.6], color: '#fff' })
    }
    const g = site.layout.facilities.gate
    parts.push({ geo: box(g.w + 0.02, 1.1, g.d - 0.6), pos: [g.x, 1.9, g.z], color: '#fff' })
    return parts
  })
}

function parkingCars(site: Site) {
  return merged(`cars-${site.cfg.id}`, () => {
    const p = site.layout.facilities.parking
    const r = new Rng(site.cfg.seed + 11)
    let k = 0
    const colors = CAR_COLORS
    const parts: Part[] = []
    const cols = Math.floor((p.w - 2) / 2.7)
    for (const zRow of [p.z - p.d / 2 + 3.2, p.z + p.d / 2 - 3.2]) {
      for (let i = 0; i < cols; i++) {
        const x = p.x - p.w / 2 + 2.4 + i * 2.7
        parts.push({ geo: box(0.1, 0.02, 4.6), pos: [x - 1.35, 0.01, zRow], color: P.lane })
        if (!site.parked[k++]) continue
        const c = r.pick(colors)
        parts.push({ geo: box(1.75, 0.66, 4.2), pos: [x, 0.55, zRow], color: c })
        parts.push({ geo: box(1.56, 0.5, 2.1), pos: [x, 1.12, zRow - 0.1], color: P.glass })
        parts.push({ geo: box(1.5, 0.06, 1.9), pos: [x, 1.4, zRow - 0.1], color: c })
        for (const wz of [-1.3, 1.3]) parts.push({ geo: box(1.82, 0.5, 0.62), pos: [x, 0.3, zRow + wz], color: P.tire })
      }
    }
    return parts
  })
}

function Barrier({ x, pivotZ, dir, lane, site }: { x: number; pivotZ: number; dir: 1 | -1; lane: 'in' | 'out'; site: Site }) {
  const arm = useRef<THREE.Group>(null)
  const a = useRef(0)
  useFrame((_, dt) => {
    let open = false
    for (const tr of site.trucks.values()) {
      if (lane === 'in' ? tr.phase !== 'arriving' : tr.phase !== 'departing') continue
      const p = site.truckPose(tr, world.time)
      if (Math.abs(p.x - x) < 26) {
        open = true
        break
      }
    }
    a.current += ((open ? 1.35 : 0) - a.current) * Math.min(1, dt * 4)
    if (arm.current) arm.current.rotation.x = -dir * a.current
  })
  return (
    <group ref={arm} position={[x, 1.05, pivotZ]}>
      <mesh position={[0, 0, (dir * 6.4) / 2]} castShadow>
        <boxGeometry args={[0.14, 0.14, 6.4]} />
        <meshStandardMaterial color="#F4F4F2" />
      </mesh>
      {[1, 3, 5].map((k) => (
        <mesh key={k} position={[0, 0, dir * (k + 0.5)]}>
          <boxGeometry args={[0.16, 0.16, 0.7]} />
          <meshStandardMaterial color={P.crit} />
        </mesh>
      ))}
    </group>
  )
}

function FacilityHits({ site }: { site: Site }) {
  useUi((s) => s.tick)
  const select = useUi((s) => s.select)
  const setHover = useUi((s) => s.setHover)
  const F = site.layout.facilities
  const yard = site.yardTrucks().length
  const cap = site.layout.holding.laneZ.length * site.layout.holding.perLane
  const items: { id: L.FacilityId; h: number; tag: string }[] = [
    { id: 'office', h: F.office.h, tag: '사무동' },
    { id: 'shop', h: F.shop.h, tag: '정비동' },
    { id: 'gate', h: 4.2, tag: '정문' },
    { id: 'lot', h: 1.2, tag: `대기장 ${yard}/${cap}` },
    { id: 'parking', h: 1.2, tag: '주차장' },
  ]
  return (
    <group>
      {items.map(({ id, h, tag }) => {
        const f = F[id]
        const sel = { kind: 'facility' as const, id }
        return (
          <group key={id}>
            <mesh
              position={[f.x, Math.max(h, 0.4) / 2, f.z]}
              onClick={(e) => {
                e.stopPropagation()
                select(sel)
              }}
              onPointerOver={(e) => {
                e.stopPropagation()
                setHover(sel)
              }}
              onPointerOut={() => setHover(null)}
            >
              <boxGeometry args={[f.w + 0.4, Math.max(h, 0.4), f.d + 0.4]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
            <Html position={[f.x, h + 2.2, f.z]} center zIndexRange={[11, 0]}>
              <button type="button" className="fac-tag" onClick={() => select(sel)}>
                {tag}
              </button>
            </Html>
          </group>
        )
      })}
    </group>
  )
}

export function Surroundings({ site }: { site: Site }) {
  const Lg = site.layout
  const p = Lg.facilities.parking
  return (
    <group>
      <Trees site={site} />
      <Fence site={site} />
      <mesh geometry={campusStatic(site)} material={vcMatMatte} castShadow receiveShadow />
      <mesh geometry={campusGlass(site)} material={nightMats.window} />
      <mesh position={[p.x, -0.012, p.z]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[p.w, p.d]} />
        <meshStandardMaterial color={P.yard} roughness={1} />
      </mesh>
      <mesh geometry={parkingCars(site)} material={vcMatMatte} castShadow />
      <Barrier site={site} x={Lg.gateX + 1.6} pivotZ={L.LANE_IN - 3.2} dir={1} lane="in" />
      <Barrier site={site} x={Lg.exitGateX - 1.6} pivotZ={42.6} dir={-1} lane="out" />
      <FacilityHits site={site} />
    </group>
  )
}
