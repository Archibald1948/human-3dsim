// 차량 주행 물리 — 경로 위 진행거리 s, 속도 v, 가속도로 1초마다 적분한다.
import type { Path, Pose } from './path'

export interface Dims {
  hl: number // 반길이
  hw: number // 반폭
  off: number // 기준점 → 외곽 중심 (전방 +)
}

export interface OBB {
  cx: number
  cz: number
  ux: number
  uz: number
  hl: number
  hw: number
}

export interface Circle {
  x: number
  z: number
  r: number
}

// 구역 점유: 이 구역을 쥔 차량이 기동하는 동안 다른 차량은 새로 들어오지 않는다
export interface Claim {
  owner: string
  box?: OBB
  circle?: Circle
  // 휩쓸 영역: 기동 경로를 따라 샘플링한 외곽들 + 빠른 배제용 경계 원
  sweep?: { boxes: OBB[]; bound: Circle }
  // 출구 여유: 기동을 마치고 빠져나갈 자리. 여기에 다른 차가 있으면 구역을 잡지 않는다 (교차로 꼬리물기 방지)
  exit?: OBB[]
  // 합류할 차로의 뒤쪽: 여기서 움직이며 다가오는 차가 있으면 먼저 보낸다
  upstream?: OBB[]
}

export function sweepClaim(boxes: OBB[]): Claim {
  let x = 0
  let z = 0
  for (const b of boxes) {
    x += b.cx
    z += b.cz
  }
  x /= boxes.length
  z /= boxes.length
  let r = 0
  for (const b of boxes) r = Math.max(r, Math.hypot(b.cx - x, b.cz - z) + b.hl + b.hw)
  return { owner: '', sweep: { boxes, bound: { x, z, r } } }
}

// 모서리 관문: s0 이전에 구역을 확보해야 지나가고, s1을 지나면 놓는다
export interface Gate {
  s0: number
  s1: number
  c: Claim
  keep?: boolean // 다음 구간까지 이어서 쥐는 구역 (구간이 끝나도 놓지 않음)
}

export type Leg =
  | { kind: 'path'; path: Path; reverse: boolean; vmax: number; need?: Claim; release?: boolean; gates?: Gate[] }
  | { kind: 'turn'; to: number; need?: Claim; release?: boolean }
  | { kind: 'wait'; dur: number; need?: Claim; release?: boolean }

export interface Spec {
  dims: Dims
  accel: number
  decel: number
  turnRate: number
  padL: number // 앞뒤 여유 (정지 간격)
  padW: number // 좌우 여유
  sample: number // 미리보기 샘플 간격
  yieldDist: number
  yieldAfter: number // 서로 막고 이만큼(초) 서 있으면 양보를 시작한다
  // 'prio': 우선순위 낮은 쪽이 양보 (트럭), 'room': 뒤로 물러날 공간이 넉넉한 쪽이 양보 (지게차)
  yieldBy: 'prio' | 'room'
  yieldHold: number
  yieldSpeed: number
  early: number // 다음 구간의 구역 점유를 미리 시도하는 남은 거리
  // 예약을 믿고 달린다: 앞을 내다보며 감속하지 않고, 이번 스텝 이동이 실제로 겹칠 때만 멈춘다 (예약 일정과 똑같이 움직이게)
  trust?: boolean
}

interface Yield {
  for: string[] // 이 차들에게 길을 비켜 준다
  done: number // 지금까지 물러난 거리
  target: number
  hold: number
  blocked: number
  phase: 'retreat' | 'hold'
}

export interface Mover {
  id: string
  spec: Spec
  pose: Pose
  prev: Pose
  legs: Leg[]
  li: number
  s: number
  v: number
  wait: number
  prio: number
  claims: Claim[]
  blockedBy: string | null
  why: string // 진단용: 마지막으로 막힌 이유
  stuck: number
  moved: number
  yld: Yield | null
  // 정차 중이지만 구역 점유 판정에서 무시할 차량 (도크에 붙은 트럭 등)
  parked: boolean
  box: OBB | null
}

