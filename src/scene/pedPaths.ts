// 보행자 길 그래프와 걸음 시뮬레이션 (순수 데이터, three 없이). 그리기는 Pedestrians.tsx가 맡는다
// 보도 중심선·단지 길·골목·공원 산책로를 직선(line)으로 모으고, 직선끼리 만나는 점을 노드로 삼는다.
// 보도 선은 교차하는 도로의 차도를 지나며 그대로 횡단보도가 된다 (차도 위 구간만 횡단 간선으로 표시)
import type { CityPlan } from './cityPlan'
import { Rng } from '../sim/rng'

const SIDEWALK = 2.6
const MAIN_Z0 = 30.4 // 캠퍼스 앞 트럭 도로 (횡단보도 없음)
const MAIN_Z1 = 43.2
const SIDE_OFF = SIDEWALK / 2 // 차도 끝에서 보도 중심까지

type Rect = { x0: number; x1: number; z0: number; z1: number }
type LKind = 'side' | 'path' | 'alley' | 'park'
// 간선 종류: 0 보도, 1 횡단보도, 2 단지 길, 3 골목, 4 공원
export const EK = { side: 0, cross: 1, path: 2, alley: 3, park: 4 } as const
const EDGE_W = [1, 0.45, 0.8, 0.5, 1] // 갈림길에서 고르는 가중치 (길을 건너는 일은 덜 잦게)
const EDGE_LANE = [1, 0.8, 0.45, 0.65, 0.55] // 양방향 비켜 걷는 폭 배율 (좁은 길은 좁게)
const HOME_R = [150, 150, 70, 80, 30] // 집에서 이만큼 멀어지면 돌아오는 쪽을 고른다
const ZONE_DENSITY: Record<string, number> = { commercial: 1.6, civic: 1.2, residential: 1, park: 0.9, riverside: 0.7, houses: 0.6, parking: 0.5, industrial: 0.3 }

interface Line {
  axis: 'x' | 'z' // x: 동서로 뻗음(z 고정), z: 남북으로 뻗음(x 고정)
  at: number
  from: number
  to: number
  kind: LKind
  st: number[] // 이 선 위의 노드
}

// 강은 아직 계획에 없을 수도 있어 모양만 보고 읽는다
interface RiverLike {
  zc: number
  half: number
  amp: number
  k: number
  ph: number
}
function riverOf(plan: CityPlan): RiverLike | null {
  const rv = (plan as unknown as { river?: unknown }).river as Partial<RiverLike> | null | undefined
  if (!rv || typeof rv.zc !== 'number' || typeof rv.half !== 'number') return null
  return { zc: rv.zc, half: rv.half, amp: rv.amp ?? 0, k: rv.k ?? 0, ph: rv.ph ?? 0 }
}
const inRiver = (rv: RiverLike | null, x: number, z: number, m: number) => !!rv && Math.abs(z - (rv.zc + rv.amp * Math.sin(rv.k * x + rv.ph))) < rv.half + m

export interface PedGraph {
  n: number
  x: Float32Array
  z: Float32Array
  // 인접 목록 (CSR): 노드 i의 이웃은 nb[start[i] .. start[i+1])
  start: Int32Array
  nb: Int32Array
  ek: Uint8Array
  // 출발 간선 (가중치 누적)
  spA: Int32Array
  spB: Int32Array
  spK: Uint8Array
  spCum: Float64Array
  // crowd = 1 기준 인원
  base: number
}

