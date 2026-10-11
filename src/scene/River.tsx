// 강: 지면을 강 띠만큼 비워 두고(GroundPlane), 아래로 수면·돌 둑을 그린다. 대로는 다리로 건너고 작은 배가 오간다
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Site } from '../sim/engine'
import { Rng } from '../sim/rng'
import { P } from './palette'
import { box, merged, vcMat, type Part } from './merge'
import { cityPlan, riverCenter, type River as RiverT } from './cityPlan'

const SIDEWALK = 2.6
const EXTENT = 1200 // 지면 판 반경 (Ground의 2400 판과 같음)
const STEP = 6
const WATER_Y = -2.2
const BED_Y = -2.5

const edge = (rv: RiverT, x: number, s: -1 | 1) => riverCenter(rv, x) + s * rv.half

// 강이 있으면 지면 판을 강 북쪽·남쪽 두 조각으로 만든다 (없으면 한 장)
export function groundGeometry(site: Site): THREE.BufferGeometry {
  const rv = cityPlan(site).river
  if (!rv) {
    const g = new THREE.PlaneGeometry(EXTENT * 2, EXTENT * 2)
    g.rotateX(-Math.PI / 2)
    return g
  }
  // 모양 좌표는 (x, -z): XZ 평면으로 눕히면 z가 된다
  const north = new THREE.Shape()
  north.moveTo(-EXTENT, EXTENT)
  north.lineTo(EXTENT, EXTENT)
  for (let x = EXTENT; x >= -EXTENT; x -= STEP) north.lineTo(x, -edge(rv, x, -1))
  north.closePath()
  const south = new THREE.Shape()
  south.moveTo(-EXTENT, -EXTENT)
  for (let x = -EXTENT; x <= EXTENT; x += STEP) south.lineTo(x, -edge(rv, x, 1))
  south.lineTo(EXTENT, -EXTENT)
  south.closePath()
  const g = new THREE.ShapeGeometry([north, south], 1)
  g.rotateX(-Math.PI / 2)
  return g
}