export function makeMover(id: string, spec: Spec, pose: Pose): Mover {
  return {
    id,
    spec,
    pose: { ...pose },
    prev: { ...pose },
    legs: [],
    li: 0,
    s: 0,
    v: 0,
    wait: 0,
    prio: 0,
    claims: [],
    blockedBy: null,
    why: '',
    stuck: 0,
    moved: 0,
    yld: null,
    parked: false,
    box: null,
  }
}

export const moving = (m: Mover) => m.li < m.legs.length || m.yld != null
export const legsDone = (m: Mover) => m.li >= m.legs.length && m.yld == null

export function setLegs(m: Mover, legs: Leg[]) {
  m.yld = null
  m.legs = legs
  m.li = 0
  m.s = 0
  m.wait = 0
  m.stuck = 0
  m.blockedBy = null
}

// ───────── 기하 ─────────
export function obbAt(p: Pose, d: Dims, padL = 0, padW = 0): OBB {
  const ux = Math.sin(p.heading)
  const uz = Math.cos(p.heading)
  return { cx: p.x + ux * d.off, cz: p.z + uz * d.off, ux, uz, hl: d.hl + padL, hw: d.hw + padW }
}

function radiusOn(b: OBB, ax: number, az: number): number {
  return b.hl * Math.abs(b.ux * ax + b.uz * az) + b.hw * Math.abs(-b.uz * ax + b.ux * az)
}

export function obbOverlap(a: OBB, b: OBB): boolean {
  const dx = b.cx - a.cx
  const dz = b.cz - a.cz
  const r = a.hl + a.hw + b.hl + b.hw
  if (dx * dx + dz * dz > r * r) return false
  const axes = [a.ux, a.uz, -a.uz, a.ux, b.ux, b.uz, -b.uz, b.ux]
  for (let i = 0; i < 8; i += 2) {
    const ax = axes[i]
    const az = axes[i + 1]
    if (Math.abs(dx * ax + dz * az) > radiusOn(a, ax, az) + radiusOn(b, ax, az)) return false
  }
  return true
}

function circleOverlap(b: OBB, c: Circle): boolean {
  const dx = c.x - b.cx
  const dz = c.z - b.cz
  const lu = dx * b.ux + dz * b.uz
  const lv = -dx * b.uz + dz * b.ux
  const qu = Math.max(-b.hl, Math.min(b.hl, lu))
  const qv = Math.max(-b.hw, Math.min(b.hw, lv))
  return (lu - qu) ** 2 + (lv - qv) ** 2 < c.r * c.r
}

export function claimHits(b: OBB, c: Claim): boolean {
  if (c.box) return obbOverlap(b, c.box)
  if (c.circle) return circleOverlap(b, c.circle)
  if (c.sweep) {
    const g = c.sweep.bound
    const r = g.r + b.hl + b.hw
    if ((b.cx - g.x) ** 2 + (b.cz - g.z) ** 2 > r * r) return false
    return c.sweep.boxes.some((x) => obbOverlap(b, x))
  }
  return false
}

function claimsOverlap(a: Claim, b: Claim): boolean {
  if (a.sweep) return a.sweep.boxes.some((x) => claimHits(x, b))
  if (b.sweep) return b.sweep.boxes.some((x) => claimHits(x, a))
  if (a.box && b.box) return obbOverlap(a.box, b.box)
  if (a.circle && b.circle) return Math.hypot(a.circle.x - b.circle.x, a.circle.z - b.circle.z) < a.circle.r + b.circle.r
  const box = a.box ?? b.box!
  const c = a.circle ?? b.circle!
  return circleOverlap(box, c)
}

export const boxOf = (m: Mover): OBB => (m.box ??= obbAt(m.pose, m.spec.dims))

export function poseOnLeg(leg: Leg & { kind: 'path' }, s: number, fallback: number): Pose {
  const p = leg.path.sample(s)
  let heading = p.dx || p.dz ? Math.atan2(p.dx, p.dz) : fallback
  if (leg.reverse && (p.dx || p.dz)) heading += Math.PI
  return { x: p.x, z: p.z, heading }
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

export function lerpPose(a: Pose, b: Pose, f: number): Pose {
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, heading: a.heading + wrap(b.heading - a.heading) * f }
}

