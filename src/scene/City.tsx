// 캠퍼스 바깥 도시: 도로·보도·차선·횡단보도, 구역 바닥, 건물(창 격자 외벽), 옥상·상가 차양·창고 하역문,
// 가로등·신호등, 주차 차량과 도로를 오가는 일반 차량. 가로수는 Surroundings의 나무에 합쳐진다
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Site } from '../sim/engine'
import { Rng } from '../sim/rng'
import { useUi } from '../store'
import { P } from './palette'
import { nightMats } from './nightMats'
import { box, cyl, merged, vcMat, vcMatMatte, type Part } from './merge'
import { cityPlan, CITY_CARS, type Bldg, type CityPlan, type Road } from './cityPlan'
import { carPose, lanesOf, spawnCars, stepCars } from './cityTraffic'

type V3 = [number, number, number]
const SIDEWALK = 2.6
const MAIN_Z0 = 30.4
const MAIN_Z1 = 43.2
const BAY = 3 // 창 한 칸 폭
const TILE = 4 // 텍스처 한 장 = 4칸 × 4층
const FLOOR = { punch: 2.9, ribbon: 3.6, plain: 3, curtain: 3.8 } as const

// ── 외벽 텍스처: 4칸 × 4층 한 장. 바닥 쪽 행은 벽이라 지붕면 UV를 그 자리에 둔다 ──
function canvas(draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  return t
}
let tex: { punch: THREE.Texture; punchLit: THREE.Texture; ribbon: THREE.Texture; ribbonLit: THREE.Texture; curtain: THREE.Texture; curtainLit: THREE.Texture } | null = null
function textures() {
  if (tex) return tex
  const r = new Rng(91)
  const lit = Array.from({ length: 16 }, () => r.chance(0.42))
  const punch = canvas((g) => {
    g.fillStyle = '#F2F2F0'
    g.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const x = i * 64
        const y = j * 64
        g.fillStyle = '#D5D9DE'
        g.fillRect(x, y + 6, 64, 3) // 층 슬래브 선
        g.fillStyle = '#5D7189'
        g.fillRect(x + 12, y + 14, 40, 28)
        g.fillStyle = '#8FA2B6'
        g.fillRect(x + 12, y + 14, 40, 5)
      }
  })
  const punchLit = canvas((g) => {
    g.fillStyle = '#000'
    g.fillRect(0, 0, 256, 256)
    g.fillStyle = '#fff'
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (lit[i * 4 + j]) g.fillRect(i * 64 + 12, j * 64 + 14, 40, 28)
  })
  const ribbon = canvas((g) => {
    g.fillStyle = '#E7EAEE'
    g.fillRect(0, 0, 256, 256)
    for (let j = 0; j < 4; j++) {
      const y = j * 64
      g.fillStyle = '#8EA9C2'
      g.fillRect(0, y + 4, 256, 40)
      g.fillStyle = '#B4C7D8'
      g.fillRect(0, y + 4, 256, 6)
      g.fillStyle = '#E2E7EC'
      for (let x = 0; x < 256; x += 32) g.fillRect(x, y + 4, 3, 40)
    }
  })
  const ribbonLit = canvas((g) => {
    g.fillStyle = '#000'
    g.fillRect(0, 0, 256, 256)
    g.fillStyle = '#fff'
    for (let j = 0; j < 4; j++) for (let x = 0; x < 256; x += 32) if (r.chance(0.5)) g.fillRect(x + 3, j * 64 + 4, 29, 40)
  })
  // 유리 커튼월: 층마다 얇은 스팬드럴, 칸마다 가는 멀리언, 하늘이 비치는 위아래 그라데이션
  const curtain = canvas((g) => {
    const grd = g.createLinearGradient(0, 0, 0, 64)
    grd.addColorStop(0, '#B9D0E4')
    grd.addColorStop(1, '#8FAECB')
    for (let j = 0; j < 4; j++) {
      g.fillStyle = grd
      g.save()
      g.translate(0, j * 64)
      g.fillRect(0, 0, 256, 64)
      g.restore()
      g.fillStyle = '#E6ECF2'
      g.fillRect(0, j * 64, 256, 5)
    }
    g.fillStyle = '#DCE3EA'
    for (let x = 0; x < 256; x += 32) g.fillRect(x, 0, 2, 256)
  })
  const curtainLit = canvas((g) => {
    g.fillStyle = '#000'
    g.fillRect(0, 0, 256, 256)
    g.fillStyle = '#fff'
    for (let j = 0; j < 4; j++) for (let x = 0; x < 256; x += 32) if (r.chance(0.45)) g.fillRect(x + 2, j * 64 + 5, 30, 59)
  })
  tex = { punch, punchLit, ribbon, ribbonLit, curtain, curtainLit }
  nightMats.cityCurtain.map = curtain
  nightMats.cityCurtain.emissiveMap = curtainLit
  nightMats.cityCurtain.needsUpdate = true
  nightMats.cityPunch.map = punch
  nightMats.cityPunch.emissiveMap = punchLit
  nightMats.cityPunch.needsUpdate = true
  nightMats.cityRibbon.map = ribbon
  nightMats.cityRibbon.emissiveMap = ribbonLit
  nightMats.cityRibbon.needsUpdate = true
  return tex
}

