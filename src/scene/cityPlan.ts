// 캠퍼스 바깥 도시 계획 — 격자 도로, 구역(물류·상업·주거·공원·주차), 필지와 건물을 시드 고정으로 만든다
// 순수 데이터만 만들고 그리기는 City.tsx / Surroundings.tsx가 맡는다
import type { Site } from '../sim/engine'
import { Rng } from '../sim/rng'

export interface Road {
  axis: 'x' | 'z' // x: 동서로 뻗음(z 고정), z: 남북으로 뻗음(x 고정)
  at: number // 고정 좌표 (도로 중심)
  from: number
  to: number
  w: number // 차도 폭
  major: boolean // 대로 (노란 중앙선)
}

export type Facade = 'punch' | 'ribbon' | 'plain' | 'curtain'
// 특수 건물: 그리기에서 지붕·부속을 따로 붙인다
export type BKind = 'house' | 'tower' | 'hotel' | 'mall' | 'parkade' | 'school' | 'hospital' | 'church' | 'factory' | 'gas' | 'stadium' | 'tank'
export interface Bldg {
  x: number
  z: number
  w: number // x 방향 길이 (회전 전)
  d: number // z 방향 길이
  h: number
  rot: number
  facade: Facade
  color: string
  roof: string
  accent?: string // 아파트 상단 띠·측벽 색
  shop?: string // 1층 상가 차양 색
  docks?: boolean // 물류창고 하역문
  kind?: BKind
  tiers?: { w: number; d: number; h: number }[] // 위로 올라가며 들여 쌓는 층 (h = 그 층 꼭대기 높이)
}

export type Zone = 'industrial' | 'commercial' | 'residential' | 'park' | 'parking' | 'civic' | 'houses' | 'riverside'
export interface Block {
  x0: number
  x1: number
  z0: number
  z1: number
  zone: Zone
  near: boolean // 캠퍼스와 맞닿은 블록 (낮게)
}

// 블록 안 포장면: 골목(alley), 단지 안 길(path), 창고 앞마당(apron)
export interface Paving {
  x0: number
  x1: number
  z0: number
  z1: number
  kind: 'alley' | 'path' | 'apron'
}

// 강: 동서로 흐르는 띠. 가운데 선이 사인파로 굽이친다 (x 범위 밖으로도 이어짐)
export interface River {
  zc: number
  half: number // 수면 반폭
  amp: number
  k: number
  ph: number
}
export const riverCenter = (rv: River, x: number) => rv.zc + rv.amp * Math.sin(rv.k * x + rv.ph)
// 강둑 안쪽(수면 + margin)인지
export const inRiver = (rv: River | null, x: number, z: number, margin = 0) => !!rv && Math.abs(z - riverCenter(rv, x)) < rv.half + margin

export interface CityPlan {
  river: River | null
  roads: Road[]
  blocks: Block[]
  paving: Paving[]
  bldgs: Bldg[]
  trees: { x: number; z: number; s: number; cone: boolean }[]
  parked: { x: number; z: number; rot: number; color: string }[]
  // 주행 차로: 시작점에서 방향으로 len 만큼
  lanes: { x: number; z: number; dx: number; dz: number; len: number }[]
  lights: { x: number; z: number; rot: number }[] // 가로등 (rot = 팔 방향)
  signals: { x: number; z: number }[] // 교차로 신호등
  bounds: { x0: number; x1: number; z0: number; z1: number }
}

const SIDEWALK = 2.6
export const MAIN_Z0 = 30.4 // 캠퍼스 앞 트럭 도로
export const MAIN_Z1 = 43.2