// ───────── 한 무리의 차량(같은 종류)을 한 스텝 진행 ─────────
export class Fleet {
  movers: Mover[] = []
  claims: Claim[] = []
  // 진단: 해소 시도 기록
  yields = 0
  private byId = new Map<string, Mover>()

  add(m: Mover) {
    this.movers.push(m)
    this.byId.set(m.id, m)
  }
  remove(id: string) {
    const m = this.byId.get(id)
    if (!m) return
    this.releaseAll(m)
    this.byId.delete(id)
    this.movers.splice(this.movers.indexOf(m), 1)
  }
  get(id: string) {
    return this.byId.get(id)
  }

  // 장애물이 없을 때의 운행을 미리 돌려 1초 간격 자세 목록을 얻는다 (예약 계산용)
  static ghost(spec: Spec, pose: Pose, legs: Leg[], maxSteps = 900): Pose[] {
    const f = new Fleet()
    const m = makeMover('ghost', spec, pose)
    f.add(m)
    setLegs(m, legs)
    const out: Pose[] = [{ ...pose }]
    // 실제 주행과 같은 advance()를 장애물 없이 돌린다
    for (let k = 0; k < maxSteps && !legsDone(m); k++) {
      m.prev = m.pose
      m.moved = 0
      f.advance(m)
      out.push(m.pose)
    }
    return out
  }

  holds(m: Mover, c: Claim): boolean {
    return m.claims.some((x) => sameClaim(x, c))
  }
  release(m: Mover, c: Claim) {
    const k = m.claims.findIndex((x) => sameClaim(x, c))
    if (k < 0) return
    const own = m.claims[k]
    m.claims.splice(k, 1)
    const i = this.claims.indexOf(own)
    if (i >= 0) this.claims.splice(i, 1)
  }
  releaseAll(m: Mover, keep?: Claim) {
    for (const c of [...m.claims]) if (!keep || !sameClaim(c, keep)) this.release(m, c)
  }

  // 구역 점유 시도: 다른 점유 구역과 겹치지 않고, 그 안에 다른 차량이 없을 때만 허용
  tryClaim(m: Mover, c: Claim): string | null {
    if (this.holds(m, c)) return null
    const kind = c.sweep ? 'sweep' : c.circle ? 'disc' : 'box'
    for (const o of this.claims)
      if (o.owner !== m.id && claimsOverlap(o, c)) {
        m.why = `${kind}:claim`
        return o.owner
      }
    for (const o of this.movers) {
      if (o === m || o.parked) continue
      const ob = boxOf(o)
      m.why = `${kind}:body`
      if (claimHits(ob, c)) return o.id
      m.why = `${kind}:exit`
      if (c.exit && o.v < 0.05 && c.exit.some((x) => obbOverlap(ob, x))) return o.id
      m.why = `${kind}:upstream`
      if (c.upstream && o.v > 0.05 && c.upstream.some((x) => obbOverlap(ob, x))) return o.id
    }
    m.why = ''
    const own = { ...c, owner: m.id }
    m.claims.push(own)
    this.claims.push(own)
    return null
  }

  private clearAhead(m: Mover, c: Claim): string | null {
    for (const o of this.movers) {
      if (o === m || o.parked) continue
      const ob = boxOf(o)
      m.why = 'exit'
      if (c.exit && o.v < 0.05 && c.exit.some((x) => obbOverlap(ob, x))) return o.id
      m.why = 'upstream'
      if (c.upstream && o.v > 0.05 && c.upstream.some((x) => obbOverlap(ob, x))) return o.id
    }
    m.why = ''
    return null
  }

