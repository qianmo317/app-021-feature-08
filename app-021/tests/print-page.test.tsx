// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { StoreProvider, useStore } from '../src/store'
import { Print } from '../src/pages/Print'
import { makeClass } from './helpers'
import type { Assignment, ClassEntity } from '../src/types'

// 直接构造 assignment（不走引擎，happy-dom 下引擎较慢），每人生到同排号座位
function makePrintClass(weeksCount: number, rows = 6, cols = 7): ClassEntity {
  const cls = makeClass({ rows, cols, weeks: weeksCount })
  cls.assignments = Array.from({ length: weeksCount }, (_, i) => {
    const map: Assignment['map'] = {}
    cls.seats.forEach((seat, idx) => {
      const st = cls.students[(idx + i) % cls.students.length]
      if (st) map[seat.id] = st.id
    })
    return { week: i + 1, map, score: { fairness: 0, repeats: 0 } }
  })
  return cls
}

// Store 初始为空（happy-dom 下 IndexedDB 不可用，回退内存存储）；先注入班级再渲染
function PrintInjected({ cls }: { cls: ClassEntity }) {
  const { updateClass, ready, classes } = useStore()
  if (!ready) return null
  if (!classes.some((c) => c.id === cls.id)) {
    void updateClass(cls)
    return null
  }
  return <Print classId={cls.id} />
}

async function renderPrint(cls: ClassEntity) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <StoreProvider>
        <PrintInjected cls={cls} />
      </StoreProvider>,
    )
  })
  return { root, container }
}