export function buildPedGraph(plan: CityPlan, campus: Rect): PedGraph {
  const rv = riverOf(plan)
  const lines: Line[] = []
  const inCampus = (x: number, z: number, pad = 0.5) => x > campus.x0 - pad && x < campus.x1 + pad && z > campus.z0 - pad && z < campus.z1 + pad

  // ── 보도: 도로 양쪽 중심선 ──
  for (const rd of plan.roads) {
    const hw = rd.w / 2
    for (const s of [-1, 1]) lines.push({ axis: rd.axis, at: rd.at + s * (hw + SIDE_OFF), from: rd.from, to: rd.to, kind: 'side', st: [] })
    // 트럭 도로와 만나는 남북 도로: 트럭 도로 양쪽에서 이 도로를 건너는 짧은 선 (모퉁이 노드도 여기서 생긴다)
    if (rd.axis === 'z' && rd.from < MAIN_Z0 && rd.to > MAIN_Z1)
      for (const z of [MAIN_Z0 - SIDE_OFF, MAIN_Z1 + SIDE_OFF]) lines.push({ axis: 'x', at: z, from: rd.at - hw - SIDE_OFF, to: rd.at + hw + SIDE_OFF, kind: 'side', st: [] })
  }
  const sides = lines.slice()

  // 블록 안 길은 끝을 가까운 보도 중심선까지 늘여 이어 붙인다
  const extend = (ln: Line) => {
    for (const end of [-1, 1]) {
      const t = end < 0 ? ln.from : ln.to
      let best = Infinity
      for (const sd of sides) {
        if (sd.axis === ln.axis) continue
        if (ln.at < sd.from || ln.at > sd.to) continue
        const d = (sd.at - t) * end
        if (d >= -0.01 && d < 4.5 && d < best) best = d
      }
      if (best < Infinity) {
        if (end < 0) ln.from -= best
        else ln.to += best
      }
    }
    lines.push(ln)
  }

  // ── 단지 길·골목: 포장면 긴 쪽 중심선. 단지 길은 주차 차량이 적은 쪽으로 붙는다 ──
  for (const pv of plan.paving) {
    if (pv.kind !== 'path' && pv.kind !== 'alley') continue
    const cx = (pv.x0 + pv.x1) / 2
    const cz = (pv.z0 + pv.z1) / 2
    if (inCampus(cx, cz, 2) || inRiver(rv, cx, cz, 1)) continue
    const alongX = pv.x1 - pv.x0 >= pv.z1 - pv.z0
    const wid = alongX ? pv.z1 - pv.z0 : pv.x1 - pv.x0
    const mid = alongX ? cz : cx
    let at = mid
    if (pv.kind === 'path' && wid > 2.4) {
      const q = wid / 2 - 0.9
      let bestN = Infinity
      for (const c of [mid, mid - q, mid + q]) {
        let n = 0
        for (const p of plan.parked) {
          const along = alongX ? p.x : p.z
          const perp = alongX ? p.z : p.x
          if (Math.abs(perp - c) < 1.6 && along > (alongX ? pv.x0 : pv.z0) - 2 && along < (alongX ? pv.x1 : pv.z1) + 2) n++
        }
        if (n < bestN) {
          bestN = n
          at = c
        }
      }
    }
    extend({ axis: alongX ? 'x' : 'z', at, from: alongX ? pv.x0 : pv.z0, to: alongX ? pv.x1 : pv.z1, kind: pv.kind, st: [] })
  }

  // ── 공원: 가장자리 순환로 + 가운데 십자 길 (보도와 이어짐) ──
  for (const b of plan.blocks) {
    if (b.zone !== 'park') continue
    const cx = (b.x0 + b.x1) / 2
    const cz = (b.z0 + b.z1) / 2
    if (inRiver(rv, cx, cz, 2) || inCampus(cx, cz, 2)) continue
    const w = b.x1 - b.x0
    const d = b.z1 - b.z0
    if (w > 24 && d > 24) {
      const i = 4
      lines.push({ axis: 'x', at: b.z0 + i, from: b.x0 + i, to: b.x1 - i, kind: 'park', st: [] })
      lines.push({ axis: 'x', at: b.z1 - i, from: b.x0 + i, to: b.x1 - i, kind: 'park', st: [] })
      lines.push({ axis: 'z', at: b.x0 + i, from: b.z0 + i, to: b.z1 - i, kind: 'park', st: [] })
      lines.push({ axis: 'z', at: b.x1 - i, from: b.z0 + i, to: b.z1 - i, kind: 'park', st: [] })
    }
    extend({ axis: 'x', at: cz, from: b.x0, to: b.x1, kind: 'park', st: [] })
    extend({ axis: 'z', at: cx, from: b.z0, to: b.z1, kind: 'park', st: [] })
  }

  // ── 노드: 좌표를 5 cm 격자로 맞춰 같은 점은 한 노드 ──
  const nx: number[] = []
  const nz: number[] = []
  const ids = new Map<string, number>()
  const node = (x: number, z: number) => {
    const k = `${Math.round(x * 20)},${Math.round(z * 20)}`
    let id = ids.get(k)
    if (id === undefined) {
      id = nx.length
      nx.push(x)
      nz.push(z)
      ids.set(k, id)
    }
    return id
  }
  const pt = (ln: Line, t: number): [number, number] => (ln.axis === 'x' ? [t, ln.at] : [ln.at, t])
  for (const ln of lines) {
    ln.st.push(node(...pt(ln, ln.from)), node(...pt(ln, ln.to)))
  }
  const xs = lines.filter((l) => l.axis === 'x')
  const zs = lines.filter((l) => l.axis === 'z')
  const eps = 0.02
  for (const a of zs)
    for (const b of xs) {
      if (b.at < a.from - eps || b.at > a.to + eps || a.at < b.from - eps || a.at > b.to + eps) continue
      const id = node(a.at, b.at)
      a.st.push(id)
      b.st.push(id)
    }

  // ── 간선: 선 위 이웃한 노드끼리. 차도 위를 지나는 보도 구간은 횡단보도 ──
  const crossRoads = plan.roads
  const onCarriage = (axis: 'x' | 'z', x: number, z: number) => {
    for (const rd of crossRoads) {
      if (rd.axis === axis) continue
      const perp = rd.axis === 'x' ? z : x
      const along = rd.axis === 'x' ? x : z
      if (Math.abs(perp - rd.at) < rd.w / 2 && along > rd.from && along < rd.to) return true
    }
    return false
  }
  const ea: number[] = []
  const eb: number[] = []
  const ek: number[] = []
  const seen = new Set<number>()
  for (const ln of lines) {
    const tOf = (id: number) => (ln.axis === 'x' ? nx[id] : nz[id])
    const st = [...new Set(ln.st)].sort((p, q) => tOf(p) - tOf(q))
    for (let i = 0; i + 1 < st.length; i++) {
      const a = st[i]
      const b = st[i + 1]
      const mx = (nx[a] + nx[b]) / 2
      const mz = (nz[a] + nz[b]) / 2
      if (inCampus(mx, mz)) continue
      let kind: number = EK[ln.kind]
      if (ln.kind === 'side') {
        // 트럭 도로는 건너지 않는다
        if (ln.axis === 'z' && mz > MAIN_Z0 - 0.5 && mz < MAIN_Z1 + 0.5) continue
        if (onCarriage(ln.axis, mx, mz)) kind = EK.cross
      } else if (inRiver(rv, mx, mz, 1)) continue
      const key = a < b ? a * 1e6 + b : b * 1e6 + a
      if (seen.has(key)) continue
      seen.add(key)
      ea.push(a)
      eb.push(b)
      ek.push(kind)
    }
  }

  // CSR 인접 목록
  const n = nx.length
  const deg = new Int32Array(n + 1)
  for (let i = 0; i < ea.length; i++) {
    deg[ea[i]]++
    deg[eb[i]]++
  }
  const start = new Int32Array(n + 1)
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + deg[i]
  const fill = start.slice(0, n)
  const nb = new Int32Array(start[n])
  const ekArr = new Uint8Array(start[n])
  for (let i = 0; i < ea.length; i++) {
    nb[fill[ea[i]]] = eb[i]
    ekArr[fill[ea[i]]++] = ek[i]
    nb[fill[eb[i]]] = ea[i]
    ekArr[fill[eb[i]]++] = ek[i]
  }

  // ── 출발 간선 가중치: 구역(상업가는 붐비고 창고가는 한산) × 캠퍼스에서 먼 정도 ──
  const zoneAt = (x: number, z: number) => {
    for (const b of plan.blocks) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return ZONE_DENSITY[b.zone] ?? 0.3
    return -1
  }
  const spA: number[] = []
  const spB: number[] = []
  const spK: number[] = []
  const spCum: number[] = []
  let sum = 0
  for (let i = 0; i < ea.length; i++) {
    const k = ek[i]
    if (k === EK.cross) continue
    const a = ea[i]
    const b = eb[i]
    const len = Math.hypot(nx[b] - nx[a], nz[b] - nz[a])
    if (len < 0.5) continue
    const mx = (nx[a] + nx[b]) / 2
    const mz = (nz[a] + nz[b]) / 2
    if (inRiver(rv, mx, mz, 2)) continue
    let zf: number
    if (k === EK.side) {
      // 보도 양옆 블록 중 붐비는 쪽
      const px = nz[b] - nz[a]
      const pz = nx[a] - nx[b]
      const o = 4 / len
      zf = Math.max(zoneAt(mx + px * o, mz + pz * o), zoneAt(mx - px * o, mz - pz * o))
      if (zf < 0) zf = 0.25
    } else zf = Math.max(0.3, zoneAt(mx, mz))
    const dx = Math.max(campus.x0 - mx, 0, mx - campus.x1)
    const dz = Math.max(campus.z0 - mz, 0, mz - campus.z1)
    const fall = 0.3 + 1.5 * Math.exp(-Math.hypot(dx, dz) / 140)
    const km = k === EK.park ? 1.6 : k === EK.alley ? 0.5 : 1
    sum += len * zf * fall * km
    spA.push(a)
    spB.push(b)
    spK.push(k)
    spCum.push(sum)
  }
  // 가중 길이 약 18 m당 한 명, 600~1000명
  const base = Math.round(Math.min(1000, Math.max(600, sum / 18)))

  return {
    n,
    x: Float32Array.from(nx),
    z: Float32Array.from(nz),
    start,
    nb,
    ek: ekArr,
    spA: Int32Array.from(spA),
    spB: Int32Array.from(spB),
    spK: Uint8Array.from(spK),
    spCum: Float64Array.from(spCum),
    base,
  }
}