  // 후보 자세 p가 다른 차량·점유 구역과 부딪히면 그 상대 id
  // spin: 제자리 회전은 앞뒤 여유 없이 판정 (회전 반경이 부풀지 않게)
  private conflict(m: Mover, p: Pose, near: Mover[], spin = false): string | null {
    const sp = m.spec
    if (sp.trust) {
      // 예약대로 달리는 차: 실제 외곽이 겹치는지만 본다
      const hard = obbAt(p, sp.dims)
      for (const o of near) {
        if (obbOverlap(hard, boxOf(o))) {
          m.why = 'move'
          return o.id
        }
      }
      return null
    }
    const padL = spin ? 0.02 : sp.padL
    const hard = obbAt(p, sp.dims)
    const soft = obbAt(p, sp.dims, padL, sp.padW)
    const cur = boxOf(m)
    const curSoft = obbAt(m.pose, sp.dims, padL, sp.padW)
    for (const o of near) {
      const ob = boxOf(o)
      m.why = 'move'
      if (obbOverlap(hard, ob)) return o.id
      if (obbOverlap(soft, ob)) {
        if (!obbOverlap(curSoft, ob)) return o.id
        // 이미 여유 거리 안에 있으면 더 다가가는 쪽으로만 막는다
        const d0 = (cur.cx - ob.cx) ** 2 + (cur.cz - ob.cz) ** 2
        const d1 = (hard.cx - ob.cx) ** 2 + (hard.cz - ob.cz) ** 2
        if (d1 < d0 - 1e-6) return o.id
      }
    }
    for (const c of this.claims) {
      if (c.owner === m.id) continue
      m.why = 'move:claim'
      if (claimHits(hard, c) && !claimHits(cur, c)) return c.owner
    }
    m.why = ''
    return null
  }

  private nearby(m: Mover, reach: number): Mover[] {
    const out: Mover[] = []
    const b = boxOf(m)
    const r0 = b.hl + b.hw + reach + m.spec.padL
    for (const o of this.movers) {
      if (o === m) continue
      const ob = boxOf(o)
      const r = r0 + ob.hl + ob.hw
      if ((ob.cx - b.cx) ** 2 + (ob.cz - b.cz) ** 2 < r * r) out.push(o)
    }
    return out
  }

  private commit(m: Mover, p: Pose) {
    const dist = Math.hypot(p.x - m.pose.x, p.z - m.pose.z)
    m.moved += dist + Math.abs(wrap(p.heading - m.pose.heading)) * 0.5
    m.pose = p
    m.box = null
  }

  step() {
    for (const m of this.movers) {
      m.prev = m.pose
      m.moved = 0
    }
    const order = [...this.movers].sort((a, b) => b.prio - a.prio || (a.id < b.id ? -1 : 1))
    for (const m of order) {
      const wanted = this.advance(m)
      if (wanted && m.moved < 0.01) m.stuck++
      else {
        m.stuck = 0
        if (!wanted) m.blockedBy = null
      }
    }
    this.resolve()
  }