const col = new THREE.Color()
const m4 = new THREE.Matrix4()
const q = new THREE.Quaternion()
const up = new THREE.Vector3(0, 1, 0)
const one = new THREE.Vector3(1, 1, 1)
const v = new THREE.Vector3()

// 건물 외벽 상자: 로컬 크기로 UV를 펴서(창 크기 일정) 회전·이동 후 정점 색을 칠한다
function facadeBox(b: Bldg, y0: number, y1: number, color: string): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(b.w, y1 - y0, b.d)
  g.translate(0, (y0 + y1) / 2, 0)
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  const uv = g.getAttribute('uv')
  const fh = FLOOR[b.facade]
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(nor.getY(i)) > 0.5) {
      uv.setXY(i, 0.01, 0.01) // 지붕·바닥면 = 벽 색 한 점
      continue
    }
    const along = Math.abs(nor.getX(i)) > 0.5 ? pos.getZ(i) : pos.getX(i)
    uv.setXY(i, along / (BAY * TILE), pos.getY(i) / (fh * TILE))
  }
  g.applyMatrix4(m4.compose(v.set(b.x, 0, b.z), q.setFromAxisAngle(up, b.rot), one))
  col.set(color)
  const c = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) c.set([col.r, col.g, col.b], i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(c, 3))
  return g
}

// 건물 기준 로컬 좌표 → 월드 (회전 포함)
function at(b: Bldg, lx: number, ly: number, lz: number): V3 {
  const c = Math.cos(b.rot)
  const s = Math.sin(b.rot)
  return [b.x + lx * c + lz * s, ly, b.z - lx * s + lz * c]
}

// 박공지붕·톱니지붕용 삼각 기둥: 바닥 폭 d(z), 높이 rh, 길이 w(x). 바닥 중심이 원점
function prism(w: number, d: number, rh: number, apex = 0.5): THREE.BufferGeometry {
  const sh = new THREE.Shape()
  sh.moveTo(-d / 2, 0)
  sh.lineTo(d / 2, 0)
  sh.lineTo(-d / 2 + d * apex, rh)
  sh.closePath()
  const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false })
  g.translate(0, 0, -w / 2)
  g.rotateY(Math.PI / 2)
  return g
}

// 경기장 관중석: 안쪽이 낮고 바깥이 높은 고리 (단면을 돌려 만든 뒤 타원으로 늘림)
function bowl(w: number, d: number, h: number): THREE.BufferGeometry {
  const pts = [new THREE.Vector2(0.64, 0), new THREE.Vector2(1.0, 0), new THREE.Vector2(1.0, h), new THREE.Vector2(0.98, h), new THREE.Vector2(0.64, 0.8)]
  const g = new THREE.LatheGeometry(pts, 40)
  g.scale(w / 2, 1, d / 2)
  return g
}

// 맨 위 층(들여 쌓기 포함)의 크기와 높이
const top = (b: Bldg) => (b.tiers?.length ? b.tiers[b.tiers.length - 1] : { w: b.w, d: b.d, h: b.h })

// 외벽이 따로 없고 부속으로만 그리는 건물
const NO_WALL = new Set(['school', 'stadium', 'gas', 'tank', 'parkade', 'church'])

