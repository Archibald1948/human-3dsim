import { useEffect } from 'react'
import { Scene } from './scene/Scene'
import { TopBar } from './ui/TopBar'
import { SidePanel } from './ui/SidePanel'
import { Inspector } from './ui/Inspector'
import { Timeline } from './ui/Timeline'
import { useUi } from './store'
import { ModeLegend, StageToolbar, ToastView } from './ui/StageToolbar'
import { Search } from './ui/Search'
import { Minimap } from './ui/Minimap'

export default function App() {
  const bump = useUi((s) => s.bump)
  const panels = useUi((s) => s.panels)
  useEffect(() => {
    const id = window.setInterval(bump, 250)
    return () => window.clearInterval(id)
  }, [bump])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useUi.getState().searchOpen) useUi.getState().select(null, false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <TopBar />
      <main className={`main${panels.side ? '' : ' no-side'}${panels.insp ? '' : ' no-insp'}${panels.tl ? '' : ' no-tl'}`}>
        <SidePanel />
        <div className="stage">
          <Scene />
          <StageToolbar />
          <ModeLegend />
          <Minimap />
          <ToastView />
          <div className="stage-hint" aria-hidden="true">
            <span>
              <i className="key">드래그</i> 회전
            </span>
            <span>
              <i className="key">휠</i> 확대
            </span>
            <span>
              <i className="key">우클릭</i> 이동
            </span>
            <span className="stage-legend">
              <i className="roof" /> 지붕 검은 띠 = 출고 차량
            </span>
          </div>
        </div>
        <Inspector />
        <Timeline />
      </main>
      <Search />
    </div>
  )
}