  // 반환: 움직이려 했는지
  advance(m: Mover): boolean {
    if (m.yld) return this.stepYield(m)
    const leg = m.legs[m.li]
    if (!leg) {
      m.v = 0
      return false
    }
    if (leg.need && !this.holds(m, leg.need)) {
      const who = this.tryClaim(m, leg.need)
      if (who) {
        m.blockedBy = who
        m.v = 0
        return true
      }
    } else if (leg.need && leg.kind === 'turn' && (leg.need.exit || leg.need.upstream)) {
      // 미리 쥐고 있던 구역이라도 (랙 칸 작업 중 등) 출발 직전에 출구·뒤쪽을 다시 본다
      const who = this.clearAhead(m, leg.need)
      if (who) {
        m.blockedBy = who
        m.v = 0
        return true
      }
    }
    const sp = m.spec
    if (leg.kind === 'wait') {
      m.v = 0
      m.wait += 1
      if (m.wait >= leg.dur) this.finishLeg(m, leg)
      return false
    }
    if (leg.kind === 'turn') {
      m.v = 0
      const diff = wrap(leg.to - m.pose.heading)
      if (Math.abs(diff) < 1e-3) {
        this.finishLeg(m, leg)
        return false
      }
      const stepA = Math.max(-sp.turnRate, Math.min(sp.turnRate, diff))
      const near = this.nearby(m, 0.5)
      const n = Math.max(1, Math.ceil(Math.abs(stepA) / 0.15))
      for (let k = 1; k <= n; k++) {
        const who = this.conflict(m, { ...m.pose, heading: m.pose.heading + (stepA * k) / n }, near, true)
        if (who) {
          m.blockedBy = who
          return true
        }
      }
      this.commit(m, { ...m.pose, heading: m.pose.heading + stepA })
      m.blockedBy = null
      if (Math.abs(wrap(leg.to - m.pose.heading)) < 1e-3) {
        m.pose = { ...m.pose, heading: leg.to }
        this.finishLeg(m, leg)
      }
      return true
    }
    // 경로 구간
    const L = leg.path.length
    let remaining = L - m.s
    // 다음 구간이 점유를 요구하면 미리 잡아 둔다 (못 잡으면 구간 끝에서 기다림)
    const next = m.legs[m.li + 1]
    if (next?.need && remaining <= sp.early && !this.holds(m, next.need)) this.tryClaim(m, next.need)
    // 모서리 관문: 확보하지 못한 관문의 s0 앞에서 멈춘다
    let gateWho: string | null = null
    if (leg.gates) {
      const gs = leg.gates
      for (let i = 0; i < gs.length; i++) {
        const g = gs[i]
        const held = this.holds(m, g.c)
        if (m.s >= g.s1) {
          if (held && !g.keep) this.release(m, g.c)
          continue
        }
        if (held) continue
        // 이미 관문 안쪽이면 (양보 뒤 재개 등) 확보를 시도만 하고 그대로 빠져나간다 — 충돌은 외곽 판정이 막는다
        if (m.s > g.s0 + 1e-3) {
          this.tryClaim(m, g.c)
          continue
        }
        if (m.s + sp.early >= g.s0) {
          // 이어 붙은 관문(앞 관문을 벗어나기 전에 다음 관문이 시작)은 한꺼번에 잡거나 하나도 잡지 않는다
          let j = i
          while (j + 1 < gs.length && gs[j + 1].s0 < gs[j].s1) j++
          const got: Claim[] = []
          let who: string | null = null
          for (let k = i; k <= j && !who; k++) {
            if (this.holds(m, gs[k].c)) continue
            who = this.tryClaim(m, gs[k].c)
            if (!who) got.push(gs[k].c)
          }
          if (!who) {
            i = j
            continue
          }
          for (const c of got) this.release(m, c)
          gateWho ??= who
        }
        if (g.s0 - m.s < remaining) remaining = Math.max(0, g.s0 - m.s)
        break
      }
    }
    if (remaining <= 1e-3 && gateWho) {
      m.v = 0
      m.blockedBy = gateWho
      return true
    }
    if (L - m.s <= 1e-3) {
      m.v = 0
      this.finishLeg(m, leg)
      return false
    }
    const vmax = leg.vmax
    const scan = sp.trust ? Math.min(remaining, Math.min(m.v + sp.accel, vmax)) : Math.min(remaining, vmax + (vmax * vmax) / (2 * sp.decel) + sp.padL + 0.2)
    const near = this.nearby(m, scan)
    let free = scan
    let who: string | null = null
    // 예약대로 달리는 차는 이번 스텝 끝 자세만 확인한다 (아래에서)
    if (!sp.trust && (near.length || this.claims.length)) {
      for (let d = Math.min(sp.sample, scan); ; d = Math.min(d + sp.sample, scan)) {
        who = this.conflict(m, poseOnLeg(leg, m.s + d, m.pose.heading), near)
        if (who) {
          free = Math.max(0, d - sp.sample)
          break
        }
        if (d >= scan) break
      }
    }
    const room = who && !sp.trust ? free : who ? Math.max(0, free) : remaining
    const vcap = Math.min(vmax, Math.sqrt(2 * sp.decel * Math.max(0, room)))
    const v = Math.min(m.v + sp.accel, vcap)
    let ds = Math.min(v, room)
    if (remaining - ds < 0.03 && !who) ds = remaining
    if (ds > 1e-4) {
      let p = poseOnLeg(leg, m.s + ds, m.pose.heading)
      let hit = near.length || this.claims.length ? this.conflict(m, p, near) : null
      who = who ?? hit
      // 샘플 사이 자세가 걸리면 한 칸씩 줄인다
      while (hit && ds > 1e-4) {
        ds = Math.max(0, ds - sp.sample)
        p = poseOnLeg(leg, m.s + ds, m.pose.heading)
        hit = ds > 1e-4 ? this.conflict(m, p, near) : null
        who = who ?? hit
      }
      if (ds > 1e-4) {
        m.s += ds
        this.commit(m, p)
      }
    }
    m.v = ds > 1e-4 ? Math.min(v, ds) : 0
    m.blockedBy = who ?? (ds <= 1e-4 ? gateWho : null)
    if (L - m.s <= 1e-3) {
      m.s = L
      m.v = 0
      this.finishLeg(m, leg)
    }
    return true
  }

