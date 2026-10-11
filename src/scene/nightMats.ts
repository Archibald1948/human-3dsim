// 낮/밤에 따라 Lighting이 매 프레임 갱신하는 공유 재질
import * as THREE from 'three'
import { P } from './palette'

function poolTexture(): THREE.Texture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grd.addColorStop(0, 'rgba(255,255,255,1)')
  grd.addColorStop(0.45, 'rgba(255,255,255,0.45)')
  grd.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grd
  g.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export const nightMats = {
  window: new THREE.MeshStandardMaterial({ color: P.glassWall, roughness: 0.25, metalness: 0.2, emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: 0 }),
  lampHead: new THREE.MeshBasicMaterial({ color: '#d8d8d4' }),
  pool: new THREE.MeshBasicMaterial({ map: poolTexture(), color: '#ffcf8a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  interior: new THREE.MeshBasicMaterial({ map: null, color: '#fff4dc', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
  // 지붕 천창: 밤에는 안쪽 조명이 비친다 (단면 보기에서는 Building이 투명도를 조절)
  skylight: new THREE.MeshStandardMaterial({ color: P.skylight, roughness: 0.2, metalness: 0.1, emissive: new THREE.Color('#ffe2b0'), emissiveIntensity: 0 }),
  // 외벽 간판: 밤에는 글자가 켜진다 (map은 Building이 캔버스로 채움)
  sign: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0 }),
  // 도시 건물 외벽 (창 격자 텍스처 × 정점 색). 밤에는 켜진 창만 빛난다 (map·emissiveMap은 City가 채움)
  cityPunch: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: 0 }),
  cityRibbon: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.05, emissive: new THREE.Color('#fff0d6'), emissiveIntensity: 0 }),
  cityCurtain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.1, emissive: new THREE.Color('#e8f0ff'), emissiveIntensity: 0 }),
}
nightMats.interior.map = nightMats.pool.map