function buildingParts(plan: CityPlan, seed: number): Part[] {
  const r = new Rng(seed)
  const parts: Part[] = []
  const add = (b: Bldg, w: number, h: number, d: number, lx: number, ly: number, lz: number, color: string) =>
    parts.push({ geo: box(w, h, d), pos: at(b, lx, ly, lz), rot: [0, b.rot, 0], color })
  const geo = (b: Bldg, g: THREE.BufferGeometry, lx: number, ly: number, lz: number, color: string, ry = 0) => parts.push({ geo: g, pos: at(b, lx, ly, lz), rot: [0, b.rot + ry, 0], color })
  for (const b of plan.bldgs) {
    const T = top(b)
    if (b.kind === 'house') {
      // 단독주택: 박공지붕(처마 조금 내밀기) + 굴뚝
      geo(b, prism(b.w + 0.8, b.d + 0.8, 2.6), 0, b.h, 0, b.roof)
      if (r.chance(0.5)) add(b, 0.6, 1.8, 0.6, b.w * 0.25, b.h + 1.6, -b.d * 0.2, '#8A8F96')
      add(b, 1.2, 2.1, 0.1, 0, 1.05, b.d / 2 + 0.05, '#6E5A4C') // 현관문
      continue
    }
    if (b.kind === 'church') {
      // 예배당: 벽 + 박공지붕 + 앞쪽 종탑과 첨탑
      add(b, b.w, b.h, b.d, 0, b.h / 2, 0, b.color)
      geo(b, prism(b.d + 0.6, b.w + 0.8, 5), 0, b.h, 0, b.roof, Math.PI / 2)
      add(b, 4.4, b.h + 9, 4.4, 0, (b.h + 9) / 2, b.d / 2 + 1.6, b.color)
      parts.push({ geo: new THREE.ConeGeometry(3, 9, 4), pos: at(b, 0, b.h + 13.5, b.d / 2 + 1.6), rot: [0, b.rot + Math.PI / 4, 0], color: b.roof })
      add(b, 0.25, 2.2, 0.25, 0, b.h + 19, b.d / 2 + 1.6, '#E9E4D8')
      add(b, 1.2, 0.25, 0.25, 0, b.h + 19.4, b.d / 2 + 1.6, '#E9E4D8')
      for (const s of [-1, 1]) for (let k = 0; k < 4; k++) add(b, 0.1, 3.2, 1.4, s * (b.w / 2 + 0.05), 4.5, -b.d / 2 + 4 + k * 5.5, '#5D7189')
      continue
    }
    if (b.kind === 'school') {
      // 운동장: 트랙 + 잔디 + 흰 선 + 골대
      add(b, b.w, 0.06, b.d, 0, 0.02, 0, '#B9785A')
      add(b, b.w - 7, 0.07, b.d - 7, 0, 0.03, 0, '#6DB35A')
      add(b, 0.15, 0.08, b.d - 7, 0, 0.04, 0, '#F4F4EF')
      for (const s of [-1, 1]) {
        add(b, 0.15, 2.2, 6, s * (b.w / 2 - 4.5), 1.1, 0, '#F4F4EF')
        add(b, b.w - 2, 0.08, 0.12, 0, 0.04, s * (b.d / 2 - 1.8), '#F4F4EF')
      }
      add(b, 0.12, 9, 0.12, -b.w / 2 + 1, 4.5, -b.d / 2 + 1, '#C3C9D0')
      continue
    }
    if (b.kind === 'stadium') {
      // 경기장: 관중석 고리 + 잔디 구장 + 조명탑 4개
      parts.push({ geo: bowl(b.w, b.d, b.h), pos: [b.x, 0, b.z], color: b.color })
      const field = new THREE.CircleGeometry(1, 40)
      field.rotateX(-Math.PI / 2)
      field.scale(b.w * 0.32, 1, b.d * 0.32)
      parts.push({ geo: field, pos: [b.x, 0.05, b.z], color: '#5FA94F' })
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        add(b, 0.6, 24, 0.6, sx * b.w * 0.42, 12, sz * b.d * 0.42, '#C3C9D0')
        add(b, 3, 1.6, 0.4, sx * b.w * 0.42, 24, sz * b.d * 0.42, '#F4F4EF')
      }
      continue
    }
    if (b.kind === 'gas') {
      // 주유소: 기둥 4개 위 캐노피 + 주유기 + 뒤쪽 편의점
      add(b, b.w, 0.7, b.d * 0.7, 0, b.h, 2, '#F4F5F7')
      add(b, b.w + 0.1, 0.35, b.d * 0.7 + 0.1, 0, b.h - 0.2, 2, b.roof)
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(b, 0.4, b.h, 0.4, sx * (b.w / 2 - 2), b.h / 2, 2 + sz * (b.d * 0.35 - 1.5), '#D5DAE1')
      for (let k = -1; k <= 1; k++) {
        add(b, 1, 0.25, 3, k * 6, 0.12, 2, '#C3C9D0')
        add(b, 0.7, 1.6, 0.6, k * 6, 1.0, 2, '#2F62E8')
      }
      add(b, 12, 3.6, 6, 0, 1.8, -b.d / 2 - 2, '#EEF0F2')
      add(b, 12.1, 0.6, 6.1, 0, 3.3, -b.d / 2 - 2, b.roof)
      continue
    }
    if (b.kind === 'tank') {
      // 저장탱크: 원통 + 낮은 돔 + 옆 사다리
      parts.push({ geo: cyl(b.w / 2, b.h, 20), pos: [b.x, b.h / 2, b.z], color: b.color })
      const dome = new THREE.SphereGeometry(b.w / 2, 20, 6, 0, Math.PI * 2, 0, Math.PI / 5)
      dome.translate(0, -(b.w / 2) * Math.cos(Math.PI / 5), 0)
      parts.push({ geo: dome, pos: [b.x, b.h, b.z], color: b.roof })
      add(b, 0.5, b.h, 0.2, 0, b.h / 2, b.d / 2 + 0.1, '#8A9099')
      add(b, b.w + 0.04, 0.6, b.d + 0.04, 0, 2.2, 0, '#2F62E8')
      continue
    }
    if (b.kind === 'parkade') {
      // 주차빌딩: 3m마다 바닥판, 낮은 난간, 기둥. 층 사이로 주차 차량이 보인다
      const levels = Math.round(b.h / 3)
      for (let k = 0; k <= levels; k++) {
        add(b, b.w, 0.4, b.d, 0, k * 3 + 0.2, 0, k === levels ? b.roof : b.color)
        if (k > 0) for (const s of [-1, 1]) add(b, b.w, 1.0, 0.2, 0, k * 3 + 0.9, s * (b.d / 2 - 0.1), '#B7BDC5')
      }
      for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) add(b, 0.6, b.h, 0.6, sx * (b.w / 2 - 0.5), b.h / 2, sz * (b.d / 2 - 0.5), '#B7BDC5')
      for (let k = 0; k < levels; k++)
        for (let x = -b.w / 2 + 2; x < b.w / 2 - 2; x += 2.8)
          if (r.chance(0.5)) {
            add(b, 1.7, 0.7, 4, x, k * 3 + 0.75, -b.d / 4, r.pick(CITY_CARS))
            if (r.chance(0.5)) add(b, 1.7, 0.7, 4, x, k * 3 + 0.75, b.d / 4, r.pick(CITY_CARS))
          }
      continue
    }
    // 들여 쌓은 층마다 지붕 테두리, 맨 위에만 옥상 설비
    const tiers = b.tiers ?? [{ w: b.w, d: b.d, h: b.h }]
    for (const t of tiers) add(b, t.w + 0.3, 0.45, t.d + 0.3, 0, t.h + 0.2, 0, b.roof)
    if (b.kind === 'factory') {
      // 공장: 지붕 위 톱니 채광창 줄 + 굴뚝 + 옆 사일로
      const n = Math.max(2, Math.floor(b.d / 9))
      for (let k = 0; k < n; k++) geo(b, prism(b.w - 1, b.d / n, 3.2, 0.95), 0, b.h + 0.4, -b.d / 2 + (k + 0.5) * (b.d / n), b.roof)
      const nc = r.int(1, 3)
      for (let k = 0; k < nc; k++) {
        const lx = -b.w / 2 + 4 + k * 5
        parts.push({ geo: cyl(1.1, 26, 12), pos: at(b, lx, b.h + 13, b.d / 2 - 4), color: '#D9DCE0' })
        parts.push({ geo: cyl(1.15, 2.4, 12), pos: at(b, lx, b.h + 24, b.d / 2 - 4), color: '#46536B' })
      }
      for (let k = 0; k < 3; k++) parts.push({ geo: cyl(2.3, 15, 16), pos: at(b, -b.w / 2 - 2.8, 7.5, -b.d / 2 + 4 + k * 5.2), color: '#E3E6EA' })
      add(b, b.w + 0.04, 1.2, b.d + 0.04, 0, 0.6, 0, '#AEB5BE')
      continue
    }
    if (b.kind === 'mall') {
      // 쇼핑몰: 남쪽 정면 유리 입구 + 큰 간판 띠 + 차양
      add(b, b.w * 0.5, 6, 0.2, 0, 3, b.d / 2 + 0.1, '#33475C')
      add(b, b.w + 0.1, 2.2, b.d + 0.1, 0, b.h - 1.6, 0, b.accent ?? '#2F62E8')
      add(b, b.w * 0.56, 0.3, 3, 0, 6.2, b.d / 2 + 1.5, '#F4F5F7')
      for (let k = 0; k < 6; k++) add(b, r.range(2, 4), 1.4, r.range(2, 4), r.range(-b.w / 2 + 4, b.w / 2 - 4), b.h + 1, r.range(-b.d / 2 + 4, b.d / 2 - 4), '#C3C9D0')
      continue
    }
    const units = Math.min(4, Math.floor((T.w * T.d) / 260))
    for (let k = 0; k < units; k++) add(b, r.range(1.6, 3.2), r.range(0.9, 1.6), r.range(1.4, 2.6), r.range(-T.w / 2 + 2, T.w / 2 - 2), T.h + 0.9, r.range(-T.d / 2 + 2, T.d / 2 - 2), '#C3C9D0')
    if (b.kind === 'tower' && b.facade === 'curtain') {
      // 유리 타워: 꼭대기 왕관 + 헬기장 + 안테나
      add(b, T.w * 0.7, 3.6, T.d * 0.7, 0, T.h + 2, 0, '#9AA2AB')
      add(b, T.w * 0.5, 0.15, T.d * 0.5, 0, T.h + 3.9, 0, '#3A3F47')
      add(b, 0.6, 0.18, 4, -1.2, T.h + 4, 0, '#F4F4EF')
      add(b, 0.6, 0.18, 4, 1.2, T.h + 4, 0, '#F4F4EF')
      add(b, 2.4, 0.18, 0.6, 0, T.h + 4, 0, '#F4F4EF')
      parts.push({ geo: cyl(0.15, 14, 6), pos: at(b, T.w * 0.3, T.h + 10, T.d * 0.3), color: '#C3C9D0' })
      continue
    }
    if (b.kind === 'hotel') {
      // 호텔: 꼭대기 색 왕관 + 저층부 정면 차양
      add(b, T.w + 0.2, 4.5, T.d + 0.2, 0, T.h - 1.6, 0, b.accent ?? '#46536B')
      add(b, T.w * 0.4, 6, T.d * 0.4, 0, T.h + 3, 0, b.accent ?? '#46536B')
      add(b, b.w * 0.4, 0.3, 3.4, 0, 4.2, b.d / 2 + 1.7, b.accent ?? '#46536B')
      continue
    }
    if (b.kind === 'hospital') {
      // 병원: 병동 꼭대기 헬기장(H) + 저층부 청록 띠
      add(b, T.w * 0.6, 0.15, T.w * 0.6, 0, T.h + 0.5, 0, '#3A3F47')
      add(b, 0.7, 0.18, 4.4, -1.4, T.h + 0.6, 0, '#F4F4EF')
      add(b, 0.7, 0.18, 4.4, 1.4, T.h + 0.6, 0, '#F4F4EF')
      add(b, 2.8, 0.18, 0.7, 0, T.h + 0.6, 0, '#F4F4EF')
      add(b, b.w + 0.06, 1.2, b.d + 0.06, 0, 6.6, 0, b.accent ?? '#1499AE')
      continue
    }
    if (b.kind === 'tower' && b.accent) {
      // 탑상형 아파트: 꼭대기 색 띠 + 모서리 세로 띠 + 옥탑
      add(b, b.w + 0.06, 3, b.d + 0.06, 0, b.h - 1.6, 0, b.accent)
      for (const sx of [-1, 1]) add(b, 0.14, b.h - 3.2, b.d * 0.3, sx * (b.w / 2 + 0.05), (b.h - 3.2) / 2, b.d * 0.35, b.accent)
      add(b, b.w * 0.4, 4, b.d * 0.4, 0, b.h + 2, 0, b.color)
      continue
    }
    if (b.facade === 'punch' && b.accent) {
      // 아파트: 꼭대기 두 층 색 띠 + 양쪽 측벽 색
      add(b, b.w + 0.06, 2.4, b.d + 0.06, 0, b.h - 1.6, 0, b.accent)
      add(b, 0.12, b.h - 3, b.d * 0.7, b.w / 2 + 0.04, (b.h - 3) / 2, 0, b.accent)
      add(b, 0.12, b.h - 3, b.d * 0.7, -b.w / 2 - 0.04, (b.h - 3) / 2, 0, b.accent)
      add(b, 3.2, 3.2, 1.2, 0, b.h + 1.6, 0, b.color) // 옥탑
    }
    if (b.shop) {
      // 1층 상가: 진한 유리 진열창 + 차양 (앞뒤 두 면)
      for (const s of [-1, 1]) {
        add(b, b.w - 0.6, 3.0, 0.12, 0, 1.6, s * (b.d / 2 + 0.05), '#33475C')
        add(b, b.w - 0.4, 0.18, 1.5, 0, 3.35, s * (b.d / 2 + 0.75), b.shop)
      }
    }
    if (b.docks) {
      // 물류창고: 하부 띠 + 남쪽 하역문 줄
      add(b, b.w + 0.04, 1.2, b.d + 0.04, 0, 0.6, 0, '#AEB5BE')
      const n = Math.max(2, Math.floor(b.w / 7))
      for (let k = 0; k < n; k++) add(b, 3.4, 4.2, 0.12, -b.w / 2 + (k + 0.5) * (b.w / n), 2.1, b.d / 2 + 0.05, '#9AA3AD')
    }
  }
  return parts
}

