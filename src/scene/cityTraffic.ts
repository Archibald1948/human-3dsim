// 도시 일반 차량 주행: 차로마다 앞차 간격을 지키고 교차로 신호에 서며, 교차로에서 직진·좌회전·우회전한다.
// 그리기와 분리된 순수 계산
import { Rng } from '../sim/rng'
import { MAIN_Z0, MAIN_Z1, type CityPlan, type Road } from './cityPlan'

// 교차로 신호: 남북 녹색 → 전방향 적색 → 동서 녹색 → 전방향 적색 (교차로마다 위상만 다름)
const CYCLE = 28
const GREEN = 11
const CLEAR = 3
function green(axis: 'x' | 'z', t: number, off: number) {
  const ph = (((t + off) % CYCLE) + CYCLE) % CYCLE
  return axis === 'z' ? ph < GREEN : ph >= GREEN + CLEAR && ph < 2 * GREEN + CLEAR
}
const CAR_GAP = 6.8 // 앞차 중심까지 최소 거리 (차 길이 4.3 + 여유)
const ACCEL = 3
const BRAKE = 5
const TURN_P = 0.2 // 교차로마다 좌회전·우회전 확률 (각각)
const TURN_R = 5 // 회전 곡선: 두 차로 중심선이 만나는 점 앞뒤로 이만큼
const TURN_V = 4.5 // 회전할 때 속도 상한
const TURN_LEN = bezierLen(TURN_R)
const DENSE = 45 // 차로 길이 / 이 값보다 차가 많으면 그 차로로 꺾지 않는다
const ONCOMING = 26 // 좌회전 전에 비어 있어야 하는 맞은편 차로 구간 (정지선 앞)

export interface Stop {
  s: number // 정지선 (차 중심 기준)
  end: number // 교차로를 빠져나간 위치
  off: number // 교차로 신호 위상
  turns: number[] // 꺾어 들어갈 수 있는 차로 (트럭 도로는 없음)
  opp: number // 맞은편 차로에서 같은 교차로의 정지선
}
export interface Lane {
  axis: 'x' | 'z'
  x: number
  z: number
  dx: number
  dz: number
  len: number
  ids: number[] // 차로 위 차량, 진행 방향 앞쪽이 뒤로 오도록 정렬
  stops: Stop[]
}
// 회전 중인 곡선: A(진입) → P(두 중심선 교점) → B(진출) 이차 베지어. 새 차로에서 s0부터 TURN_LEN 동안
interface Turn {
  from: number // 떠나온 차로 (곡선을 다 돌 때까지 그 차로 뒤차가 피한다)
  s0: number
  ax: number
  az: number
  px: number
  pz: number
  bx: number
  bz: number
}
export interface Mover {
  lane: number
  s: number
  v: number
  vmax: number
  rnd: number // 회전 선택용 난수 상태
  plan: { stop: Stop; to: number } | null // 다음 교차로에서 갈 차로 (-1 = 직진)
  turn: Turn | null
}

function bezierLen(r: number) {
  // A(0,-r) P(0,0) B(r,0) 곡선 길이 (수치 적분)
  let len = 0
  let px = 0
  let pz = -r
  for (let i = 1; i <= 64; i++) {
    const u = i / 64
    const x = u * u * r
    const z = -(1 - u) * (1 - u) * r
    len += Math.hypot(x - px, z - pz)
    px = x
    pz = z
  }
  return len
}

const scratch = { x: 0, z: 0, h: 0 }
const along = (ln: Lane, x: number, z: number) => (x - ln.x) * ln.dx + (z - ln.z) * ln.dz

export function lanesOf(plan: CityPlan): Lane[] {
  const crossings = (rd: Road) => {
    const out = plan.roads.map((o, j) => ({ o, j })).filter(({ o }) => o.axis !== rd.axis).map(({ o, j }) => ({ t: o.at, hw: o.w / 2, road: j }))
    if (rd.axis === 'z') out.push({ t: (MAIN_Z0 + MAIN_Z1) / 2, hw: (MAIN_Z1 - MAIN_Z0) / 2, road: -1 })
    return out
  }
  const lanes: Lane[] = plan.lanes.map((ln, i) => {
    const rd = plan.roads[i >> 1] // 도로마다 차로 2개씩 순서대로
    const dir = ln.dx + ln.dz
    const stops = crossings(rd).map((c) => {
      const ix = rd.axis === 'z' ? rd.at : c.t
      const iz = rd.axis === 'z' ? c.t : rd.at
      const off = (Math.abs(Math.sin(ix * 12.9898 + iz * 78.233) * 43758.5453) % 1) * CYCLE
      // 횡단보도 앞에서 차 앞머리가 멈추도록
      const s = (dir > 0 ? c.t - rd.from : rd.to - c.t) - c.hw - 5.8
      return { s, end: s + 2 * c.hw + 11.6, off, turns: c.road < 0 ? [] : [c.road * 2, c.road * 2 + 1], opp: 0, t: c.t }
    })
    stops.sort((a, b) => a.s - b.s)
    return { axis: rd.axis, x: ln.x, z: ln.z, dx: ln.dx, dz: ln.dz, len: ln.len, ids: [], stops }
  })
  // 맞은편 차로(같은 도로의 다른 차로)에서 같은 교차로의 정지선
  lanes.forEach((ln, i) => {
    const o = lanes[i ^ 1]
    for (const st of ln.stops as (Stop & { t: number })[]) st.opp = (o.stops as (Stop & { t: number })[]).find((x) => x.t === st.t)!.s
  })
  return lanes
}