// 물결 텍스처: 옅은 가로 줄무늬를 흘려 보낸다
let rippleTex: THREE.Texture | null = null
function ripples() {
  if (rippleTex) return rippleTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 128, 128)
  const r = new Rng(17)
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(255,255,255,${r.range(0.4, 0.9)})`
    g.globalAlpha = 1
    g.fillStyle = r.chance(0.5) ? '#d6e6f2' : '#eef5fa'
    g.fillRect(r.range(0, 128), r.range(0, 128), r.range(8, 26), 1.5)
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  rippleTex = t
  return t
}

function strip(rv: RiverT, y: number, fn: (x: number) => [number, number]): THREE.BufferGeometry {
  // x를 따라 [z0, z1] 띠를 잇는 삼각형 띠 (UV: x는 길이, y는 폭)
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  let n = 0
  for (let x = -EXTENT; x <= EXTENT; x += STEP) {
    const [a, b] = fn(x)
    pos.push(x, y, a, x, y, b)
    uv.push(x / 40, 0, x / 40, (b - a) / 40)
    if (n > 0) {
      const i = n * 2
      idx.push(i - 2, i - 1, i, i - 1, i + 1, i)
    }
    n++
  }
  void rv
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

// 돌 둑: 강가 선을 따라 지면(0)에서 강바닥까지 세운 벽 (강 쪽을 바라보게)
function bankWall(rv: RiverT, s: -1 | 1): THREE.BufferGeometry {
  const pos: number[] = []
  const idx: number[] = []
  let n = 0
  for (let x = -EXTENT; x <= EXTENT; x += STEP) {
    const z = edge(rv, x, s)
    pos.push(x, 0, z, x, BED_Y, z)
    if (n > 0) {
      const i = n * 2
      // 북쪽 둑(s=-1)은 +z, 남쪽 둑은 -z를 바라본다
      if (s < 0) idx.push(i - 2, i, i - 1, i - 1, i, i + 1)
      else idx.push(i - 2, i - 1, i, i - 1, i + 1, i)
    }
    n++
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

const waterMat = new THREE.MeshStandardMaterial({ color: '#5E9DCB', roughness: 0.22, metalness: 0.08 })
const bankMat = new THREE.MeshStandardMaterial({ color: '#B8B3A6', roughness: 0.9 })
const bedMat = new THREE.MeshStandardMaterial({ color: '#3E6E86', roughness: 1 })

// 다리: 대로가 강을 건너는 구간에 상판·난간·교각 머리
function bridgeParts(rv: RiverT, site: Site): Part[] {
  const parts: Part[] = []
  for (const rd of cityPlan(site).roads) {
    if (rd.axis !== 'z') continue
    const hw = rd.w / 2 + SIDEWALK
    let z0 = Infinity
    let z1 = -Infinity
    for (const x of [rd.at - hw, rd.at, rd.at + hw]) {
      z0 = Math.min(z0, edge(rv, x, -1))
      z1 = Math.max(z1, edge(rv, x, 1))
    }
    z0 -= 1.5
    z1 += 1.5
    const len = z1 - z0
    const zc = (z0 + z1) / 2
    parts.push({ geo: box(hw * 2 + 0.6, 0.6, len), pos: [rd.at, -0.34, zc], color: '#C9CDD2' })
    // 상판 옆면 띠
    for (const s of [-1, 1]) {
      parts.push({ geo: box(0.3, 0.9, len), pos: [rd.at + s * (hw + 0.2), -0.25, zc], color: P.trim })
      // 난간: 기둥 + 위 손잡이
      for (let z = z0 + 0.5; z < z1; z += 2.2) parts.push({ geo: box(0.12, 1.05, 0.12), pos: [rd.at + s * (hw + 0.1), 0.52, z], color: '#46536B' })
      parts.push({ geo: box(0.14, 0.12, len), pos: [rd.at + s * (hw + 0.1), 1.05, zc], color: '#46536B' })
      // 양끝 둑 위 교대
      parts.push({ geo: box(hw * 2 + 1.2, 1.2, 1.4), pos: [rd.at, -0.9, s < 0 ? z0 + 0.4 : z1 - 0.4], color: '#A9A498' })
    }
  }
  return parts
}

// ── 배: 작은 유람선·모터보트·바지선. 강 가운데 선을 따라 오가며 끝에서 반대편으로 다시 들어온다 ──
interface Boat {
  kind: 0 | 1 | 2
  dir: 1 | -1
  lane: number
  speed: number
  x0: number
  color: string
}
const BOAT_COLORS = ['#F4F5F7', '#2F62E8', '#2B9A64', '#F4F5F7', '#1499AE', '#46536B']

function boatGeometry(kind: 0 | 1 | 2, color: string): THREE.BufferGeometry {
  // +z가 뱃머리. 다리 밑(상판 바닥 -0.64)을 지나가도록 수면 위 1.4 m 안으로
  const parts: Part[] = []
  const bow = (w: number, d: number, h: number, z: number, c: string) => {
    const g = new THREE.CylinderGeometry(0.01, w / 2, d, 3, 1)
    g.rotateX(Math.PI / 2)
    g.rotateZ(Math.PI)
    g.scale(1, h / w, 1)
    parts.push({ geo: g, pos: [0, h / 2, z], color: c })
  }
  if (kind === 0) {
    // 유람선: 긴 선체 + 긴 객실 + 지붕
    parts.push({ geo: box(3.2, 0.7, 11), pos: [0, 0.35, 0], color: '#F4F5F7' })
    bow(3.2, 2.4, 0.7, 6.7, '#F4F5F7')
    parts.push({ geo: box(3.24, 0.18, 11.1), pos: [0, 0.62, 0], color })
    parts.push({ geo: box(2.6, 0.55, 7.5), pos: [0, 0.97, -0.6], color: '#2E4A6B' })
    parts.push({ geo: box(2.8, 0.12, 7.9), pos: [0, 1.3, -0.6], color: '#F4F5F7' })
  } else if (kind === 1) {
    // 모터보트: 짧은 선체 + 앞유리
    parts.push({ geo: box(1.9, 0.55, 4.2), pos: [0, 0.28, 0], color })
    bow(1.9, 1.6, 0.55, 2.9, color)
    parts.push({ geo: box(1.6, 0.45, 0.12), pos: [0, 0.75, 0.6], color: '#2E4A6B' })
    parts.push({ geo: box(1.5, 0.3, 1.6), pos: [0, 0.65, -0.6], color: '#F4F5F7' })
  } else {
    // 바지선: 넓은 납작 선체 + 화물 컨테이너 + 뒤쪽 조타실
    parts.push({ geo: box(4.4, 0.8, 16), pos: [0, 0.4, 0], color: '#3A3F47' })
    parts.push({ geo: box(4.5, 0.15, 16.1), pos: [0, 0.82, 0], color })
    for (let k = 0; k < 3; k++) parts.push({ geo: box(2.3, 0.5, 4.4), pos: [k === 1 ? 0.9 : -0.9, 1.1, -3 + k * 4.6], color: ['#4B5D7A', '#2E8F5E', '#B9C2CC'][k] })
    parts.push({ geo: box(2.6, 0.5, 2), pos: [0, 1.1, -6.6], color: '#F4F5F7' })
  }
  return merged(`boat-${kind}-${color}`, () => parts)
}

function Boats({ rv, x0, x1, seed }: { rv: RiverT; x0: number; x1: number; seed: number }) {
  const refs = useRef<(THREE.Group | null)[]>([])
  const clock = useRef(0)
  const boats = useMemo(() => {
    const r = new Rng(seed)
    const n = 8
    return Array.from({ length: n }, (_, i): Boat => {
      const kind = (i % 3) as 0 | 1 | 2
      const dir = (i % 2 === 0 ? 1 : -1) as 1 | -1
      return { kind, dir, lane: dir * rv.half * r.range(0.25, 0.5), speed: kind === 1 ? r.range(5, 7) : kind === 0 ? r.range(2.5, 3.5) : r.range(1.6, 2.2), x0: r.range(x0, x1), color: r.pick(BOAT_COLORS) }
    })
  }, [rv, x0, x1, seed])
  const geos = useMemo(() => boats.map((b) => boatGeometry(b.kind, b.color)), [boats])
  const wake = useMemo(() => {
    const g = new THREE.PlaneGeometry(1, 1)
    g.rotateX(-Math.PI / 2)
    g.translate(0, 0, -0.5)
    return g
  }, [])

  useFrame((_, dt) => {
    // 시뮬레이션은 멈추지 않으므로 배도 늘 실제 시간으로 움직인다
    clock.current += Math.min(dt, 0.1)
    const span = x1 - x0
    boats.forEach((b, i) => {
      const g = refs.current[i]
      if (!g) return
      const x = x0 + ((((b.x0 - x0 + b.dir * b.speed * clock.current) % span) + span) % span)
      const slope = rv.amp * rv.k * Math.cos(rv.k * x + rv.ph)
      g.position.set(x, WATER_Y + 0.02 + Math.sin(clock.current * 1.7 + i) * 0.04, riverCenter(rv, x) + b.lane)
      g.rotation.set(0, Math.atan2(b.dir, b.dir * slope), Math.sin(clock.current * 1.3 + i * 2) * 0.03)
    })
  })

  return (
    <group>
      {boats.map((b, i) => (
        <group key={i} ref={(el) => (refs.current[i] = el)}>
          <mesh geometry={geos[i]} material={vcMat} castShadow />
          {/* 뒤로 끌리는 흰 물살 */}
          <mesh geometry={wake} material={wakeMat} position={[0, 0.03, b.kind === 2 ? -8 : b.kind === 0 ? -5.5 : -2.1]} scale={[b.kind === 2 ? 4 : 2.6, 1, b.kind === 1 ? 9 : 6]} />
        </group>
      ))}
    </group>
  )
}
const wakeMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false })

export function River({ site }: { site: Site }) {
  const plan = cityPlan(site)
  const rv = plan.river
  const key = site.cfg.id
  const geo = useMemo(() => {
    if (!rv) return null
    const water = strip(rv, WATER_Y, (x) => [edge(rv, x, -1), edge(rv, x, 1)])
    const bed = strip(rv, BED_Y, (x) => [edge(rv, x, -1), edge(rv, x, 1)])
    return { water, bed, north: bankWall(rv, -1), south: bankWall(rv, 1) }
  }, [rv])
  const tex = useMemo(() => {
    const t = ripples().clone()
    t.needsUpdate = true
    t.repeat.set(1, 1)
    return t
  }, [])
  const mat = useMemo(() => {
    const m = waterMat.clone()
    m.map = tex
    return m
  }, [tex])
  useFrame((_, dt) => {
    // 동쪽으로 흐르는 물결
    tex.offset.x -= Math.min(dt, 0.1) * 0.012
  })
  if (!rv || !geo) return null
  const bridges = merged(`bridges-${key}`, () => bridgeParts(rv, site))
  const B = plan.bounds
  return (
    <group>
      <mesh geometry={geo.bed} material={bedMat} />
      <mesh geometry={geo.water} material={mat} receiveShadow />
      <mesh geometry={geo.north} material={bankMat} receiveShadow />
      <mesh geometry={geo.south} material={bankMat} receiveShadow />
      <mesh geometry={bridges} material={vcMat} castShadow receiveShadow />
      <Boats rv={rv} x0={B.x0 - 150} x1={B.x1 + 150} seed={site.cfg.seed + 77} />
    </group>
  )
}