function plainWalls(plan: CityPlan): Part[] {
  return plan.bldgs.filter((b) => b.facade === 'plain' && !NO_WALL.has(b.kind ?? '')).map((b) => ({ geo: box(b.w, b.h, b.d), pos: [b.x, b.h / 2, b.z] as V3, rot: [0, b.rot, 0] as V3, color: b.color }))
}

// 도로를 교차로에서 끊은 구간들 (보도·중앙선이 교차로를 덮지 않게)
function segments(rd: Road, plan: CityPlan): [number, number][] {
  const cuts = plan.roads
    .filter((o) => o.axis !== rd.axis)
    .map((o) => ({ t: o.at, hw: o.w / 2 + SIDEWALK }))
  if (rd.axis === 'z') cuts.push({ t: (MAIN_Z0 + MAIN_Z1) / 2, hw: (MAIN_Z1 - MAIN_Z0) / 2 + 0.5 })
  cuts.sort((a, b) => a.t - b.t)
  const out: [number, number][] = []
  let cur = rd.from
  for (const c of cuts) {
    if (c.t - c.hw > cur) out.push([cur, c.t - c.hw])
    cur = Math.max(cur, c.t + c.hw)
  }
  if (cur < rd.to) out.push([cur, rd.to])
  return out
}

const ZONE_FLOOR = { industrial: '#C7CCD2', commercial: '#D2D5D9', residential: '#B7D49A', park: '#A3CE82', parking: '#5A606A', civic: '#C9D8BE', houses: '#BFD9A0', riverside: '' } as const
const PAVING = { alley: '#767C86', path: '#DCD7CB', apron: '#9EA5AE' } as const