const APT_COLORS = ['#F4F2EC', '#EEF0F2', '#F3EEE4', '#E9EDF1', '#F6F4EF']
const APT_ACCENTS = ['#2F62E8', '#2B9A64', '#1499AE', '#6F4BC9', '#E08A2E', '#46536B']
// 유리 띠 텍스처에 곱해지는 색이라 밝게 둔다 (진하면 멀리서 무거운 파랑 덩어리가 된다)
const OFFICE_COLORS = ['#E3E9EF', '#DCE6E3', '#E6E8EC', '#D6E0EA', '#ECEFF2', '#DFE4DC']
const MIXED_COLORS = ['#E9E2D6', '#DCD6CC', '#E6E8EA', '#D9CFC2', '#EDE6DA', '#CFD6DC']
const AWNINGS = ['#1499AE', '#2B9A64', '#2F62E8', '#E7D7A8', '#6F4BC9', '#F2F2EE', '#46536B']
const WAREHOUSE = ['#E4E7EB', '#D7DCE2', '#E9E6DF', '#CED6DE']
const WAREHOUSE_ROOF = ['#7F8C9C', '#8E9AA6', '#6D8B7B', '#7C8796', '#A0A8B2']
const ROOF = ['#7C8590', '#8B939C', '#6E7781', '#9AA2AB']
const TOWER_COLORS = ['#E9EDF2', '#DDE5EC', '#F0EEE9', '#E4E9E4', '#D9DEE6']
const CURTAIN_COLORS = ['#D8E4EE', '#CFE0E4', '#E2E7EE', '#D3DCE8', '#DCE6E0']
const VILLA_COLORS = ['#D9B79A', '#E2CDB6', '#CDB49E', '#E8DCCB', '#C9A88C', '#DED6CB']
const HOUSE_COLORS = ['#F3EFE6', '#EDE7DA', '#E9EEF0', '#F1E6D6', '#E6EBE2', '#F4F1EA']
const GABLE_ROOFS = ['#5B6B7A', '#6E5A4C', '#4F6E5E', '#7B828A', '#8A6A55', '#46536B']
const FACTORY_COLORS = ['#D5D9DD', '#CBD2D8', '#DCD8CF', '#C7CFC9']
export const CITY_CARS = ['#F4F5F7', '#24272C', '#B8BEC6', '#2F62E8', '#7C8590', '#F4F5F7', '#2B9A64', '#46536B', '#24272C', '#D8DCE1']

const cache = new Map<string, CityPlan>()

export function cityPlan(site: Site): CityPlan {
  const hit = cache.get(site.cfg.id)
  if (hit) return hit
  const plan = build(site)
  cache.set(site.cfg.id, plan)
  return plan
}