// ── 보행자 상태: 간선 a→b 위 s 지점. 화면 좌표·방향은 px/pz/hd에 ──
export interface Peds {
  count: number
  a: Int32Array
  b: Int32Array
  s: Float32Array
  len: Float32Array
  ux: Float32Array
  uz: Float32Array
  lane: Float32Array // 현재 간선의 비켜 걷는 폭 배율
  spd: Float32Array
  lat: Float32Array // 진행 방향 오른쪽으로 비켜 걷는 거리
  hx: Float32Array
  hz: Float32Array
  hr: Float32Array
  ox: Float32Array
  oz: Float32Array
  px: Float32Array
  pz: Float32Array
  hd: Float32Array
  ph: Float32Array
  sc: Float32Array // 키 배율
  umb: Float32Array // 0..1, 비 올 때 이 값이 작으면 우산
  rng: Rng
}

function setEdge(g: PedGraph, p: Peds, i: number, a: number, b: number, k: number) {
  const dx = g.x[b] - g.x[a]
  const dz = g.z[b] - g.z[a]
  const l = Math.max(0.01, Math.hypot(dx, dz))
  p.a[i] = a
  p.b[i] = b
  p.len[i] = l
  p.ux[i] = dx / l
  p.uz[i] = dz / l
  p.lane[i] = EDGE_LANE[k]
}