function groundParts(plan: CityPlan): Part[] {
  const parts: Part[] = []
  const slab = (x0: number, x1: number, z0: number, z1: number, y: number, h: number, color: string) =>
    parts.push({ geo: box(Math.max(0.05, x1 - x0), h, Math.max(0.05, z1 - z0)), pos: [(x0 + x1) / 2, y, (z0 + z1) / 2], color })
  // 강변 블록은 바닥판 없이 둑 잔디(지면)를 그대로 보인다
  for (const b of plan.blocks) if (ZONE_FLOOR[b.zone]) slab(b.x0, b.x1, b.z0, b.z1, -0.035, 0.02, ZONE_FLOOR[b.zone])
  // 블록 안 포장면은 구역 바닥 위, 골목이 길보다 위
  for (const pv of plan.paving) slab(pv.x0, pv.x1, pv.z0, pv.z1, pv.kind === 'alley' ? -0.018 : -0.022, 0.02, PAVING[pv.kind])
  for (const rd of plan.roads) {
    const hw = rd.w / 2
    if (rd.axis === 'z') slab(rd.at - hw, rd.at + hw, rd.from, rd.to, -0.028, 0.02, P.road)
    else slab(rd.from, rd.to, rd.at - hw, rd.at + hw, -0.026, 0.02, P.road)
    for (const [a, c] of segments(rd, plan))
      for (const s of [-1, 1]) {
        const o = s * (hw + SIDEWALK / 2)
        if (rd.axis === 'z') slab(rd.at + o - SIDEWALK / 2, rd.at + o + SIDEWALK / 2, a, c, 0.02, 0.12, P.sidewalk)
        else slab(a, c, rd.at + o - SIDEWALK / 2, rd.at + o + SIDEWALK / 2, 0.02, 0.12, P.sidewalk)
      }
  }
  return parts
}

