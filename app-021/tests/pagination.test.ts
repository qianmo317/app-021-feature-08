import { describe, expect, it } from 'vitest'
import { chunkRows } from '../src/lib/pagination'

describe('chunkRows 打印按排分页', () => {
  it('全部排放得下时只有一页', () => {
    // 6 排，每排 100，行间 gap 10，总高 100*6+10*5=650 ≤ 1000
    expect(chunkRows([100, 100, 100, 100, 100, 100], () => 1000, 10)).toEqual([
      { fromRow: 0, toRow: 6 },
    ])
  })

  it('超出一页时按排切分且排不重复、不遗漏', () => {
    // 4 排每排 300，gap 50：一页放得下 300 + 350(=650)，第 3 排 350→1000，第 4 排 1350 超限
    const rows = [300, 300, 300, 300]
    const chunks = chunkRows(rows, () => 1000, 50)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]).toEqual({ fromRow: 0, toRow: 3 })
    expect(chunks[chunks.length - 1].toRow).toBe(4)
    // 排区间首尾相接：无重叠、无遗漏
    chunks.forEach((c, i) => {
      if (i > 0) expect(c.fromRow).toBe(chunks[i - 1].toRow)
      expect(c.toRow).toBeGreaterThan(c.fromRow)
    })
  })

  it('续页页眉更矮（预算更大）时从第 2 页起可以多放', () => {
    // 首页预算 250：第 1 排 100，第 2 排 +160=260 超限 → 首页 1 排
    // 续页预算 500：每排边际 160，可放 3 排（420），第 4 排到 580 超限
    const chunks = chunkRows(Array.from({ length: 6 }, () => 100), (i) => (i === 0 ? 250 : 500), 60)
    expect(chunks).toEqual([
      { fromRow: 0, toRow: 1 },
      { fromRow: 1, toRow: 4 },
      { fromRow: 4, toRow: 6 },
    ])
  })

  it('单排高度超过整页预算时不会死循环，独占一页', () => {
    const chunks = chunkRows([50, 2000, 50], () => 500, 10)
    expect(chunks).toEqual([
      { fromRow: 0, toRow: 1 },
      { fromRow: 1, toRow: 2 }, // 超高排独占一页
      { fromRow: 2, toRow: 3 },
    ])
  })

  it('12 排大班（模拟 12×7）切成多页且总排数不变', () => {
    // 每排约 75px（20mm 座位），gap 约 9px
    const rows = Array.from({ length: 12 }, () => 75)
    // A4 281mm 扣除页眉/讲台/页脚后约 250mm ≈ 945px（96dpi 下 1mm≈3.78px）
    const chunks = chunkRows(rows, () => 945, 9)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].fromRow).toBe(0)
    expect(chunks[chunks.length - 1].toRow).toBe(12)
    const covered = chunks.flatMap((c) => Array.from({ length: c.toRow - c.fromRow }, (_, k) => c.fromRow + k))
    expect(covered).toEqual(Array.from({ length: 12 }, (_, i) => i))
  })

  it('空数组返回空（无座位行时不产出页面）', () => {
    expect(chunkRows([], () => 1000, 10)).toEqual([])
  })
})