// 차로 a에서 차로 b로 꺾는 곡선 (교점 P = a의 고정 좌표와 b의 고정 좌표)
function curve(a: Lane, b: Lane) {
  const px = a.axis === 'z' ? a.x : b.x
  const pz = a.axis === 'z' ? b.z : a.z
  return { px, pz, sa: along(a, px, pz) - TURN_R, s0: along(b, px, pz) + TURN_R - TURN_LEN }
}

// 차로 ids에 s 순서로 끼워 넣을 자리. 뒤차와 간격이 있고, 앞차가 교차로(exit) 너머 한 대 자리 뒤에 있어야 한다
// (꺾어 들어가자마자 교차로 안에 서지 않게). 차로가 붐비면 꺾지 않는다
function slot(lane: Lane, movers: Mover[], s: number, exit: number): number {
  const ids = lane.ids
  if (ids.length >= lane.len / DENSE) return -1
  let k = 0
  while (k < ids.length && movers[ids[k]].s < s) k++
  if (ids.length) {
    const lead = movers[ids[k % ids.length]].s + (k === ids.length ? lane.len : 0)
    const back = movers[ids[(k - 1 + ids.length) % ids.length]].s - (k === 0 ? lane.len : 0)
    if (lead < Math.max(s, exit) + CAR_GAP || s - back < CAR_GAP) return -1
  }
  return k
}

function rand(mv: Mover) {
  mv.rnd = (Math.imul(mv.rnd, 1664525) + 1013904223) >>> 0
  return mv.rnd / 4294967296
}