function markParts(plan: CityPlan): { white: Part[]; yellow: Part[] } {
  const white: Part[] = []
  const yellow: Part[] = []
  const flat = (list: Part[], x: number, z: number, w: number, d: number) => list.push({ geo: box(w, 0.012, d), pos: [x, 0.004, z], color: '#ffffff' })
  for (const rd of plan.roads) {
    for (const [a, c] of segments(rd, plan)) {
      if (rd.major) {
        for (const o of [-0.16, 0.16]) {
          if (rd.axis === 'z') flat(yellow, rd.at + o, (a + c) / 2, 0.14, c - a)
          else flat(yellow, (a + c) / 2, rd.at + o, c - a, 0.14)
        }
      } else {
        for (let t = a + 2; t + 3 < c; t += 7) {
          if (rd.axis === 'z') flat(white, rd.at, t + 1.5, 0.14, 3)
          else flat(white, t + 1.5, rd.at, 3, 0.14)
        }
      }
    }
  }
  // 주차장 칸 선 (주차 차량 사이)
  for (const b of plan.blocks) {
    if (b.zone !== 'parking') continue
    for (let z = b.z0 + 4; z < b.z1 - 3; z += 6.5)
      for (let x = b.x0 + 1.6; x < b.x1 - 1.6; x += 2.8) flat(white, x, z, 0.1, 4.6)
  }
  // 교차로 횡단보도
  const avenues = plan.roads.filter((r) => r.axis === 'z')
  const streets = plan.roads.filter((r) => r.axis === 'x').map((r) => ({ at: r.at, hw: r.w / 2 }))
  streets.push({ at: (MAIN_Z0 + MAIN_Z1) / 2, hw: (MAIN_Z1 - MAIN_Z0) / 2 })
  for (const av of avenues)
    for (const st of streets) {
      const hw = av.w / 2
      for (const s of [-1, 1]) {
        const z = st.at + s * (st.hw + 1.9)
        for (let x = av.at - hw + 0.6; x < av.at + hw - 0.3; x += 1.1) flat(white, x, z, 0.55, 2.8)
        const x = av.at + s * (hw + 1.9)
        if (st.hw > 6) continue // 트럭 도로는 횡단보도 생략
        for (let zz = st.at - st.hw + 0.6; zz < st.at + st.hw - 0.3; zz += 1.1) flat(white, x, zz, 2.8, 0.55)
      }
    }
  return { white, yellow }
}

