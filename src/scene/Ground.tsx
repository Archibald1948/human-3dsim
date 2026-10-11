// 바닥·도로·조경 — 잔디 위에 아스팔트 도로·야드, 연석·보도·순환 도로·차선·화살표·과속방지턱·볼라드·관목·컨테이너 야드
// 모든 좌표는 사이트 레이아웃에서 계산
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import * as L from '../sim/layout'
import type { Site } from '../sim/engine'
import { Rng } from '../sim/rng'
import { CONTAINER_COLORS, P, SHRUB_COLORS } from './palette'
import { box, cyl, merged, vcMat, type Part } from './merge'
import { groundGeometry } from './River'

type V3 = [number, number, number]
interface Mark {
  x: number
  z: number
  w: number
  d: number
  r?: number
}

function Block({ p, s, c, cast = false, rough = 0.92 }: { p: V3; s: V3; c: string; cast?: boolean; rough?: number }) {
  return (
    <mesh position={p} castShadow={cast} receiveShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} roughness={rough} />
    </mesh>
  )
}

function Strip({ x0, x1, z0, z1, c, y = 0.012 }: { x0: number; x1: number; z0: number; z1: number; c: string; y?: number }) {
  return (
    <mesh position={[(x0 + x1) / 2, y, (z0 + z1) / 2]} rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[Math.abs(x1 - x0), Math.abs(z1 - z0)]} />
      <meshStandardMaterial color={c} roughness={1} />
    </mesh>
  )
}

const tmp = new THREE.Object3D()
const col = new THREE.Color()

// 같은 모양의 바닥 표시(점선·화살표 등)를 InstancedMesh 하나로
function Marks({ items, c, y = 0.016, geo }: { items: Mark[]; c: string; y?: number; geo?: THREE.BufferGeometry }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const g = useMemo(() => geo ?? new THREE.PlaneGeometry(1, 1), [geo])
  useLayoutEffect(() => {
    items.forEach((m, i) => {
      tmp.position.set(m.x, y, m.z)
      tmp.rotation.set(-Math.PI / 2, 0, m.r ?? 0)
      tmp.scale.set(m.w, m.d, 1)
      tmp.updateMatrix()
      ref.current!.setMatrixAt(i, tmp.matrix)
    })
    ref.current!.instanceMatrix.needsUpdate = true
    ref.current!.computeBoundingSphere()
  }, [items, y])
  return (
    <instancedMesh ref={ref} args={[g, undefined, items.length]} receiveShadow>
      <meshStandardMaterial color={c} roughness={1} />
    </instancedMesh>
  )
}

// 화살표 (단위 크기, +x 방향)
const arrowGeo = (() => {
  const s = new THREE.Shape()
  s.moveTo(0.5, 0)
  s.lineTo(0.05, 0.42)
  s.lineTo(0.05, 0.16)
  s.lineTo(-0.5, 0.16)
  s.lineTo(-0.5, -0.16)
  s.lineTo(0.05, -0.16)
  s.lineTo(0.05, -0.42)
  s.closePath()
  return new THREE.ShapeGeometry(s)
})()

// 인스턴스마다 색이 다른 상자 (컨테이너, 관목 등)
function Instances({ items, geo, mat, cast = true }: { items: { p: V3; s: V3; r?: number; c: string }[]; geo: THREE.BufferGeometry; mat: THREE.Material; cast?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current!
    items.forEach((it, i) => {
      tmp.position.set(...it.p)
      tmp.rotation.set(0, it.r ?? 0, 0)
      tmp.scale.set(...it.s)
      tmp.updateMatrix()
      m.setMatrixAt(i, tmp.matrix)
      m.setColorAt(i, col.set(it.c))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
  }, [items])
  return <instancedMesh ref={ref} args={[geo, mat, items.length]} castShadow={cast} receiveShadow />
}

// 컨테이너 골판 (흰 바탕 → 인스턴스 색이 곱해진다)
let corrTex: THREE.CanvasTexture | null = null
function corrugation() {
  if (corrTex) return corrTex
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 4
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 32, 4)
  g.fillStyle = '#d4d4d4'
  g.fillRect(20, 0, 8, 4)
  corrTex = new THREE.CanvasTexture(c)
  corrTex.colorSpace = THREE.SRGBColorSpace
  corrTex.wrapS = corrTex.wrapT = THREE.RepeatWrapping
  corrTex.repeat.set(14, 1)
  return corrTex
}
const containerGeo = new THREE.BoxGeometry(1, 1, 1)
const shrubGeo = new THREE.IcosahedronGeometry(1, 1)
let containerMat: THREE.MeshStandardMaterial | null = null
let shrubMat: THREE.MeshStandardMaterial | null = null
// 인스턴스 색만 쓰는 무광 재질 (과속방지턱)
const plainMat = new THREE.MeshStandardMaterial({ roughness: 0.85 })

