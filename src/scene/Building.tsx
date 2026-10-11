// 물류센터 외피: 파란 골판 벽·창 띠·톱니 천창 지붕·옥상 설비·간판, 도크 롤업 도어·셸터·범퍼
// 단면 보기: 지붕은 들어 올리며 사라지고, 벽은 땅 아래로 내려가 1 m만 남는다 (벽에 붙은 문·조명·간판도 함께 숨음)
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import * as L from '../sim/layout'
import type { Site } from '../sim/engine'
import { useUi } from '../store'
import { P } from './palette'
import { nightMats } from './nightMats'
import { box, cyl, merged, vcMat, type Part } from './merge'

export const WALL_H = 9.2
const LEFT_H = 1 // 단면 보기에서 남는 벽 높이
const DOOR_W = 3.4
const DOOR_H = 4.6
const RIB = 0.9 // 골판 간격

// 단면 정도(0 = 외관, 1 = 단면). Docks 등 벽에 붙은 다른 요소가 읽는다
export const shell = { cut: 0, sink: 0 }

type V3 = [number, number, number]

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

// 골판: 가로 한 칸 = 골 하나 (밝은 능선 + 그늘)
let ribTex: THREE.CanvasTexture | null = null
function ribTexture() {
  if (ribTex) return ribTex
  ribTex = canvasTex(64, 8, (g) => {
    g.fillStyle = P.wall
    g.fillRect(0, 0, 64, 8)
    g.fillStyle = '#5A80DA'
    g.fillRect(6, 0, 12, 8)
    g.fillStyle = '#3460C4'
    g.fillRect(18, 0, 5, 8)
    g.fillStyle = '#3159BD'
    g.fillRect(52, 0, 12, 8)
  })
  ribTex.wrapS = ribTex.wrapT = THREE.RepeatWrapping
  return ribTex
}

// 롤업 도어 슬랫 (세로로 반복)
let slatTex: THREE.CanvasTexture | null = null
function slatTexture() {
  if (slatTex) return slatTex
  slatTex = canvasTex(8, 32, (g) => {
    g.fillStyle = P.door
    g.fillRect(0, 0, 8, 32)
    g.fillStyle = '#B9C0CA'
    g.fillRect(0, 26, 8, 4)
    g.fillStyle = '#EEF1F4'
    g.fillRect(0, 0, 8, 3)
  })
  slatTex.wrapS = slatTex.wrapT = THREE.RepeatWrapping
  slatTex.repeat.set(1, 14)
  return slatTex
}

// 벽 상자: 월드 좌표로 UV를 펴서 골 간격이 벽 길이와 무관하게 일정하도록
function ribBox(x0: number, x1: number, z0: number, z1: number, y0: number, y1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.max(0.01, x1 - x0), y1 - y0, Math.max(0.01, z1 - z0))
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  const uv = g.getAttribute('uv')
  for (let i = 0; i < pos.count; i++) {
    const along = Math.abs(nor.getX(i)) > 0.5 ? pos.getZ(i) : pos.getX(i)
    uv.setXY(i, along / RIB, pos.getY(i) / WALL_H)
  }
  return g
}

interface Opening {
  a: number
  b: number
  top: number
}

// 한 변의 벽을 개구부(도크 문·출입문)만 비우고 골판 상자들로 만든다
function wallRun(axis: 'x' | 'z', fixed: number, from: number, to: number, holes: Opening[], t: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = []
  const seg = (a: number, b: number, y0: number, y1: number) => {
    if (b - a < 0.02) return
    out.push(axis === 'x' ? ribBox(a, b, fixed - t / 2, fixed + t / 2, y0, y1) : ribBox(fixed - t / 2, fixed + t / 2, a, b, y0, y1))
  }
  let cur = from
  for (const h of [...holes].sort((p, q) => p.a - q.a)) {
    seg(cur, h.a, 0, WALL_H)
    seg(h.a, h.b, h.top, WALL_H)
    cur = h.b
  }
  seg(cur, to, 0, WALL_H)
  return out
}