function furnitureParts(plan: CityPlan): { poles: Part[]; heads: Part[]; pools: Part[] } {
  const poles: Part[] = []
  const heads: Part[] = []
  const pools: Part[] = []
  const pool = (w: number, d: number) => {
    const g = new THREE.PlaneGeometry(w, d)
    g.rotateX(-Math.PI / 2)
    return g
  }
  for (const l of plan.lights) {
    const ax = Math.sin(l.rot)
    const az = Math.cos(l.rot)
    poles.push({ geo: cyl(0.1, 7, 6), pos: [l.x, 3.5, l.z], color: P.frame })
    poles.push({ geo: box(0.12, 0.1, 2.0), pos: [l.x + ax, 7, l.z + az], rot: [0, l.rot, 0], color: P.frame })
    heads.push({ geo: box(0.45, 0.1, 0.7), pos: [l.x + ax * 1.9, 6.92, l.z + az * 1.9], rot: [0, l.rot, 0], color: '#fff' })
    pools.push({ geo: pool(11, 11), pos: [l.x + ax * 3, 0.03, l.z + az * 3], color: '#fff' })
  }
  for (const s of plan.signals) {
    poles.push({ geo: cyl(0.09, 4.2, 6), pos: [s.x, 2.1, s.z], color: '#3A3F47' })
    poles.push({ geo: box(0.36, 1.0, 0.32), pos: [s.x, 4.4, s.z], color: '#2B2F36' })
  }
  return { poles, heads, pools }
}

// ── 차량: 주차 차량(고정) + 도로 위 일반 차량(이동). 차체·유리 InstancedMesh 2개 ──
const carBody = new THREE.BoxGeometry(1.8, 0.7, 4.3)
carBody.translate(0, 0.55, 0)
const carCabin = new THREE.BoxGeometry(1.6, 0.55, 2.2)
carCabin.translate(0, 1.15, -0.15)
const carMat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2 })
const glassMat = new THREE.MeshStandardMaterial({ color: P.glass, roughness: 0.25, metalness: 0.3 })
const tmp = new THREE.Object3D()
const pose = { x: 0, z: 0, h: 0 }

