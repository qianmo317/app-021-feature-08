import { describe, expect, it } from 'vitest'
import { PAGE_BUDGET_MM, packWeek, uniformMeasure } from '../src/lib/pagination'

const PX_PER_MM = 96 / 25.4

describe('打印分页 packWeek', () => {
  it('无实测数据时回退为一周一页', () => {
    const chunks = packWeek(3, 6, undefined, PX_PER_MM)
    expect(chunks).toEqual([{ week: 3, startRow: 0, endRow: 5, pageInWeek: 1, pagesInWeek: 1 }])
  })

  it('座位图较矮时一周一页，覆盖全部排且不重叠', () => {
    // 10 排，每排 20mm，固定开销 30mm → 图高 200mm，总计 230mm < 279mm
    const m = uniformMeasure(10, 20, 30, PX_PER_MM)
    const chunks = packWeek(1, 10, m, PX_PER_MM)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ startRow: 0, endRow: 9, pageInWeek: 1, pagesInWeek: 1 })
  })

  it('座位图超出一页时按排自动续页，每块都在页预算内', () => {
    // 12 排，每排 30mm，固定开销 30mm → 每页可放 floor((279-30)/30)=8 排
    const rows = 12
    const fixed = 30
    const m = uniformMeasure(rows, 30, fixed, PX_PER_MM)
    const chunks = packWeek(5, rows, m, PX_PER_MM)
    expect(chunks.length).toBeGreaterThan(1)

    // 块连续覆盖 0..11，无重叠无遗漏
    let cursor = 0
    chunks.forEach((c, i) => {
      expect(c.startRow).toBe(cursor)
      expect(c.endRow).toBeGreaterThanOrEqual(c.startRow)
      cursor = c.endRow + 1
      expect(c.pageInWeek).toBe(i + 1)
      expect(c.pagesInWeek).toBe(chunks.length)
      expect(c.week).toBe(5)
    })
    expect(cursor).toBe(rows)
    expect(chunks[0].startRow).toBe(0)
    expect(chunks[chunks.length - 1].endRow).toBe(rows - 1)

    // 前 8 排应同页
    expect(chunks[0].endRow).toBe(7)
  })

  it('续页每块总高度（含固定开销）不超过 A4 预算', () => {
    const rowH = 25
    const fixed = 40
    const m = uniformMeasure(20, rowH, fixed, PX_PER_MM)
    const chunks = packWeek(1, 20, m, PX_PER_MM)
    for (const c of chunks) {
      const canvasMm = ((c.endRow - c.startRow + 1) * rowH)
      expect(canvasMm + fixed).toBeLessThanOrEqual(PAGE_BUDGET_MM)
    }
  })

  it('贪心尽量塞满：除最后一页外每块都无法再容纳下一排', () => {
    const m = uniformMeasure(15, 35, 20, PX_PER_MM)
    const chunks = packWeek(1, 15, m, PX_PER_MM)
    expect(chunks.length).toBeGreaterThan(1)
    for (let i = 0; i < chunks.length - 1; i++) {
      const c = chunks[i]
      const rowsInPage = c.endRow - c.startRow + 1
      // 再多加一排就应超出预算（fixedH=20mm）
      expect((rowsInPage + 1) * 35 + 20).toBeGreaterThan(PAGE_BUDGET_MM)
    }
  })

  it('单排超高时也不拆排：每页至少一排', () => {
    // 每排 300mm 远超页面预算
    const m = uniformMeasure(3, 300, 30, PX_PER_MM)
    const chunks = packWeek(2, 3, m, PX_PER_MM)
    expect(chunks).toHaveLength(3)
    chunks.forEach((c, i) => {
      expect(c.startRow).toBe(i)
      expect(c.endRow).toBe(i)
    })
  })
})