export function Ground({ site }: { site: Site }) {
  const Lg = site.layout
  const W = Lg.wall
  const H = Lg.holding
  const C = Lg.campus
  const groundGeo = useMemo(() => groundGeometry(site), [site])
  const dockXs = Lg.dockXs
  const key = site.cfg.id
  const ROAD_Z0 = 30.4
  const ROAD_Z1 = 43.2
  // 순환 도로: 건물 서·북·동쪽, 폭 5 m (벽에서 2 m 띄움)
  const ring = { x0: W.x0 - 7, x1: W.x1 + 7, z0: W.z0 - 7, w: 5 }
  const yardX1 = H.entryX + 4

  const laneMarks = useMemo(() => {
    const out: Mark[] = []
    for (let x = Lg.exitX - 60; x < Lg.spawnX + 60; x += 6) out.push({ x: x + 1.5, z: (L.LANE_IN + L.LANE_OUT) / 2, w: 3, d: 0.18 })
    // 도크 주차 구획선
    for (let i = 0; i < dockXs.length - 1; i++) out.push({ x: (dockXs[i] + dockXs[i + 1]) / 2, z: 20, w: 0.14, d: 13 })
    // 대기장 레인 구분선
    const lx0 = H.x0 - 14
    const lx1 = H.eastX + 8
    for (let i = 0; i <= H.laneZ.length; i++) {
      const z = i === 0 ? H.laneZ[0] - 2.3 : i === H.laneZ.length ? H.laneZ[i - 1] + 2.3 : (H.laneZ[i - 1] + H.laneZ[i]) / 2
      for (let x = lx0; x < lx1; x += 4) out.push({ x: x + 1.2, z, w: 2.4, d: 0.14 })
    }
    // 순환 도로 중앙 점선
    const rc = ring.w / 2
    for (let z = ring.z0 + 4; z < W.z1 - 2; z += 4) out.push({ x: ring.x0 + rc, z, w: 0.14, d: 2 }, { x: ring.x1 - rc, z, w: 0.14, d: 2 })
    for (let x = ring.x0 + 4; x < ring.x1 - 4; x += 4) out.push({ x, z: ring.z0 + rc, w: 2, d: 0.14 })
    // 보행자 횡단보도 (서측 출입구 → 사무동)
    for (let z = -1.4; z <= 1.41; z += 0.7) out.push({ x: ring.x0 + rc, z: Lg.pedOut.z + z, w: ring.w - 0.4, d: 0.36 })
    return out
    // ring은 W에서 계산되는 값
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Lg, H, W, dockXs])

  const floorMarks = useMemo(() => {
    const out: Mark[] = []
    // 건물 안 메인 통로 점선 (노랑)
    for (let x = W.x0 + 3; x < W.x1 - 3; x += 3) out.push({ x: x + 0.8, z: Lg.corridorZ, w: 1.6, d: 0.12 })
    // 도크 앞 작업 구역 테두리
    for (const x of dockXs) out.push({ x: x - 1.95, z: 10.65, w: 0.1, d: 3.9 }, { x: x + 1.95, z: 10.65, w: 0.1, d: 3.9 })
    return out
  }, [Lg, W, dockXs])

  const edgeMarks = useMemo(
    () => [
      { x: (Lg.exitX - 60 + W.x0 - 6) / 2, z: 30.6, w: W.x0 - 6 - (Lg.exitX - 60), d: 0.2 },
      { x: (yardX1 + 2 + Lg.spawnX + 60) / 2, z: 30.6, w: Lg.spawnX + 60 - (yardX1 + 2), d: 0.2 },
      { x: (Lg.exitX + Lg.spawnX) / 2, z: 42.8, w: Lg.spawnX - Lg.exitX + 120, d: 0.2 },
    ],
    [Lg, W, yardX1],
  )

  // 진행 방향 화살표: 도로 두 차로 모두 서쪽, 대기장 레인도 서쪽(앞쪽)으로
  const arrows = useMemo(() => {
    const out: Mark[] = []
    for (let x = Lg.exitX - 40; x < Lg.spawnX + 40; x += 34) {
      out.push({ x, z: L.LANE_IN, w: 3.4, d: 1.4, r: Math.PI }, { x: x + 17, z: L.LANE_OUT, w: 3.4, d: 1.4, r: Math.PI })
    }
    for (const z of H.laneZ) out.push({ x: H.x0 - 9, z, w: 3, d: 1.3, r: Math.PI })
    return out
  }, [Lg, H])

  // 과속방지턱 (순환 도로·야드 입구) = 노랑/검정 줄무늬
  const bumps = useMemo(() => {
    const out: { p: V3; s: V3; r?: number; c: string }[] = []
    const across = (cx: number, cz: number, len: number, alongX: boolean) => {
      const n = Math.round(len / 0.6)
      for (let i = 0; i < n; i++) {
        const o = -len / 2 + (i + 0.5) * (len / n)
        out.push({ p: alongX ? [cx + o, 0.04, cz] : [cx, 0.04, cz + o], s: alongX ? [len / n, 0.08, 0.5] : [0.5, 0.08, len / n], c: i % 2 ? P.ink : P.hazard })
      }
    }
    across(ring.x0 + ring.w / 2, W.z0 + 8, ring.w, true)
    across(ring.x1 - ring.w / 2, W.z0 + 8, ring.w, true)
    across(0, ring.z0 + ring.w / 2, ring.w, false)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [W])

  // 볼라드: 건물 모서리·출입문·사무동 현관·정문
  const bollards = useMemo(() => {
    const pts: [number, number][] = []
    for (const [x, z, sx, sz] of [
      [W.x0, W.z0, -1, -1],
      [W.x1, W.z0, 1, -1],
      [W.x0, W.z1, -1, 1],
      [W.x1, W.z1, 1, 1],
    ])
      pts.push([x + sx * 1.0, z + sz * 0.3], [x + sx * 0.3, z + sz * 1.0])
    pts.push([W.x0 - 1.0, Lg.corridorZ - 2.0], [W.x0 - 1.0, Lg.corridorZ + 2.0])
    const o = Lg.facilities.office
    pts.push([Lg.officeDoor.x + 1.2, Lg.officeDoor.z - 1.8], [Lg.officeDoor.x + 1.2, Lg.officeDoor.z + 1.8])
    const g = Lg.facilities.gate
    pts.push([g.x - 2.2, g.z - 2.2], [g.x + 2.2, g.z - 2.2], [g.x - 2.2, g.z + 2.2], [g.x + 2.2, g.z + 2.2])
    void o
    return pts
  }, [Lg, W])

  const curbGeo = merged(`curbs-${key}`, () => {
    const parts: Part[] = []
    const run = (x0: number, x1: number, z0: number, z1: number) => {
      if (x1 - x0 < 0.2 && z1 - z0 < 0.2) return
      parts.push({ geo: box(Math.max(0.3, x1 - x0), 0.16, Math.max(0.3, z1 - z0)), pos: [(x0 + x1) / 2, 0.06, (z0 + z1) / 2], color: P.curb })
    }
    // 도로 북측 연석 (전 구간) + 남측 연석 (야드 진출입 구간 제외)
    run(Lg.exitX - 300, Lg.spawnX + 300, ROAD_Z1, ROAD_Z1 + 0.3)
    run(C.x0, ring.x0 - 0.3, ROAD_Z0 - 0.3, ROAD_Z0)
    run(yardX1, C.x1, ROAD_Z0 - 0.3, ROAD_Z0)
    // 순환 도로 바깥 연석
    run(ring.x0 - 0.3, ring.x0, ring.z0, W.z1)
    run(ring.x1, ring.x1 + 0.3, ring.z0, W.z1)
    run(ring.x0 - 0.3, ring.x1 + 0.3, ring.z0 - 0.3, ring.z0)
    // 볼라드 (노랑 기둥 + 반사띠)
    for (const [x, z] of bollards) {
      parts.push({ geo: cyl(0.13, 1.0, 10), pos: [x, 0.5, z], color: P.hazard })
      parts.push({ geo: cyl(0.135, 0.12, 10), pos: [x, 0.78, z], color: P.ink })
    }
    return parts
  })

  // 관목: 순환 도로 바깥, 사무동 둘레, 주차장 가장자리
  const shrubs = useMemo(() => {
    const r = new Rng(site.cfg.seed * 13 + 5)
    const out: { p: V3; s: V3; r?: number; c: string }[] = []
    const add = (x: number, z: number) => {
      const s = r.range(0.55, 0.95)
      out.push({ p: [x + r.range(-0.3, 0.3), s * 0.55, z + r.range(-0.3, 0.3)], s: [s, s * 0.75, s], r: r.range(0, 6), c: r.pick(SHRUB_COLORS) })
    }
    for (let x = ring.x0 + 2; x < ring.x1 - 2; x += 2.6) add(x, ring.z0 - 1.6)
    for (let z = ring.z0 + 2; z < W.z1 - 2; z += 2.6) {
      if (Math.abs(z - Lg.pedOut.z) > 3) add(ring.x0 - 1.6, z)
      add(ring.x1 + 1.6, z)
    }
    const o = Lg.facilities.office
    for (let x = o.x - o.w / 2; x <= o.x + o.w / 2; x += 2.2) add(x, o.z + o.d / 2 + 1.4)
    const p = Lg.facilities.parking
    for (let x = p.x - p.w / 2 + 1; x <= p.x + p.w / 2 - 1; x += 2.4) add(x, p.z + p.d / 2 + 1.2)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site, Lg, W])

  // 컨테이너 야드: 정비동 동쪽, 2단 적재
  const containers = useMemo(() => {
    const r = new Rng(site.cfg.seed * 17 + 1)
    const sh = Lg.facilities.shop
    const x0 = sh.x + sh.w / 2 + 9
    const out: { p: V3; s: V3; r?: number; c: string }[] = []
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 2; k++) {
        const x = x0 + 6.6 + k * 13.6
        const z = sh.z - 6 + row * 3.4
        const levels = r.chance(0.75) ? 2 : 1
        for (let lv = 0; lv < levels; lv++) out.push({ p: [x, 1.3 + lv * 2.62, z], s: [12.2, 2.6, 2.44], c: r.pick(CONTAINER_COLORS) })
      }
    return { items: out, pad: { x0: x0 - 1, x1: x0 + 28.2, z0: sh.z - 8.4, z1: sh.z + 6.4 } }
  }, [site, Lg])
  containerMat ??= new THREE.MeshStandardMaterial({ map: corrugation(), roughness: 0.75, metalness: 0.1 })
  shrubMat ??= new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true })

  const cz = (W.z0 + W.z1) / 2

  return (
    <group>
      {/* 지면: 강이 있으면 강 띠를 비운 두 조각 */}
      <mesh geometry={groundGeo} position={[0, -0.06, 0]} receiveShadow>
        <meshStandardMaterial color={P.ground} roughness={1} />
      </mesh>
      {/* 캠퍼스 잔디 */}
      <Strip x0={C.x0} x1={C.x1} z0={C.z0} z1={ROAD_Z0} c={P.lawn} y={-0.04} />
      {/* 도로 + 북측 보도 */}
      <Strip x0={Lg.exitX - 300} x1={Lg.spawnX + 300} z0={ROAD_Z0} z1={ROAD_Z1} c={P.road} y={-0.02} />
      <Strip x0={C.x0} x1={C.x1} z0={ROAD_Z1 + 0.3} z1={ROAD_Z1 + 2.2} c={P.sidewalk} y={-0.018} />
      <Strip x0={C.x0} x1={ring.x0 - 0.3} z0={ROAD_Z0 - 2.1} z1={ROAD_Z0 - 0.3} c={P.sidewalk} y={-0.018} />
      {/* 야드(도크 앞 + 대기장) */}
      <Strip x0={ring.x0} x1={yardX1} z0={W.z1} z1={ROAD_Z0} c={P.yard} y={-0.025} />
      <Strip x0={W.x0 - 1} x1={W.x1 + 1} z0={W.z1} z1={27.6} c={P.apron} y={-0.015} />
      {/* 순환 도로 + 건물 둘레 보도 */}
      <Strip x0={ring.x0} x1={ring.x0 + ring.w} z0={ring.z0} z1={W.z1} c={P.road} y={-0.022} />
      <Strip x0={ring.x1 - ring.w} x1={ring.x1} z0={ring.z0} z1={W.z1} c={P.road} y={-0.022} />
      <Strip x0={ring.x0} x1={ring.x1} z0={ring.z0} z1={ring.z0 + ring.w} c={P.road} y={-0.022} />
      <Strip x0={W.x0 - 2} x1={W.x1 + 2} z0={W.z0 - 2} z1={W.z1} c={P.paving} y={-0.03} />
      {/* 보행로: 서측 출입구 → 사무동 */}
      <Strip x0={Lg.officeDoor.x - 0.5} x1={Lg.pedOut.x + 0.5} z0={Lg.pedOut.z - 1} z1={Lg.pedOut.z + 1} c={P.sidewalk} y={-0.01} />
      <Strip x0={Lg.officeDoor.x - 1} x1={Lg.officeDoor.x + 1} z0={Math.min(Lg.officeDoor.z, Lg.pedOut.z) - 1} z1={Math.max(Lg.officeDoor.z, Lg.pedOut.z) + 1} c={P.sidewalk} y={-0.01} />
      {/* 컨테이너 야드 바닥 */}
      <Strip x0={containers.pad.x0} x1={containers.pad.x1} z0={containers.pad.z0} z1={containers.pad.z1} c={P.paving} y={-0.02} />

      <Marks items={laneMarks} c={P.lane} />
      <Marks items={edgeMarks} c={P.lane} y={0.014} />
      <Marks items={arrows} c={P.lane} y={0.017} geo={arrowGeo} />
      <Instances items={bumps} geo={containerGeo} mat={plainMat} cast={false} />
      <mesh geometry={curbGeo} material={vcMat} castShadow receiveShadow />
      <Instances items={shrubs} geo={shrubGeo} mat={shrubMat} />
      <Instances items={containers.items} geo={containerGeo} mat={containerMat} />

      {/* 건물 바닥 슬래브 + 바닥 표시 */}
      <Block p={[0, -0.06, cz]} s={[Lg.width, 0.14, Lg.depth]} c={P.slab} rough={0.85} />
      <Marks items={floorMarks} c={P.laneYellow} y={0.014} />

      {/* 도크 레벨러 + 스테이징 존 */}
      {dockXs.map((x, i) => (
        <group key={i}>
          <Block p={[x, 0.04, W.z1 - 0.55]} s={[2.7, 0.08, 1.1]} c="#AEB4BC" />
          <Strip x0={x - 1.9} x1={x + 1.9} z0={8.7} z1={12.6} c={P.zone} y={0.008} />
        </group>
      ))}

      {/* 충전 스테이션: 랙 앞 대기 칸 줄의 양 끝, 칸 옆에 충전기 */}
      {Lg.chargers.map((c, i) => {
        const side = c.x < 0 ? -1 : 1
        const cx = c.x + side * 1.2
        return (
          <group key={i}>
            <Strip x0={c.x - 0.75} x1={c.x + 0.75} z0={c.z - 1.85} z1={c.z + 1.85} c="#BFE3C8" y={0.008} />
            <Block p={[cx, 0.75, c.z + 0.9]} s={[0.3, 1.5, 0.5]} c={P.frame} cast />
            <mesh position={[cx - side * 0.16, 1.25, c.z + 0.9]}>
              <boxGeometry args={[0.04, 0.12, 0.3]} />
              <meshBasicMaterial color={P.ok} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}