  private finishLeg(m: Mover, leg: Leg) {
    if (leg.release && leg.need) this.release(m, leg.need)
    if (leg.kind === 'path' && leg.gates) for (const g of leg.gates) if (!g.keep) this.release(m, g.c)
    m.li++
    m.s = 0
    m.wait = 0
  }

  // ───────── 양보: 자기 경로를 거슬러 후진 → 대기 → 그 자리에서 재개 ─────────
  // dist만큼 경로를 거슬러 간 위치. 경로 구간만 거슬러 가며, 제자리 회전은 되돌리지 않는다
  private backTarget(m: Mover, dist: number): { li: number; s: number; got: number } | null {
    let li = m.li
    let s = m.s
    const cur = m.legs[li]
    if (!cur || cur.kind !== 'path') {
      // 회전·대기 구간에 들어서기 직전(아직 돌지 않았을 때)만 앞 경로로 물러날 수 있다
      const prev = m.legs[li - 1]
      if (!prev || prev.kind !== 'path') return null
      const end = poseOnLeg(prev, prev.path.length, m.pose.heading)
      if (Math.hypot(end.x - m.pose.x, end.z - m.pose.z) > 1e-3 || Math.abs(wrap(end.heading - m.pose.heading)) > 1e-3) return null
      li--
      s = prev.path.length
    }
    let d = dist
    let got = 0
    while (d > 1e-6) {
      if (s >= d) {
        s -= d
        got += d
        break
      }
      got += s
      d -= s
      s = 0
      const prev = m.legs[li - 1]
      if (!prev || prev.kind !== 'path') break
      li--
      s = prev.path.length
    }
    if (got < 1e-3) return null
    return { li, s, got }
  }

  private backPose(m: Mover, t: { li: number; s: number }): Pose {
    return poseOnLeg(m.legs[t.li] as Leg & { kind: 'path' }, t.s, m.pose.heading)
  }

  // 조금이라도 물러날 수 있는지 (바로 뒤에 나를 기다리는 차가 있으면 그 차도 같이 물러나면 된다)
  private canRetreat(m: Mover): boolean {
    const t = this.backTarget(m, Math.min(0.5, m.spec.yieldSpeed * 1.5))
    if (!t) return false
    const who = this.conflict(m, this.backPose(m, t), this.nearby(m, 1))
    if (!who) return true
    const o = this.byId.get(who)
    return !!o && !o.yld && o.blockedBy === m.id && !!this.backTarget(o, 0.5)
  }

  private startYield(m: Mover, dist = m.spec.yieldDist, forIds: string[] = []): boolean {
    if (m.yld) return false
    const room = this.backTarget(m, dist)
    if (!room || room.got < Math.min(1, dist) || !this.canRetreat(m)) return false
    m.yld = { for: forIds, done: 0, target: room.got, hold: 0, blocked: 0, phase: 'retreat' }
    this.releaseAll(m)
    m.v = 0
    this.yields++
    return true
  }