export function spawnPeds(g: PedGraph, count: number, seed: number): Peds {
  const r = new Rng(seed)
  const f = () => new Float32Array(count)
  const p: Peds = {
    count,
    a: new Int32Array(count),
    b: new Int32Array(count),
    s: f(),
    len: f(),
    ux: f(),
    uz: f(),
    lane: f(),
    spd: f(),
    lat: f(),
    hx: f(),
    hz: f(),
    hr: f(),
    ox: f(),
    oz: f(),
    px: f(),
    pz: f(),
    hd: f(),
    ph: f(),
    sc: f(),
    umb: f(),
    rng: new Rng(seed + 1),
  }
  const total = g.spCum.length ? g.spCum[g.spCum.length - 1] : 0
  for (let i = 0; i < count; i++) {
    p.spd[i] = r.range(1.0, 1.6)
    p.lat[i] = r.range(0.4, 0.8)
    p.ph[i] = r.range(0, Math.PI * 2)
    p.sc[i] = r.range(0.9, 1.07)
    p.umb[i] = r.next()
    if (!total) {
      p.len[i] = 1
      continue
    }
    // 누적 가중치 이분 탐색
    const v = r.next() * total
    let lo = 0
    let hi = g.spCum.length - 1
    while (lo < hi) {
      const m = (lo + hi) >> 1
      if (g.spCum[m] < v) lo = m + 1
      else hi = m
    }
    const fwd = r.chance(0.5)
    const a = fwd ? g.spA[lo] : g.spB[lo]
    const b = fwd ? g.spB[lo] : g.spA[lo]
    const k = g.spK[lo]
    setEdge(g, p, i, a, b, k)
    p.s[i] = r.range(0, p.len[i])
    p.hx[i] = g.x[a]
    p.hz[i] = g.z[a]
    p.hr[i] = HOME_R[k] * r.range(0.8, 1.3)
    p.hd[i] = Math.atan2(p.ux[i], p.uz[i])
    p.ox[i] = -p.uz[i] * p.lat[i] * p.lane[i]
    p.oz[i] = p.ux[i] * p.lat[i] * p.lane[i]
    p.px[i] = g.x[a] + p.ux[i] * p.s[i] + p.ox[i]
    p.pz[i] = g.z[a] + p.uz[i] * p.s[i] + p.oz[i]
  }
  return p
}