function Cars({ plan, seed }: { plan: CityPlan; seed: number }) {
  const body = useRef<THREE.InstancedMesh>(null)
  const cabin = useRef<THREE.InstancedMesh>(null)
  const clock = useRef(0)
  // 교통량을 바꾸면 차량을 새로 깐다 (차로 순서·간격을 처음부터 맞추는 편이 단순하다)
  const traffic = useUi((s) => s.traffic)
  const sim = useMemo(() => {
    const lanes = lanesOf(plan)
    return { lanes, movers: spawnCars(plan, lanes, seed, traffic) }
  }, [plan, seed, traffic])
  const movers = sim.movers
  const total = plan.parked.length + movers.length

  useLayoutEffect(() => {
    const r = new Rng(seed + 5)
    const b = body.current!
    const c = cabin.current!
    plan.parked.forEach((p, i) => {
      tmp.position.set(p.x, 0, p.z)
      tmp.rotation.set(0, p.rot, 0)
      tmp.updateMatrix()
      b.setMatrixAt(i, tmp.matrix)
      c.setMatrixAt(i, tmp.matrix)
      b.setColorAt(i, col.set(p.color))
    })
    movers.forEach((_, k) => b.setColorAt(plan.parked.length + k, col.set(r.pick(CITY_CARS))))
    b.instanceMatrix.needsUpdate = true
    c.instanceMatrix.needsUpdate = true
    if (b.instanceColor) b.instanceColor.needsUpdate = true
    // 도시 전체를 덮도록 경계 구를 크게 (움직이는 인스턴스라 매번 다시 계산하지 않음)
    for (const m of [b, c]) {
      m.computeBoundingSphere()
      m.boundingSphere!.radius = 2000
    }
  }, [plan, movers, seed])

  useFrame((_, dt) => {
    // 시뮬레이션은 멈추지 않으므로 차도 늘 실제 시간으로 움직인다
    const step = Math.min(dt, 0.1)
    clock.current += step
    const b = body.current
    const c = cabin.current
    if (!b || !c) return
    const base = plan.parked.length
    const t = clock.current
    if (step > 0) stepCars(sim.lanes, movers, t, step)
    movers.forEach((mv, k) => {
      carPose(sim.lanes, mv, pose)
      tmp.position.set(pose.x, 0, pose.z)
      tmp.rotation.set(0, pose.h, 0)
      tmp.updateMatrix()
      b.setMatrixAt(base + k, tmp.matrix)
      c.setMatrixAt(base + k, tmp.matrix)
    })
    b.instanceMatrix.needsUpdate = true
    c.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh ref={body} args={[carBody, carMat, total]} castShadow receiveShadow />
      <instancedMesh ref={cabin} args={[carCabin, glassMat, total]} />
    </group>
  )
}

export function City({ site }: { site: Site }) {
  const plan = cityPlan(site)
  const key = site.cfg.id
  const t = textures()
  void t

  const facades = useMemo(() => {
    const geos = { punch: [] as THREE.BufferGeometry[], ribbon: [] as THREE.BufferGeometry[], curtain: [] as THREE.BufferGeometry[] }
    for (const b of plan.bldgs) {
      if (b.facade === 'plain') continue
      if (b.tiers?.length) {
        // 들여 쌓기: 층 묶음마다 크기가 줄어드는 상자를 이어 쌓는다
        let y0 = 0
        for (const t of b.tiers) {
          geos[b.facade].push(facadeBox({ ...b, w: t.w, d: t.d }, y0, t.h, b.color))
          y0 = t.h
        }
        continue
      }
      // 상가 건물은 1층을 진열창으로 두고 위층부터 창 격자
      geos[b.facade].push(facadeBox(b, b.shop ? 3.3 : 0, b.h, b.color))
      if (b.shop) geos[b.facade].push(facadeBox({ ...b, facade: 'plain' }, 0, 3.3, '#5A6470'))
    }
    const mk = (list: THREE.BufferGeometry[]) => {
      if (!list.length) return null
      const g = mergeGeometries(list, false)!
      g.computeBoundingSphere()
      return g
    }
    return { punch: mk(geos.punch), ribbon: mk(geos.ribbon), curtain: mk(geos.curtain) }
  }, [plan])

  const detailGeo = merged(`city-detail-${key}`, () => [...buildingParts(plan, site.cfg.seed + 3), ...plainWalls(plan)])
  const groundGeo = merged(`city-ground-${key}`, () => groundParts(plan))
  const marks = useMemo(() => markParts(plan), [plan])
  const whiteGeo = merged(`city-white-${key}`, () => marks.white)
  const yellowGeo = merged(`city-yellow-${key}`, () => marks.yellow.map((p) => ({ ...p, color: P.laneYellow })))
  const furn = useMemo(() => furnitureParts(plan), [plan])
  const poleGeo = merged(`city-poles-${key}`, () => furn.poles)
  const headGeo = merged(`city-heads-${key}`, () => furn.heads)
  const poolGeo = merged(`city-pools-${key}`, () => furn.pools)

  return (
    <group>
      <mesh geometry={groundGeo} material={vcMatMatte} receiveShadow />
      <mesh geometry={whiteGeo} material={vcMatMatte} />
      <mesh geometry={yellowGeo} material={vcMatMatte} />
      {facades.punch && <mesh geometry={facades.punch} material={nightMats.cityPunch} castShadow receiveShadow />}
      {facades.ribbon && <mesh geometry={facades.ribbon} material={nightMats.cityRibbon} castShadow receiveShadow />}
      {facades.curtain && <mesh geometry={facades.curtain} material={nightMats.cityCurtain} castShadow receiveShadow />}
      <mesh geometry={detailGeo} material={vcMat} castShadow receiveShadow />
      <mesh geometry={poleGeo} material={vcMat} castShadow />
      <mesh geometry={headGeo} material={nightMats.lampHead} />
      <mesh geometry={poolGeo} material={nightMats.pool} renderOrder={1} />
      <Cars plan={plan} seed={site.cfg.seed + 41} />
    </group>
  )
}