function useSignTextures() {
  return useMemo(() => {
    const draw = (g: CanvasRenderingContext2D, glow: boolean) => {
      g.fillStyle = glow ? '#000' : P.trim
      g.fillRect(0, 0, 1024, 192)
      // 로고 마크: 흰 사각 안의 H
      g.fillStyle = glow ? '#fff' : '#ffffff'
      g.fillRect(36, 30, 132, 132)
      g.fillStyle = glow ? '#000' : P.trim
      g.font = `800 112px 'Pretendard Variable', Pretendard, Arial, sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText('H', 102, 102)
      g.fillStyle = '#ffffff'
      g.textAlign = 'left'
      g.font = `800 128px 'Pretendard Variable', Pretendard, Arial, sans-serif`
      g.fillText('HUMAN', 206, 104)
    }
    const map = canvasTex(1024, 192, (g) => draw(g, false))
    const glow = canvasTex(1024, 192, (g) => draw(g, true))
    // 웹폰트가 늦게 로드되면 다시 그린다
    document.fonts?.ready.then(() => {
      draw((map.image as HTMLCanvasElement).getContext('2d')!, false)
      draw((glow.image as HTMLCanvasElement).getContext('2d')!, true)
      map.needsUpdate = true
      glow.needsUpdate = true
    })
    return { map, glow }
  }, [])
}

const tmp = new THREE.Object3D()

export function Building({ site }: { site: Site }) {
  const Lg = site.layout
  const W = Lg.wall
  const key = site.cfg.id
  const dockXs = Lg.dockXs

  // ── 벽 (골판, 한 지오메트리) ──
  const wallGeo = useMemo(() => {
    const t = 0.24
    const dockHoles = dockXs.map((x) => ({ a: x - DOOR_W / 2 - 0.15, b: x + DOOR_W / 2 + 0.15, top: DOOR_H }))
    const ped = [{ a: Lg.corridorZ - 1.3, b: Lg.corridorZ + 1.3, top: 2.6 }]
    const parts = [
      ...wallRun('x', W.z0, W.x0 - t / 2, W.x1 + t / 2, [], t),
      ...wallRun('x', W.z1, W.x0 - t / 2, W.x1 + t / 2, dockHoles, t),
      ...wallRun('z', W.x0, W.z0, W.z1, ped, t),
      ...wallRun('z', W.x1, W.z0, W.z1, [], t),
    ]
    const g = mergeGeometries(parts, false)!
    g.computeBoundingSphere()
    return g
  }, [Lg, W, dockXs])
  const wallMat = useMemo(() => new THREE.MeshStandardMaterial({ map: ribTexture(), roughness: 0.7, metalness: 0.05 }), [])

  // ── 벽 장식: 하부 콘크리트 띠, 상부 테두리, 출입문 틀, 도크 셸터·범퍼·감김통 ──
  const trimGeo = merged(`bld-trim-${key}`, () => {
    const parts: Part[] = []
    const t = 0.34
    const band = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, color: string) =>
      parts.push({ geo: box(Math.max(0.01, x1 - x0), y1 - y0, Math.max(0.01, z1 - z0)), pos: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], color })
    // 상부 테두리 (지붕선)
    band(W.x0 - 0.2, W.x1 + 0.2, W.z0 - 0.2, W.z0 + 0.2, WALL_H - 0.45, WALL_H, P.trim)
    band(W.x0 - 0.2, W.x1 + 0.2, W.z1 - 0.2, W.z1 + 0.2, WALL_H - 0.45, WALL_H, P.trim)
    band(W.x0 - 0.2, W.x0 + 0.2, W.z0, W.z1, WALL_H - 0.45, WALL_H, P.trim)
    band(W.x1 - 0.2, W.x1 + 0.2, W.z0, W.z1, WALL_H - 0.45, WALL_H, P.trim)
    // 하부 콘크리트 띠 (개구부 제외)
    band(W.x0 - t / 2, W.x1 + t / 2, W.z0 - t / 2, W.z0 + t / 2, 0, 1.0, P.plinth)
    band(W.x1 - t / 2, W.x1 + t / 2, W.z0, W.z1, 0, 1.0, P.plinth)
    band(W.x0 - t / 2, W.x0 + t / 2, W.z0, Lg.corridorZ - 1.3, 0, 1.0, P.plinth)
    band(W.x0 - t / 2, W.x0 + t / 2, Lg.corridorZ + 1.3, W.z1, 0, 1.0, P.plinth)
    let cur = W.x0
    for (const x of dockXs) {
      band(cur, x - DOOR_W / 2 - 0.15, W.z1 - t / 2, W.z1 + t / 2, 0, 1.0, P.plinth)
      cur = x + DOOR_W / 2 + 0.15
    }
    band(cur, W.x1, W.z1 - t / 2, W.z1 + t / 2, 0, 1.0, P.plinth)
    // 보행자 출입문 틀 + 차양
    const pz = Lg.corridorZ
    band(W.x0 - 0.2, W.x0 + 0.2, pz - 1.45, pz - 1.25, 0, 2.7, P.frame)
    band(W.x0 - 0.2, W.x0 + 0.2, pz + 1.25, pz + 1.45, 0, 2.7, P.frame)
    band(W.x0 - 0.2, W.x0 + 0.2, pz - 1.45, pz + 1.45, 2.55, 2.75, P.frame)
    band(W.x0 - 1.6, W.x0 - 0.12, pz - 1.9, pz + 1.9, 3.05, 3.2, P.trim)
    for (const x of dockXs) {
      // 셸터: 트레일러 뒤를 감싸는 검은 패드 (트레일러 폭 2.5보다 넓게)
      band(x - 2.15, x - 1.8, W.z1 + 0.12, W.z1 + 0.62, 0.9, DOOR_H + 0.35, P.shelter)
      band(x + 1.8, x + 2.15, W.z1 + 0.12, W.z1 + 0.62, 0.9, DOOR_H + 0.35, P.shelter)
      band(x - 2.15, x + 2.15, W.z1 + 0.12, W.z1 + 0.62, DOOR_H + 0.1, DOOR_H + 0.75, P.shelter)
      // 문틀
      band(x - DOOR_W / 2 - 0.15, x - DOOR_W / 2, W.z1 - 0.15, W.z1 + 0.15, 0, DOOR_H, P.frame)
      band(x + DOOR_W / 2, x + DOOR_W / 2 + 0.15, W.z1 - 0.15, W.z1 + 0.15, 0, DOOR_H, P.frame)
      // 감김통 (안쪽 상단)
      band(x - DOOR_W / 2, x + DOOR_W / 2, W.z1 - 0.65, W.z1 - 0.15, DOOR_H - 0.05, DOOR_H + 0.45, '#8C939D')
      // 노랑·검정 범퍼
      for (const s of [-1, 1]) {
        const bx = x + s * 1.0
        band(bx - 0.17, bx + 0.17, W.z1 + 0.12, W.z1 + 0.3, 0.75, 0.95, P.hazard)
        band(bx - 0.17, bx + 0.17, W.z1 + 0.12, W.z1 + 0.3, 0.95, 1.12, P.ink)
        band(bx - 0.17, bx + 0.17, W.z1 + 0.12, W.z1 + 0.3, 1.12, 1.32, P.hazard)
      }
      // 레벨러 앞 노랑 경고 띠 (벽 하부)
      band(x - DOOR_W / 2, x + DOOR_W / 2, W.z1 + 0.15, W.z1 + 0.2, 0.0, 0.12, P.hazard)
    }
    return parts
  })

  // ── 창 띠: 북·동·서 벽 (밤에 켜짐) ──
  const windowGeo = merged(`bld-win-${key}`, () => {
    const parts: Part[] = []
    const y = 6.1
    const run = (axis: 'x' | 'z', fixed: number, a: number, b: number) => {
      for (let p = a + 1.5; p + 2.4 < b - 1.5; p += 3.2) {
        const c = p + 1.2
        parts.push(axis === 'x' ? { geo: box(2.4, 1.1, 0.32), pos: [c, y, fixed], color: '#fff' } : { geo: box(0.32, 1.1, 2.4), pos: [fixed, y, c], color: '#fff' })
      }
    }
    run('x', W.z0, W.x0, W.x1)
    run('z', W.x0, W.z0, W.z1)
    run('z', W.x1, W.z0, W.z1)
    // 남측 벽은 도크 문 사이 위쪽에 작은 창
    for (let i = 0; i < dockXs.length - 1; i++) {
      const c = (dockXs[i] + dockXs[i + 1]) / 2
      parts.push({ geo: box(1.0, 0.7, 0.32), pos: [c, 6.4, W.z1], color: '#fff' })
    }
    return parts
  })

  // ── 벽등: 도크마다 (밤에 켜짐) ──
  const lampGeo = merged(`bld-lamps-${key}`, () => dockXs.map((x) => ({ geo: box(0.7, 0.18, 0.5), pos: [x - 1.1, 6.0, W.z1 + 0.35] as V3, color: '#fff' })))

  // ── 간판 ──
  const sign = useSignTextures()
  // 동쪽 벽 (기본 카메라가 보는 면, 도크 라벨과 겹치지 않음) 창 띠 위
  const signH = Math.min(2.1, Lg.depth * 0.05)
  const signW = (signH * 1024) / 192
  const signMat = useMemo(() => {
    const m = nightMats.sign
    m.map = sign.map
    m.emissiveMap = sign.glow
    m.needsUpdate = true
    return m
  }, [sign])

  // ── 지붕: 덱·파라펫·톱니 천창·옥상 설비 ──
  const roofTop = WALL_H + 0.35
  const monitors = useMemo(() => {
    const out: number[] = []
    for (let z = W.z1 - 5; z - 3.4 > W.z0 + 3; z -= 8) out.push(z)
    return out
  }, [W])
  const mx0 = W.x0 + 7
  const mx1 = W.x1 - 7
  const roofGeo = merged(`bld-roof-${key}`, () => {
    const parts: Part[] = []
    const w = Lg.width
    const d = Lg.depth
    const cz = (W.z0 + W.z1) / 2
    parts.push({ geo: box(w + 0.5, 0.35, d + 0.5), pos: [0, WALL_H + 0.175, cz], color: P.roofDeck })
    // 파라펫
    parts.push({ geo: box(w + 0.6, 0.7, 0.3), pos: [0, roofTop + 0.35, W.z0 - 0.1], color: P.trim })
    parts.push({ geo: box(w + 0.6, 0.7, 0.3), pos: [0, roofTop + 0.35, W.z1 + 0.1], color: P.trim })
    parts.push({ geo: box(0.3, 0.7, d + 0.5), pos: [W.x0 - 0.1, roofTop + 0.35, cz], color: P.trim })
    parts.push({ geo: box(0.3, 0.7, d + 0.5), pos: [W.x1 + 0.1, roofTop + 0.35, cz], color: P.trim })
    // 톱니: 북쪽이 낮고 남쪽 끝이 높은 경사판 (남쪽 수직면 = 천창)
    const run = 3.4
    const rise = 1.5
    const hyp = Math.hypot(run, rise)
    const ang = Math.atan2(rise, run)
    for (const z of monitors) {
      parts.push({ geo: box(mx1 - mx0, 0.12, hyp), pos: [(mx0 + mx1) / 2, roofTop + rise / 2, z - run / 2], rot: [-ang, 0, 0], color: P.roof })
      // 양 끝 막음판
      for (const x of [mx0, mx1]) parts.push({ geo: box(0.12, rise, run), pos: [x, roofTop + rise / 2, z - run / 2], color: P.roof })
    }
    // 옥상 설비: 천창 줄 사이 양 끝에 공조기
    const gaps = monitors.slice(0, -1).map((z, i) => (z - run + monitors[i + 1]) / 2)
    for (const z of gaps.length ? gaps : [(W.z0 + W.z1) / 2])
      for (const x of [W.x0 + 3.4, W.x1 - 3.4]) {
        parts.push({ geo: box(2.6, 1.2, 1.9), pos: [x, roofTop + 0.6, z], color: '#C9CED6' })
        parts.push({ geo: cyl(0.62, 0.16, 16), pos: [x - 0.55, roofTop + 1.26, z], color: '#3A3F47' })
        parts.push({ geo: cyl(0.62, 0.16, 16), pos: [x + 0.65, roofTop + 1.26, z], color: '#3A3F47' })
      }
    // 배기 팬 (경사판 위 작은 원통)
    for (let i = 0; i < monitors.length; i += 2)
      for (let x = mx0 + 10; x < mx1 - 6; x += 22) parts.push({ geo: cyl(0.45, 0.7, 12), pos: [x, roofTop + 0.35, monitors[i] - 4.8], color: '#B9C0CA' })
    return parts
  })
  const glassGeo = merged(`bld-sky-${key}`, () => monitors.map((z) => ({ geo: box(mx1 - mx0, 1.5, 0.08), pos: [(mx0 + mx1) / 2, roofTop + 0.75, z] as V3, color: '#fff' })))
  const roofMat = useMemo(() => {
    const m = vcMat.clone()
    m.roughness = 0.8
    return m
  }, [])

  // ── 롤업 도어 (도크마다 인스턴스 1개, 열림 정도로 높이 조절) ──
  const doorRef = useRef<THREE.InstancedMesh>(null)
  const doorGeo = useMemo(() => {
    const g = new THREE.BoxGeometry(DOOR_W, 1, 0.08)
    g.translate(0, -0.5, 0) // 원점 = 문 위쪽
    return g
  }, [])
  const doorMat = useMemo(() => new THREE.MeshStandardMaterial({ map: slatTexture(), roughness: 0.6, metalness: 0.15 }), [])
  const openAmt = useRef<number[]>([])

  // ── 단면 보기 ──
  const shellRef = useRef<THREE.Group>(null)
  const roofRef = useRef<THREE.Group>(null)
  const [cutOn, setCutOn] = useState(false)
  const cutNow = useRef(0)
  const wantCut = useRef(false)
  const baseDist = 104 * Math.max(1, Lg.width / 58)

  useLayoutEffect(() => {
    openAmt.current = dockXs.map(() => 0)
    const m = doorRef.current
    if (!m) return
    dockXs.forEach((x, i) => {
      tmp.position.set(x, DOOR_H, W.z1 + 0.02)
      tmp.scale.set(1, DOOR_H, 1)
      tmp.updateMatrix()
      m.setMatrixAt(i, tmp.matrix)
    })
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [dockXs, W])

  useFrame((state, dt) => {
    const ui = useUi.getState()
    // 자동: 확대했거나, 무언가를 골랐거나, 재고·동선 모드일 때 단면
    if (ui.buildingMode === 'auto') {
      const dist = state.camera.position.distanceTo((state.controls as unknown as { target: THREE.Vector3 } | null)?.target ?? new THREE.Vector3())
      const zoomed = wantCut.current ? dist < baseDist * 0.8 : dist < baseDist * 0.7
      wantCut.current = zoomed || ui.sel != null || ui.viewMode !== 'base'
    } else wantCut.current = ui.buildingMode === 'inside'
    const target = wantCut.current ? 1 : 0
    const step = Math.min(1, dt * 2.6)
    cutNow.current += Math.sign(target - cutNow.current) * Math.min(Math.abs(target - cutNow.current), step)
    const c = cutNow.current
    const e = c * c * (3 - 2 * c)
    shell.cut = e
    shell.sink = e * (WALL_H - LEFT_H)
    if (shellRef.current) shellRef.current.position.y = -shell.sink
    if (roofRef.current) {
      roofRef.current.position.y = e * 16
      roofRef.current.visible = e < 0.999
    }
    const fade = e > 0.001
    roofMat.transparent = fade
    roofMat.opacity = 1 - e
    roofMat.depthWrite = !fade
    nightMats.skylight.transparent = fade
    nightMats.skylight.opacity = 1 - e
    if ((e > 0.5) !== cutOn) setCutOn(e > 0.5)

    // 도크 문: 트럭이 접안을 시작하면 열리고, 떠나면 닫힌다
    const m = doorRef.current
    if (!m) return
    let dirty = false
    site.docks.forEach((d, i) => {
      const tr = d.truckId ? site.trucks.get(d.truckId) : undefined
      const open = !!tr && (tr.phase === 'docking' || tr.phase === 'docked')
      const cur = openAmt.current[i] ?? 0
      const nxt = cur + Math.sign((open ? 1 : 0) - cur) * Math.min(Math.abs((open ? 1 : 0) - cur), dt * 1.4)
      if (nxt === cur) return
      openAmt.current[i] = nxt
      tmp.position.set(d.x, DOOR_H, W.z1 + 0.02)
      tmp.scale.set(1, Math.max(0.25, DOOR_H * (1 - nxt)), 1)
      tmp.updateMatrix()
      m.setMatrixAt(i, tmp.matrix)
      dirty = true
    })
    if (dirty) m.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <group ref={shellRef}>
        <mesh geometry={wallGeo} material={wallMat} castShadow receiveShadow />
        <mesh geometry={trimGeo} material={vcMat} castShadow receiveShadow />
        <mesh geometry={windowGeo} material={nightMats.window} />
        <mesh geometry={lampGeo} material={nightMats.lampHead} />
        <instancedMesh ref={doorRef} args={[doorGeo, doorMat, dockXs.length]} castShadow receiveShadow />
        <mesh position={[W.x1 + 0.16, 7.7, (W.z0 + W.z1) / 2]} rotation-y={Math.PI / 2} material={signMat}>
          <planeGeometry args={[signW, signH]} />
        </mesh>
      </group>
      <group ref={roofRef}>
        <mesh geometry={roofGeo} material={roofMat} castShadow receiveShadow />
        <mesh geometry={glassGeo} material={nightMats.skylight} />
      </group>
      {/* 랙 열 라벨은 안이 보일 때만 */}
      {cutOn &&
        Lg.rows.map((r) => (
          <Html key={r.idx} position={[Lg.sectionX0[0] - 1.4, L.RACK_H + 0.4, r.z]} center zIndexRange={[10, 0]}>
            <div className="tag3d tag3d--row">{r.letter}</div>
          </Html>
        ))}
    </group>
  )
}