// 갈림길: 왔던 길은 막다른 곳에서만 되돌아간다. 집에서 멀면 가까워지는 길을 더 자주 고른다
function nextEdge(g: PedGraph, p: Peds, i: number) {
  const prev = p.a[i]
  const at = p.b[i]
  const s0 = g.start[at]
  const s1 = g.start[at + 1]
  if (s1 <= s0) {
    setEdge(g, p, i, at, prev, 0)
    return
  }
  const hx = p.hx[i]
  const hz = p.hz[i]
  const far = (g.x[at] - hx) ** 2 + (g.z[at] - hz) ** 2
  const homing = far > p.hr[i] * p.hr[i]
  let tot = 0
  for (let j = s0; j < s1; j++) {
    const o = g.nb[j]
    if (o === prev && s1 - s0 > 1) continue
    let w = EDGE_W[g.ek[j]]
    if (homing && (g.x[o] - hx) ** 2 + (g.z[o] - hz) ** 2 < far) w *= 6
    tot += w
  }
  let v = p.rng.next() * tot
  let pick = s0
  for (let j = s0; j < s1; j++) {
    const o = g.nb[j]
    if (o === prev && s1 - s0 > 1) continue
    let w = EDGE_W[g.ek[j]]
    if (homing && (g.x[o] - hx) ** 2 + (g.z[o] - hz) ** 2 < far) w *= 6
    pick = j
    v -= w
    if (v <= 0) break
  }
  setEdge(g, p, i, at, g.nb[pick], g.ek[pick])
}

const wrap = (a: number) => {
  let d = a % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

// 앞의 n명만 움직인다 (보이는 사람만)
export function stepPeds(g: PedGraph, p: Peds, n: number, dt: number) {
  const kOff = 1 - Math.exp(-dt * 3)
  const kHd = 1 - Math.exp(-dt * 8)
  for (let i = 0; i < n; i++) {
    const v = p.spd[i]
    let s = p.s[i] + v * dt
    // 짧은 간선 여러 개를 한 프레임에 지날 수 있어 몇 번까지 넘긴다
    for (let guard = 0; s >= p.len[i] && guard < 6; guard++) {
      s -= p.len[i]
      nextEdge(g, p, i)
    }
    if (s > p.len[i]) s = p.len[i]
    p.s[i] = s
    const ux = p.ux[i]
    const uz = p.uz[i]
    // 진행 방향 오른쪽으로 비켜 걷기. 모퉁이에서는 천천히 옮겨 간다
    const off = p.lat[i] * p.lane[i]
    p.ox[i] += (-uz * off - p.ox[i]) * kOff
    p.oz[i] += (ux * off - p.oz[i]) * kOff
    const a = p.a[i]
    p.px[i] = g.x[a] + ux * s + p.ox[i]
    p.pz[i] = g.z[a] + uz * s + p.oz[i]
    p.hd[i] += wrap(Math.atan2(ux, uz) - p.hd[i]) * kHd
    p.ph[i] += dt * v * 4.5
  }
}