function build(site: Site): CityPlan {
  const Lg = site.layout
  const C = Lg.campus
  const r = new Rng(site.cfg.seed * 31 + 7)
  const X0 = C.x0 - 300
  const X1 = C.x1 + 300
  const Z0 = C.z0 - 290
  const Z1 = MAIN_Z1 + 270

  // ── 도로: 캠퍼스를 감싸는 대로에서 바깥으로 블록 폭을 조금씩 달리해 반복 ──
  const avenues: number[] = []
  for (let x = C.x0 - 14; x > X0 + 20; x -= r.range(68, 92)) avenues.push(x)
  for (let x = C.x1 + 14; x < X1 - 20; x += r.range(68, 92)) avenues.push(x)
  avenues.sort((a, b) => a - b)
  const streets: number[] = []
  for (let z = C.z0 - 14; z > Z0 + 20; z -= r.range(62, 84)) streets.push(z)
  for (let z = MAIN_Z1 + 18; z < Z1 - 20; z += r.range(64, 82)) streets.push(z)
  streets.sort((a, b) => a - b)
  const roads: Road[] = [
    ...avenues.map((x, i) => ({ axis: 'z' as const, at: x, from: Z0, to: Z1, w: i % 2 === 0 ? 12 : 10, major: i % 2 === 0 })),
    ...streets.map((z) => ({ axis: 'x' as const, at: z, from: X0, to: X1, w: 10, major: false })),
  ]

  // ── 강: 캠퍼스 바로 북쪽 블록 줄을 강으로 바꾼다 (기본 시점에서 창고 뒤로 강이 가로질러 보이게) ──
  const north = streets.filter((z) => z < C.z0).sort((a, b) => b - a)
  let river: River | null = null
  if (north.length >= 1) {
    const zs = north[0] - 5 - SIDEWALK
    const zn = north[1] !== undefined ? north[1] + 5 + SIDEWALK : Z0
    const room = zs - zn
    const half = Math.min(15, room / 2 - 12)
    if (half > 7) river = { zc: (zs + zn) / 2, half, amp: Math.max(0, Math.min(6, room / 2 - half - 9)), k: (2 * Math.PI) / r.range(220, 320), ph: r.range(0, Math.PI * 2) }
  }
  const riverRow = (z0: number, z1: number) => !!river && z0 < river.zc && z1 > river.zc
  const half = (x: number) => (roads.find((rd) => rd.axis === 'z' && rd.at === x)?.w ?? 0) / 2
  const halfZ = (z: number) => (roads.find((rd) => rd.axis === 'x' && rd.at === z)?.w ?? 0) / 2

  // ── 블록: 도로 사이 칸. 동서 방향은 주 도로(트럭 도로)도 경계로 쓴다 ──
  const xs = [X0, ...avenues, X1]
  const zLines: { z: number; hw: number }[] = [{ z: Z0, hw: 0 }, ...streets.filter((z) => z < MAIN_Z0).map((z) => ({ z, hw: halfZ(z) })), { z: (MAIN_Z0 + MAIN_Z1) / 2, hw: (MAIN_Z1 - MAIN_Z0) / 2 }, ...streets.filter((z) => z > MAIN_Z1).map((z) => ({ z, hw: halfZ(z) })), { z: Z1, hw: 0 }]
  const blocks: Block[] = []
  const campusX0 = C.x0 - 14
  const campusX1 = C.x1 + 14
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < zLines.length - 1; j++) {
      const ax = xs[i]
      const bx = xs[i + 1]
      const x0 = ax + (i === 0 ? 0 : half(ax) + SIDEWALK)
      const x1 = bx - (i + 1 === xs.length - 1 ? 0 : half(bx) + SIDEWALK)
      const z0 = zLines[j].z + (j === 0 ? 0 : zLines[j].hw + SIDEWALK)
      const z1 = zLines[j + 1].z - (j + 1 === zLines.length - 1 ? 0 : zLines[j + 1].hw + SIDEWALK)
      if (x1 - x0 < 16 || z1 - z0 < 16) continue
      // 캠퍼스 자리
      if (ax >= campusX0 - 1 && bx <= campusX1 + 1 && z0 >= C.z0 - 20 && z1 <= MAIN_Z0 + 1) continue
      const cx = (x0 + x1) / 2
      const cz = (z0 + z1) / 2
      const near = Math.max(x0 - C.x1, C.x0 - x1, z0 - MAIN_Z1, C.z0 - z1) < 40
      let zone: Zone
      const centre = near || Math.abs(cx - (C.x0 + C.x1) / 2) < 120
      if (riverRow(z0, z1)) zone = 'riverside'
      else if (cz > MAIN_Z1) zone = r.chance(0.1) ? 'park' : 'industrial'
      else if (r.chance(0.1)) zone = 'park'
      else if (r.chance(0.06)) zone = 'parking'
      else if (r.chance(0.09)) zone = 'civic'
      else if (!centre && r.chance(0.18)) zone = 'houses'
      else if (centre) zone = r.chance(0.72) ? 'commercial' : 'residential'
      else zone = r.chance(0.65) ? 'residential' : 'commercial'
      blocks.push({ x0, x1, z0, z1, zone, near })
    }

  const bldgs: Bldg[] = []
  const trees: CityPlan['trees'] = []
  const parked: CityPlan['parked'] = []
  const paving: Paving[] = []
  // 카메라는 남동쪽(+x, +z) 위에서 내려다본다 → 카메라 쪽 가까운 블록은 낮게
  const camSide = (b: Block) => b.x0 > C.x1 && b.z1 > C.z0 + 20
  let stadium = false
  for (const b of blocks) {
    const w = b.x1 - b.x0
    const d = b.z1 - b.z0
    const low = camSide(b)
    if (b.zone === 'riverside') {
      // 강변: 양쪽 둑 위 산책로 + 가로수. 수면은 River가 그린다
      const rv = river!
      const top = rv.zc - rv.half - rv.amp - 2
      const bot = rv.zc + rv.half + rv.amp + 2
      if (top - 4 > b.z0) paving.push({ x0: b.x0, x1: b.x1, z0: top - 4, z1: top, kind: 'path' })
      if (bot + 4 < b.z1) paving.push({ x0: b.x0, x1: b.x1, z0: bot, z1: bot + 4, kind: 'path' })
      for (let x = b.x0 + 4; x < b.x1 - 4; x += r.range(8, 12)) {
        if (top - 6 > b.z0 + 1) trees.push({ x, z: top - 6, s: r.range(0.8, 1.15), cone: false })
        if (bot + 6 < b.z1 - 1) trees.push({ x: x + 3, z: bot + 6, s: r.range(0.8, 1.15), cone: false })
      }
      continue
    }
    if (b.zone === 'park') {
      // 큰 공원 하나는 경기장
      if (!stadium && !low && w > 70 && d > 55) {
        stadium = true
        bldgs.push({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, w: Math.min(w - 10, 92), d: Math.min(d - 10, 66), h: 13, rot: 0, facade: 'plain', color: '#E6E8EA', roof: '#C9CED6', kind: 'stadium' })
        continue
      }
      const n = Math.floor((w * d) / 140)
      for (let k = 0; k < n; k++) trees.push({ x: r.range(b.x0 + 3, b.x1 - 3), z: r.range(b.z0 + 3, b.z1 - 3), s: r.range(0.9, 1.5), cone: r.chance(0.3) })
      // 공원을 가로지르는 산책로
      const cz = r.range(b.z0 + d * 0.3, b.z1 - d * 0.3)
      paving.push({ x0: b.x0, x1: b.x1, z0: cz - 1.5, z1: cz + 1.5, kind: 'path' })
      continue
    }
    if (b.zone === 'parking') {
      for (let z = b.z0 + 4; z < b.z1 - 3; z += 6.5)
        for (let x = b.x0 + 3; x < b.x1 - 3; x += 2.8) if (r.chance(0.6)) parked.push({ x, z, rot: 0, color: r.pick(CITY_CARS) })
      continue
    }
    if (b.zone === 'industrial') {
      // 물류창고·공장·저장탱크 기지를 섞고, 블록 모서리에 주유소
      const n = w > 110 ? 3 : w > 60 ? 2 : 1
      const lotW = w / n
      for (let k = 0; k < n; k++) {
        const lx0 = b.x0 + k * lotW
        const sw = r.range(5, 9)
        const bw = lotW - sw * 2
        const bd = Math.min(d - 18, r.range(38, 70))
        if (bw < 12 || bd < 12) continue
        const bz = b.z0 + 6 + bd / 2 + r.range(0, Math.max(0, d - 18 - bd))
        const u = r.next()
        if (k === 0 && u < 0.14 && lotW > 30) {
          bldgs.push({ x: lx0 + 16, z: b.z0 + 14, w: 22, d: 16, h: 5.2, rot: 0, facade: 'plain', color: '#F2F3F5', roof: '#2F62E8', kind: 'gas' })
          paving.push({ x0: lx0, x1: lx0 + 34, z0: b.z0, z1: b.z0 + 26, kind: 'apron' })
          continue
        }
        if (u < 0.42) {
          // 공장: 톱니 지붕 + 굴뚝, 옆에 원통 사일로
          bldgs.push({ x: lx0 + lotW / 2, z: bz, w: bw, d: bd, h: r.range(10, 15), rot: 0, facade: 'plain', color: r.pick(FACTORY_COLORS), roof: r.pick(WAREHOUSE_ROOF), kind: 'factory' })
          paving.push({ x0: lx0 + sw - 2, x1: lx0 + lotW - sw + 2, z0: bz + bd / 2, z1: b.z1, kind: 'apron' })
          continue
        }
        if (u < 0.52 && bw > 26) {
          // 저장탱크 기지
          const nt = Math.max(2, Math.floor(bw / 16))
          for (let t = 0; t < nt; t++) bldgs.push({ x: lx0 + sw + 8 + t * ((bw - 16) / Math.max(1, nt - 1)), z: bz, w: 14, d: 14, h: r.range(9, 14), rot: 0, facade: 'plain', color: '#E9ECEF', roof: '#B9C0C8', kind: 'tank' })
          paving.push({ x0: lx0 + sw - 2, x1: lx0 + lotW - sw + 2, z0: bz - 10, z1: bz + 10, kind: 'apron' })
          continue
        }
        // 하역문 앞마당은 남쪽 도로까지 이어진다
        paving.push({ x0: lx0 + sw - 2, x1: lx0 + lotW - sw + 2, z0: bz + bd / 2, z1: b.z1, kind: 'apron' })
        bldgs.push({ x: lx0 + lotW / 2, z: bz, w: bw, d: bd, h: r.range(9, 14), rot: 0, facade: 'plain', color: r.pick(WAREHOUSE), roof: r.pick(WAREHOUSE_ROOF), docks: true })
        if (r.chance(0.6)) bldgs.push({ x: lx0 + sw + 5, z: b.z0 + 5, w: 10, d: 7, h: r.range(7, 11), rot: 0, facade: 'ribbon', color: r.pick(OFFICE_COLORS), roof: r.pick(ROOF) })
        // 앞마당 트럭 주차
        for (let t = 0; t < r.int(0, 4); t++) parked.push({ x: lx0 + sw + 4 + t * 5, z: bz + bd / 2 + 6, rot: Math.PI / 2, color: r.pick(['#F4F5F7', '#2F62E8', '#2B9A64', '#46536B']) })
      }
      continue
    }
    if (b.zone === 'houses') {
      // 단독주택 마을: 가운데 골목을 따라 박공지붕 집이 양쪽으로
      const cz = (b.z0 + b.z1) / 2
      paving.push({ x0: b.x0, x1: b.x1, z0: cz - 2.5, z1: cz + 2.5, kind: 'alley' })
      for (const side of [-1, 1]) {
        let x = b.x0 + 4
        while (x < b.x1 - 12) {
          const hw = r.range(8, 12)
          const hd = Math.min(r.range(8, 11), d / 2 - 8)
          if (hd < 6) break
          const hz = cz + side * (2.5 + 3 + hd / 2)
          bldgs.push({ x: x + hw / 2, z: hz, w: hw, d: hd, h: r.int(1, 2) * 3, rot: 0, facade: 'punch', color: r.pick(HOUSE_COLORS), roof: r.pick(GABLE_ROOFS), kind: 'house' })
          if (r.chance(0.5)) trees.push({ x: x + hw / 2, z: hz + side * (hd / 2 + 3), s: r.range(0.6, 0.9), cone: r.chance(0.3) })
          if (r.chance(0.3)) parked.push({ x: x + hw + 2, z: cz + side * 4.3, rot: 0, color: r.pick(CITY_CARS) })
          x += hw + r.range(4, 7)
        }
      }
      continue
    }
    if (b.zone === 'civic') {
      const u = r.next()
      const cx = (b.x0 + b.x1) / 2
      const cz = (b.z0 + b.z1) / 2
      if (u < 0.45 && w > 60 && d > 45) {
        // 학교: ㄱ자 교사 + 운동장 트랙
        const fw = Math.min(w * 0.55, 60)
        bldgs.push({ x: b.x0 + 4 + fw / 2, z: cz, w: fw, d: Math.min(d - 16, 40), h: 1, rot: 0, facade: 'plain', color: '#B98E6E', roof: '#5AA35C', kind: 'school' })
        const bw = w - fw - 12
        bldgs.push({ x: b.x1 - 4 - bw / 2, z: b.z0 + 10, w: bw, d: 14, h: (low ? 3 : 4) * 3.4, rot: 0, facade: 'punch', color: '#F1ECE2', roof: '#8B939C', accent: '#2B9A64' })
        bldgs.push({ x: b.x1 - 11, z: b.z0 + 32, w: 14, d: Math.min(26, d - 40), h: (low ? 3 : 4) * 3.4, rot: 0, facade: 'punch', color: '#F1ECE2', roof: '#8B939C' })
      } else if (u < 0.75) {
        // 병원: 저층 진료동 + 병동 타워 + 옥상 헬기장
        const fw = Math.min(w - 12, 54)
        const fd = Math.min(d - 12, 36)
        const floors = low ? 5 : b.near ? 9 : r.int(10, 15)
        bldgs.push({ x: cx, z: cz, w: fw, d: fd, h: floors * 3.6, rot: 0, facade: 'punch', color: '#F5F6F7', roof: '#9AA2AB', accent: '#1499AE', kind: 'hospital', tiers: [{ w: fw, d: fd, h: 7.2 }, { w: fw * 0.55, d: fd * 0.75, h: floors * 3.6 }] })
        for (let x = b.x0 + 4; x < b.x1 - 4; x += 2.8) if (r.chance(0.5)) parked.push({ x, z: b.z1 - 4, rot: 0, color: r.pick(CITY_CARS) })
      } else {
        // 교회 + 주변 주택
        bldgs.push({ x: cx, z: cz, w: 14, d: 26, h: 9, rot: 0, facade: 'plain', color: '#F2EEE6', roof: '#5B6B7A', kind: 'church' })
        for (let k = 0; k < 6; k++) {
          const hx = r.chance(0.5) ? r.range(b.x0 + 8, cx - 14) : r.range(cx + 14, b.x1 - 8)
          const hz = r.range(b.z0 + 8, b.z1 - 8)
          bldgs.push({ x: hx, z: hz, w: 9, d: 8, h: 6, rot: 0, facade: 'punch', color: r.pick(HOUSE_COLORS), roof: r.pick(GABLE_ROOFS), kind: 'house' })
        }
        for (let k = 0; k < 10; k++) trees.push({ x: r.range(b.x0 + 3, b.x1 - 3), z: r.range(b.z0 + 3, b.z1 - 3), s: r.range(0.8, 1.2), cone: true })
      }
      continue
    }
    if (b.zone === 'residential') {
      const style = r.next()
      if (style < 0.28 && !low) {
        // 탑상형 고층 아파트: 정사각에 가까운 동을 격자로
        const gx = Math.max(1, Math.floor((w - 12) / 34))
        const gz = Math.max(1, Math.floor((d - 12) / 34))
        for (let i = 0; i < gx; i++)
          for (let j = 0; j < gz; j++) {
            const x = b.x0 + 6 + (i + 0.5) * ((w - 12) / gx)
            const z = b.z0 + 6 + (j + 0.5) * ((d - 12) / gz)
            const s0 = r.range(17, 22)
            const floors = b.near ? r.int(12, 18) : r.int(24, 38)
            bldgs.push({ x, z, w: s0, d: s0 * r.range(0.9, 1.1), h: floors * 2.9, rot: r.chance(0.3) ? Math.PI / 4 : 0, facade: 'punch', color: r.pick(TOWER_COLORS), roof: '#8B939C', accent: r.pick(APT_ACCENTS), kind: 'tower' })
            trees.push({ x: x + s0 * 0.9, z: z + s0 * 0.9, s: r.range(0.9, 1.3), cone: false })
          }
        paving.push({ x0: b.x0 + 1, x1: b.x0 + 4.5, z0: b.z0, z1: b.z1, kind: 'path' })
        continue
      }
      if (style < 0.45) {
        // 빌라촌: 4~5층 다세대가 촘촘히
        let z = b.z0 + 4
        while (z < b.z1 - 14) {
          const vd = r.range(10, 14)
          let x = b.x0 + 4
          while (x < b.x1 - 12) {
            const vw = r.range(11, 16)
            bldgs.push({ x: x + vw / 2, z: z + vd / 2, w: vw, d: vd, h: r.int(4, 5) * 2.8, rot: 0, facade: 'punch', color: r.pick(VILLA_COLORS), roof: r.pick(ROOF) })
            x += vw + r.range(2.5, 4)
          }
          paving.push({ x0: b.x0, x1: b.x1, z0: z + vd + 1, z1: z + vd + 5, kind: 'alley' })
          for (let px = b.x0 + 6; px < b.x1 - 6; px += 5) if (r.chance(0.3)) parked.push({ x: px, z: z + vd + 2.5, rot: Math.PI / 2, color: r.pick(CITY_CARS) })
          z += vd + 6
        }
        continue
      }
      // 아파트 단지: 동서로 긴 판상형 동을 남북으로 줄지어, 사이에 조경
      const slabD = 13
      const gap = r.range(26, 36)
      // 단지 안 길: 한쪽 가장자리 세로길 + 동마다 남쪽 앞길(주차)
      const west = r.chance(0.5)
      paving.push({ x0: west ? b.x0 + 1 : b.x1 - 4.5, x1: west ? b.x0 + 4.5 : b.x1 - 1, z0: b.z0, z1: b.z1, kind: 'path' })
      let z = b.z0 + 8 + slabD / 2
      while (z + slabD / 2 < b.z1 - 6) {
        let x = b.x0 + 6
        while (x < b.x1 - 20) {
          const sw = Math.min(r.range(36, 58), b.x1 - 6 - x)
          if (sw < 18) break
          const floors = low ? r.int(5, 8) : b.near ? r.int(8, 13) : r.int(13, 25)
          bldgs.push({ x: x + sw / 2, z: z + r.range(-2, 2), w: sw, d: slabD, h: floors * 2.9, rot: r.chance(0.2) ? r.range(-0.12, 0.12) : 0, facade: 'punch', color: r.pick(APT_COLORS), roof: '#8B939C', accent: r.pick(APT_ACCENTS) })
          x += sw + r.range(10, 18)
        }
        const pz0 = z + slabD / 2 + 5.5
        if (pz0 + 4 < b.z1 - 1) {
          paving.push({ x0: b.x0 + 1, x1: b.x1 - 1, z0: pz0, z1: pz0 + 4, kind: 'path' })
          for (let px = b.x0 + 8; px < b.x1 - 8; px += 5) if (r.chance(0.35)) parked.push({ x: px, z: pz0 + 3, rot: Math.PI / 2, color: r.pick(CITY_CARS) })
        }
        for (let tx = b.x0 + 6; tx < b.x1 - 6; tx += r.range(7, 12)) trees.push({ x: tx, z: z + slabD / 2 + gap / 2 + r.range(-3, 3), s: r.range(0.8, 1.2), cone: r.chance(0.2) })
        z += slabD + gap
      }
      continue
    }
    // 상업: 큰 블록은 가끔 쇼핑몰 하나가 통째로 차지
    if (w > 70 && d > 50 && r.chance(0.16)) {
      const mw = Math.min(w - 16, 84)
      const md = Math.min(d - 22, 46)
      bldgs.push({ x: (b.x0 + b.x1) / 2, z: b.z0 + 6 + md / 2, w: mw, d: md, h: low ? 10 : 15, rot: 0, facade: 'plain', color: r.pick(['#EEF0F2', '#E9E4DA', '#E3E8EE']), roof: '#9AA2AB', accent: r.pick(AWNINGS), kind: 'mall' })
      const pz = b.z0 + 6 + md + 3
      paving.push({ x0: b.x0 + 4, x1: b.x1 - 4, z0: pz, z1: b.z1 - 2, kind: 'apron' })
      for (let z = pz + 3; z < b.z1 - 4; z += 6.5) for (let x = b.x0 + 7; x < b.x1 - 7; x += 2.8) if (r.chance(0.55)) parked.push({ x, z, rot: 0, color: r.pick(CITY_CARS) })
      continue
    }
    // 긴 변을 따라 필지를 나누고, 사무동·유리 타워·호텔·주차빌딩·상가 건물을 섞는다
    const alongX = w >= d
    const len = alongX ? w : d
    const short = alongX ? d : w
    // 블록이 두꺼우면 가운데로 뒷골목을 내고 건물은 양쪽 도로를 본다
    const alley = short >= 44
    const maxDepth = alley ? (short - 6) / 2 : short
    if (alley) {
      const cx = (b.x0 + b.x1) / 2
      const cz = (b.z0 + b.z1) / 2
      paving.push(alongX ? { x0: b.x0, x1: b.x1, z0: cz - 2.5, z1: cz + 2.5, kind: 'alley' } : { x0: cx - 2.5, x1: cx + 2.5, z0: b.z0, z1: b.z1, kind: 'alley' })
    }
    let p = 0
    while (p < len - 12) {
      const lot = Math.min(r.range(18, 38), len - p)
      if (lot < 12) break
      const depth = Math.min(maxDepth, r.range(16, 34))
      const set = r.range(2, 5)
      const fw = lot - set * 2
      const fd = depth - set * 2
      // 블록 양쪽 도로를 보도록 앞뒤로 번갈아 배치
      const front = r.chance(0.5)
      const cxL = alongX ? b.x0 + p + lot / 2 : front ? b.x0 + depth / 2 : b.x1 - depth / 2
      const czL = alongX ? (front ? b.z0 + depth / 2 : b.z1 - depth / 2) : b.z0 + p + lot / 2
      const W = alongX ? fw : fd
      const D = alongX ? fd : fw
      const u = r.next()
      const tall = !low && !b.near && Math.min(W, D) > 16
      if (tall && u < 0.16) {
        // 유리 커튼월 타워: 저층부 위로 두 번 들여 쌓기
        const floors = r.int(18, 34)
        const H = floors * 3.8
        bldgs.push({ x: cxL, z: czL, w: W, d: D, h: H, rot: 0, facade: 'curtain', color: r.pick(CURTAIN_COLORS), roof: '#7C8590', kind: 'tower', tiers: [{ w: W, d: D, h: 4 * 3.8 }, { w: W * 0.8, d: D * 0.8, h: H * 0.72 }, { w: W * 0.62, d: D * 0.62, h: H }] })
      } else if (tall && u < 0.24) {
        // 호텔: 넓은 저층부 + 좁은 타워 + 꼭대기 왕관
        const floors = r.int(14, 24)
        const H = floors * 3.3
        bldgs.push({ x: cxL, z: czL, w: W, d: D, h: H, rot: 0, facade: 'punch', color: r.pick(['#EDE4D6', '#E6E9EE', '#F0EBE3']), roof: '#6E7781', accent: r.pick(['#46536B', '#2B9A64', '#6F4BC9']), kind: 'hotel', tiers: [{ w: W, d: D, h: 9 }, { w: W * 0.7, d: D * 0.55, h: H }] })
      } else if (u < 0.31 && Math.min(W, D) > 14) {
        // 주차빌딩: 층마다 열린 바닥판
        bldgs.push({ x: cxL, z: czL, w: W, d: D, h: (low ? 3 : r.int(4, 6)) * 3, rot: 0, facade: 'plain', color: '#CDD2D8', roof: '#B7BDC5', kind: 'parkade' })
      } else {
        const office = u < 0.62
        const floors = low ? r.int(2, 5) : b.near ? (office ? r.int(4, 8) : r.int(3, 6)) : office ? r.int(6, 16) : r.int(3, 8)
        bldgs.push({
          x: cxL,
          z: czL,
          w: W,
          d: D,
          h: floors * (office ? 3.6 : 3.2),
          rot: r.chance(0.12) ? r.range(-0.15, 0.15) : 0,
          facade: office ? 'ribbon' : 'punch',
          color: office ? r.pick(OFFICE_COLORS) : r.pick(MIXED_COLORS),
          roof: r.pick(ROOF),
          shop: office ? undefined : r.pick(AWNINGS),
        })
      }
      // 반대편 빈 자리에 주차·나무
      const ex = alongX ? cxL : front ? b.x1 - 6 : b.x0 + 6
      const ez = alongX ? (front ? b.z1 - 6 : b.z0 + 6) : czL
      if (r.chance(0.5)) parked.push({ x: ex, z: ez, rot: alongX ? 0 : Math.PI / 2, color: r.pick(CITY_CARS) })
      else trees.push({ x: ex, z: ez, s: r.range(0.8, 1.2), cone: false })
      // 가끔 필지 사이로 도로와 뒷골목을 잇는 샛길
      if (alley && r.chance(0.25) && p + lot + 6 < len - 12) {
        const a = (alongX ? b.x0 : b.z0) + p + lot + 0.5
        paving.push(alongX ? { x0: a, x1: a + 5, z0: b.z0, z1: b.z1, kind: 'alley' } : { x0: b.x0, x1: b.x1, z0: a, z1: a + 5, kind: 'alley' })
        p += lot + 6
      } else p += lot + r.range(0, 4)
    }
  }

  // ── 가로수·가로등·신호등·주행 차로 ──
  const lights: CityPlan['lights'] = []
  const signals: CityPlan['signals'] = []
  const lanes: CityPlan['lanes'] = []
  const crosses = (rd: Road) => (rd.axis === 'z' ? streets.concat([(MAIN_Z0 + MAIN_Z1) / 2]) : avenues)
  const inCampus = (x: number, z: number) => x > C.x0 - 8 && x < C.x1 + 8 && z > C.z0 - 8 && z < MAIN_Z1 + 6
  for (const rd of roads) {
    const off = rd.w / 2 + SIDEWALK - 0.9
    const xs2 = crosses(rd)
    const nearCross = (t: number) => xs2.some((c) => Math.abs(c - t) < 10)
    let k = 0
    for (let t = rd.from + 6; t < rd.to - 6; t += 11, k++) {
      if (nearCross(t)) continue
      for (const s of [-1, 1]) {
        const x = rd.axis === 'z' ? rd.at + s * off : t
        const z = rd.axis === 'z' ? t : rd.at + s * off
        if (inCampus(x, z) || inRiver(river, x, z, 2)) continue
        if (k % 3 === 1 && s === 1) lights.push({ x, z, rot: rd.axis === 'z' ? (s > 0 ? -Math.PI / 2 : Math.PI / 2) : s > 0 ? Math.PI : 0 })
        else trees.push({ x, z, s: r.range(0.7, 0.95), cone: false })
      }
    }
    // 양방향 차로 (한 차로씩)
    const lo = rd.w / 4
    if (rd.axis === 'z') {
      lanes.push({ x: rd.at + lo, z: rd.from, dx: 0, dz: 1, len: rd.to - rd.from })
      lanes.push({ x: rd.at - lo, z: rd.to, dx: 0, dz: -1, len: rd.to - rd.from })
    } else {
      lanes.push({ x: rd.from, z: rd.at - lo, dx: 1, dz: 0, len: rd.to - rd.from })
      lanes.push({ x: rd.to, z: rd.at + lo, dx: -1, dz: 0, len: rd.to - rd.from })
    }
  }
  for (const x of avenues)
    for (const z of [...streets, (MAIN_Z0 + MAIN_Z1) / 2]) {
      const hw = half(x) + SIDEWALK - 0.6
      const hz = (z === (MAIN_Z0 + MAIN_Z1) / 2 ? (MAIN_Z1 - MAIN_Z0) / 2 : halfZ(z)) + SIDEWALK - 0.6
      signals.push({ x: x - hw, z: z - hz }, { x: x + hw, z: z + hz })
    }

  return { river, roads, blocks, paving, bldgs, trees, parked, lanes, lights, signals, bounds: { x0: X0, x1: X1, z0: Z0, z1: Z1 } }
}