  private stepYield(m: Mover): boolean {
    const y = m.yld!
    const sp = m.spec
    if (y.phase === 'hold') {
      y.hold++
      // 비켜 준 상대가 아직 나 때문에 막혀 있으면 조금 더 물러난다 (뒤따라오던 차는 상관없음)
      const pressed = y.for.some((id) => {
        const o = this.byId.get(id)
        return !!o && o.blockedBy === m.id && o.stuck >= 2
      })
      if (pressed && y.hold <= 40 && this.canRetreat(m)) {
        const more = this.backTarget(m, 1)
        if (more) {
          y.target = y.done + more.got
          y.phase = 'retreat'
          y.blocked = 0
          return true
        }
      }
      if (y.hold >= (pressed ? 40 : sp.yieldHold)) {
        // 그 자리에서 평소처럼 다시 달린다
        m.yld = null
        m.v = 0
      }
      m.blockedBy = null
      return false
    }
    const near = this.nearby(m, sp.yieldSpeed + 0.5)
    let step = Math.min(sp.yieldSpeed, y.target - y.done)
    let who: string | null = null
    while (step > 1e-3) {
      const t = this.backTarget(m, step)
      if (!t) break
      const p = this.backPose(m, t)
      who = this.conflict(m, p, near)
      if (!who) {
        m.li = t.li
        m.s = t.s
        y.done += t.got
        this.commit(m, p)
        break
      }
      step -= sp.sample
    }
    m.blockedBy = who
    if (who && m.moved < 0.01) {
      y.blocked++
      // 뒤가 막혔는데 뒤차도 나를 기다리는 중이면 같이 물러나게 한다
      const o = this.byId.get(who)
      if (o && !o.yld && o.blockedBy === m.id) this.startYield(o, 2, y.for)
    }
    if (y.target - y.done < 1e-3 || y.blocked >= 4 || !this.backTarget(m, 0.05)) {
      y.phase = 'hold'
    }
    return true
  }

  // ───────── 교착 해소 ─────────
  private resolve() {
    for (const m of this.movers) {
      if (m.stuck < m.spec.yieldAfter || m.yld) continue
      // blockedBy 사슬을 따라가며 순환을 찾는다
      const chain: Mover[] = [m]
      let cur: Mover = m
      let cycle: Mover[] | null = null
      for (let k = 0; k < 12; k++) {
        const nid: string | null = cur.blockedBy
        const nxt: Mover | undefined = nid ? this.byId.get(nid) : undefined
        if (!nxt) break
        const at = chain.indexOf(nxt)
        if (at >= 0) {
          cycle = chain.slice(at)
          break
        }
        if (nxt.stuck < 3 || nxt.yld) break
        chain.push(nxt)
        cur = nxt
      }
      if (!cycle) continue
      const byPrio = (a: Mover, b: Mover) => a.prio - b.prio || b.stuck - a.stuck || (a.id < b.id ? 1 : -1)
      let cands = [...cycle].sort(byPrio)
      if (m.spec.yieldBy === 'room') {
        const room = new Map(cycle.map((c) => [c, this.backTarget(c, c.spec.yieldDist)?.got ?? 0]))
        const full = (c: Mover) => room.get(c)! >= c.spec.yieldDist * 0.9
        cands = [...cycle].sort((a, b) => Number(full(b)) - Number(full(a)) || (full(a) ? byPrio(a, b) : room.get(b)! - room.get(a)!))
      }
      for (const c of cands) if (this.startYield(c, c.spec.yieldDist, cycle.filter((x) => x !== c).map((x) => x.id))) break
    }
  }
}

export function sameClaim(a: Claim, b: Claim): boolean {
  if (a.sweep || b.sweep) return !!a.sweep && !!b.sweep && a.sweep.boxes === b.sweep.boxes
  if (a.circle && b.circle) return Math.abs(a.circle.x - b.circle.x) < 1e-6 && Math.abs(a.circle.z - b.circle.z) < 1e-6 && a.circle.r === b.circle.r
  if (a.box && b.box) return Math.abs(a.box.cx - b.box.cx) < 1e-6 && Math.abs(a.box.cz - b.box.cz) < 1e-6 && a.box.hl === b.box.hl
  return false
}