// 한 걸음: 차로마다 앞차 간격과 신호를 지키며 전진 (같은 차로 추월 없음), 교차로에서 다른 차로로 옮겨 탄다
export function stepCars(lanes: Lane[], movers: Mover[], t: number, step: number) {
  // 곡선을 도는 차는 떠나온 차로에도 그 위치를 투영해 장애물로 남긴다
  const ghosts: { lane: number; s: number }[] = []
  for (const mv of movers) {
    if (!mv.turn) continue
    const p = carPose(lanes, mv, scratch)
    if (mv.turn) ghosts.push({ lane: mv.turn.from, s: along(lanes[mv.turn.from], p.x, p.z) })
  }
  lanes.forEach((lane, li) => {
    const ids = lane.ids
    // 앞차부터 움직인다 (뒤차는 이번 프레임의 앞차 위치를 본다)
    for (let k = ids.length - 1; k >= 0; k--) {
      const id = ids[k]
      const mv = movers[id]
      let free = Infinity
      if (ids.length > 1) {
        const lead = movers[ids[(k + 1) % ids.length]]
        free = (((lead.s - mv.s) % lane.len) + lane.len) % lane.len - CAR_GAP
      }
      for (const g of ghosts) if (g.lane === li && g.s > mv.s - 1) free = Math.min(free, g.s - mv.s - CAR_GAP)
      // 다음 정지선: 적색이거나 교차로 건너편에 설 자리가 없으면 선다.
      // 제동 거리 안에 서지 못하면(황색 딜레마) 그냥 지나간다
      const stop = lane.stops.find((st) => st.s >= mv.s - 0.05)
      if (stop && (!green(lane.axis, t, stop.off) || mv.s + free < stop.end)) {
        const dist = stop.s - mv.s
        // 한 걸음 이동분을 빼야 정지선에 맞춰 감속 중인 차가 딜레마로 잘못 빠지지 않는다
        if (dist >= (mv.v * mv.v) / (2 * BRAKE) - mv.v * step - 0.5) free = Math.min(free, dist)
      }
      // 지금 있거나 다가가는 교차로에서 어디로 갈지 한 번만 정한다
      const cur = lane.stops.find((st) => st.end > mv.s)
      if (cur && mv.plan?.stop !== cur) {
        const u = rand(mv)
        mv.plan = { stop: cur, to: cur.turns.length && u < 2 * TURN_P ? cur.turns[u < TURN_P ? 0 : 1] : -1 }
      }
      const turning = mv.plan && mv.plan.to >= 0 ? curve(lane, lanes[mv.plan.to]) : null
      let vmax = mv.vmax
      if (turning && turning.sa - mv.s < 25) vmax = Math.min(vmax, TURN_V)
      const target = Math.min(vmax, Math.sqrt(2 * BRAKE * Math.max(0, free)))
      mv.v = mv.v < target ? Math.min(target, mv.v + ACCEL * step) : target
      mv.s += Math.min(mv.v * step, Math.max(0, free))
      if (!turning || mv.s < turning.sa) continue
      // 곡선 진입점: 꺾을 차로에 자리가 있고, 좌회전이면 맞은편 직진 차가 없을 때만 옮겨 탄다. 아니면 직진
      const to = mv.plan!.to
      const dst = lanes[to]
      const box = mv.plan!.stop
      const left = along(lane, turning.px, turning.pz) > (box.s + box.end) / 2
      const opp = lanes[li ^ 1]
      const blocked = left && opp.ids.some((o) => movers[o].s > box.opp - ONCOMING && movers[o].s < box.opp + (box.end - box.s))
      const exit = dst.stops.find((st) => st.end > turning.s0)?.end ?? turning.s0
      const at = blocked ? -1 : slot(dst, movers, turning.s0, exit)
      mv.plan = { stop: box, to: -1 }
      if (at < 0) continue
      mv.turn = {
        from: li,
        s0: turning.s0,
        ax: turning.px - lane.dx * TURN_R,
        az: turning.pz - lane.dz * TURN_R,
        px: turning.px,
        pz: turning.pz,
        bx: turning.px + dst.dx * TURN_R,
        bz: turning.pz + dst.dz * TURN_R,
      }
      ids.splice(k, 1)
      dst.ids.splice(at, 0, id)
      mv.lane = to
      mv.s = turning.s0
      // 새 차로에서도 같은 교차로 안이므로 여기서 또 꺾지 않는다
      const here = dst.stops.find((st) => st.end > mv.s)
      mv.plan = here ? { stop: here, to: -1 } : null
    }
    // 도시 끝을 지난 맨 앞차는 반대편 끝으로 다시 들어온다: 정렬 순서도 한 칸 돌린다
    while (ids.length && movers[ids[ids.length - 1]].s >= lane.len) {
      movers[ids[ids.length - 1]].s -= lane.len
      ids.unshift(ids.pop()!)
    }
  })
}

// 그릴 위치와 방향: 회전 중이면 곡선 위, 아니면 차로 위
export function carPose(lanes: Lane[], mv: Mover, out: { x: number; z: number; h: number }) {
  const ln = lanes[mv.lane]
  const tr = mv.turn
  if (tr) {
    const u = (mv.s - tr.s0) / TURN_LEN
    if (u >= 0 && u < 1) {
      const a = (1 - u) * (1 - u)
      const b = 2 * u * (1 - u)
      const c = u * u
      out.x = a * tr.ax + b * tr.px + c * tr.bx
      out.z = a * tr.az + b * tr.pz + c * tr.bz
      // 접선 = 2(1-u)(P-A) + 2u(B-P)
      out.h = Math.atan2((1 - u) * (tr.px - tr.ax) + u * (tr.bx - tr.px), (1 - u) * (tr.pz - tr.az) + u * (tr.bz - tr.pz))
      return out
    }
    if (u >= 1) mv.turn = null
  }
  out.x = ln.x + ln.dx * mv.s
  out.z = ln.z + ln.dz * mv.s
  out.h = Math.atan2(ln.dx, ln.dz)
  return out
}

// 차로 길이 85m마다 한 대 (교통량 배율만큼). 교차로 안에서 시작하지 않도록 정지선 앞으로 당긴다
export function spawnCars(plan: CityPlan, lanes: Lane[], seed: number, density = 1): Mover[] {
  const r = new Rng(seed)
  const movers: Mover[] = []
  plan.lanes.forEach((ln, i) => {
    const n = Math.max(1, Math.floor((ln.len / 85) * density))
    for (let k = 0; k < n; k++) {
      let s = (k / n) * ln.len + r.range(0, 30)
      const box = lanes[i].stops.find((st) => s > st.s && s < st.end)
      if (box) s = box.s
      lanes[i].ids.push(movers.length)
      movers.push({ lane: i, s, v: 0, vmax: r.range(7, 11), rnd: r.int(1, 1 << 30), plan: null, turn: null })
    }
  })
  return movers
}