function setInput(el: Element | null, value: string) {
  const input = el as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('打印页交互', () => {
  let mounted: { root: ReturnType<typeof createRoot>; container: HTMLElement }[] = []

  beforeEach(() => {
    window.print = () => {}
  })

  afterEach(() => {
    mounted.forEach(({ root, container }) => {
      act(() => root.unmount())
      container.remove()
    })
    mounted = []
    document.body.innerHTML = ''
  })

  it('默认全选：N 周渲染 N 张首页打印页，讲台条与标记说明都在', async () => {
    const { root, container } = await renderPrint(makePrintClass(4))
    mounted.push({ root, container })

    for (let w = 1; w <= 4; w++) {
      const sheet = container.querySelector(`[data-testid="print-sheet-${w}"]`)
      expect(sheet, `第 ${w} 周应有一张打印页`).toBeTruthy()
      expect(sheet!.querySelector('.stage-bar')?.textContent).toContain('讲台')
      expect(sheet!.querySelector('.print-foot')?.textContent).toContain('标记说明')
    }
    expect(container.querySelector('[data-testid="print-total-pages"]')?.textContent).toContain('共 4 页')
    const cbs = container.querySelectorAll<HTMLInputElement>('.print-week-list input[type="checkbox"]')
    expect(cbs.length).toBe(4)
    expect([...cbs].every((c) => c.checked)).toBe(true)
    expect(container.querySelector('[data-testid="print-page-link-4"]')?.textContent).toContain('第 4 周')
  })

  it('指定起始/结束周：区间外周次禁用但保留勾选，按区间勾选后只打印该区间', async () => {
    const { root, container } = await renderPrint(makePrintClass(6))
    mounted.push({ root, container })

    await act(async () => {
      setInput(container.querySelector('[data-testid="print-range-start"]'), '3')
      setInput(container.querySelector('[data-testid="print-range-end"]'), '5')
    })
    const cb1 = container.querySelector('[data-testid="print-week-1"]') as HTMLInputElement
    const cb3 = container.querySelector('[data-testid="print-week-3"]') as HTMLInputElement
    expect(cb1.disabled).toBe(true)
    expect(cb1.checked).toBe(true)
    expect(cb3.disabled).toBe(false)

    await act(async () => {
      ;(container.querySelector('[data-testid="print-apply-range"]') as HTMLButtonElement).click()
    })
    for (let w = 3; w <= 5; w++) {
      expect(container.querySelector(`[data-testid="print-sheet-${w}"]`)).toBeTruthy()
    }
    expect(container.querySelector('[data-testid="print-sheet-1"]')).toBeNull()
    expect(container.querySelector('[data-testid="print-sheet-6"]')).toBeNull()
    expect(container.querySelector('[data-testid="print-total-pages"]')?.textContent).toMatch(/共 3 页/)
    expect(container.querySelector('[data-testid="print-page-link-1"]')?.textContent).toContain('第 3 周')
  })

  it('清空勾选后打印按钮禁用并提示 0 页，全选可恢复', async () => {
    const { root, container } = await renderPrint(makePrintClass(3))
    mounted.push({ root, container })

    await act(async () => {
      ;[...container.querySelectorAll<HTMLInputElement>('.print-week-list input[type="checkbox"]')].forEach((cb) => cb.click())
    })
    expect((container.querySelector('[data-testid="do-print"]') as HTMLButtonElement).disabled).toBe(true)
    expect(container.textContent).toContain('没有可打印的周次')
    expect(container.querySelector('[data-testid="print-total-pages"]')?.textContent).toContain('共 0 页')

    await act(async () => {
      ;[...container.querySelectorAll('button')].find((b) => b.textContent === '全选')!.click()
    })
    expect(container.querySelector('[data-testid="print-total-pages"]')?.textContent).toContain('共 3 页')
    expect((container.querySelector('[data-testid="do-print"]') as HTMLButtonElement).disabled).toBe(false)
  })

  it('座位图超高时自动续页：续页带讲台条、周次页码（2/3）与续页标记', async () => {
    // mock 实测几何：每排 100mm（4px/mm），固定开销约 40mm → 每页 2 排，6 排 3 页
    const PX = 4
    const rowMm = 100
    const fixedMm = 40
    const seatRect = function (this: HTMLElement): DOMRect {
      const r = Number(this.dataset.row)
      return { top: r * rowMm * PX, bottom: (r + 1) * rowMm * PX, left: 0, right: 50, width: 50, height: rowMm * PX, x: 0, y: r * rowMm * PX, toJSON() {} } as DOMRect
    }
    const origRect = Element.prototype.getBoundingClientRect
    const origOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.classList?.contains('seat') && this.closest('.print-measure')) return seatRect.call(this)
      if (this.classList?.contains('seat-canvas') && this.closest('.print-measure')) {
        return { top: fixedMm * PX, bottom: 6 * rowMm * PX, left: 0, right: 100, width: 100, height: 6 * rowMm * PX, x: 0, y: fixedMm * PX, toJSON() {} } as DOMRect
      }
      if (this.hasAttribute?.('data-mm-probe')) {
        return { top: 0, bottom: 100 * PX, left: 0, right: 100 * PX, width: 100 * PX, height: 1, x: 0, y: 0, toJSON() {} } as DOMRect
      }
      return origRect.call(this)
    }
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return this.hasAttribute?.('data-mm-probe') ? 100 * PX : 0 } })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList?.contains('print-foot') ? 10 * PX : origOffset?.get?.call(this) ?? 0
      },
    })

    try {
      const { root, container } = await renderPrint(makePrintClass(2))
      mounted.push({ root, container })
      // useLayoutEffect 已在 act 内完成实测
      expect(container.querySelector('[data-testid="print-total-pages"]')?.textContent).toContain('共 6 页')

      const p2 = container.querySelector('[data-testid="print-sheet-1-p2"]')
      expect(p2, '第 1 周应有第 2 张续页').toBeTruthy()
      expect(p2!.querySelector('.stage-bar')?.textContent).toContain('讲台')
      expect(p2!.querySelector('.print-cont-tag')?.textContent).toMatch(/续 2\/3/)
      expect(p2!.querySelector('.print-date')?.textContent).toMatch(/第 1 周 2\/3 · 总第 2\/6 页/)
      expect(p2!.querySelector('.print-cont-note')?.textContent).toContain('下接续页')
      expect(p2!.querySelector('.print-foot')?.textContent).toContain('标记说明')
      // 最后一张续页是「续页完」
      const p3 = container.querySelector('[data-testid="print-sheet-1-p3"]')
      expect(p3!.querySelector('.print-cont-note')?.textContent).toContain('续页完')
      // 续页座位图只渲染对应排（每页 2 排 × 7 列 = 14 个座位）
      expect(p2!.querySelectorAll('.seat-canvas [data-seat-id]').length).toBe(14)
    } finally {
      Element.prototype.getBoundingClientRect = origRect
      if (origOffset) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', origOffset)
    }
  })
})
