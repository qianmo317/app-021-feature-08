import { expect, test, type Page } from '@playwright/test'
import { addStudent, bulkAdd, dragSeat, generate, namesAt, readSeatMap } from './helpers'

// 场景一：从零建班的完整旅程 —— 新建 → 录学生 → 生成 → 微调 → 报告 → 打印 → 持久化

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

async function createClass(page: Page, name: string) {
  await page.getByTestId('new-class-name').fill(name)
  await page.getByTestId('create-class').click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`${name} · 配置`)
  return /\/class\/([^/]+)/.exec(page.url())![1]
}

test('首页展示隐私承诺与新建入口', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('班级列表')
  await expect(page.getByText('隐私承诺')).toBeVisible()
  await expect(page.getByText('不上传任何服务器')).toBeVisible()
})

test('空班级名被拦截', async ({ page }) => {
  await page.getByTestId('create-class').click()
  await expect(page.getByText('请输入班级名称')).toBeVisible()
})

test('学生姓名必填与重名校验', async ({ page }) => {
  await createClass(page, 'E2E 校验班')
  await page.getByTestId('add-student').click()
  await page.getByTestId('student-save').click()
  await expect(page.getByText('姓名必填')).toBeVisible()
  await page.getByTestId('student-name').fill('张三')
  await page.getByTestId('student-save').click()
  // 再次添加同名
  await page.getByTestId('add-student').click()
  await page.getByTestId('student-name').fill('张三')
  await page.getByTestId('student-save').click()
  await expect(page.getByText('已存在同名学生')).toBeVisible()
})

test('完整旅程：录学生 → 生成 4 周 → 可复现 → 拖拽交换与撤销 → 历史保留 → 持久化', async ({ page }) => {
  const classId = await createClass(page, 'E2E 三年级 2 班')

  // 默认 6×7 = 42 个座位
  await expect(page.getByTestId('seat-grid').locator('[data-seat-id]')).toHaveCount(42)
  await expect(page.getByText('学生名单（0 人）')).toBeVisible()

  // 逐个添加：近视学生（硬约束角色）
  await addStudent(page, { name: '张小近', height: '145', vision: 'front_required' })
  // 批量添加 8 人
  await bulkAdd(page, '李一,150\n王二,158,爱说话\n赵三,140\n钱四,162\n孙五,147\n周六,155\n吴七,138\n郑八,160')
  await expect(page.getByText('学生名单（9 人）')).toBeVisible()

  // 容量校验：把座位缩到 2×2=4 < 9 人 → 出现配置问题卡
  const rowsInput = page.locator('[data-testid="layout-editor"] input[type="number"]').first()
  const colsInput = page.locator('[data-testid="layout-editor"] input[type="number"]').nth(1)
  await rowsInput.fill('2')
  await colsInput.fill('2')
  await expect(page.getByTestId('validation-errors')).toBeVisible()
  // 恢复布局
  await rowsInput.fill('6')
  await colsInput.fill('7')
  await expect(page.getByTestId('validation-errors')).toBeHidden()

  // 生成 4 周（seed=42）
  await page.getByRole('link', { name: '轮换结果' }).click()
  await expect(page.getByTestId('no-plan-hint')).toBeVisible()
  await generate(page, 4, 42)
  await expect(page.getByTestId('week-tab-4')).toBeVisible()
  await expect(page.getByTestId('hard-violations')).toContainText('0')

  // 可复现：同参数同种子再生成，第 1 周结果一致
  const firstRun = await readSeatMap(page)
  await generate(page, 4, 42)
  await page.getByTestId('week-tab-1').click()
  const secondRun = await readSeatMap(page)
  expect(secondRun).toEqual(firstRun)

  // 近视学生必须在前 2 排（frontRows 默认 2）
  const rowOf = (seatId: string) => Number(/r(\d+)c/.exec(seatId)![1])
  for (const [seatId, name] of Object.entries(secondRun)) {
    if (name === '张小近') expect(rowOf(seatId), `${name} 在 ${seatId}，违反前排约束`).toBeLessThan(2)
  }

  // 拖拽交换：两个无约束学生（批量导入的李一/王二），中途可见实时预览
  const seatA = Object.entries(secondRun).find(([, v]) => v === '李一')![0]
  const seatB = Object.entries(secondRun).find(([, v]) => v === '王二')![0]
  const before = await namesAt(page, [seatA, seatB])
  await dragSeat(page, seatA, seatB)
  await expect(page.getByTestId('swap-preview')).toBeVisible()
  await expect(page.getByTestId('swap-preview')).toContainText('李一')
  await expect(page.getByTestId('swap-preview')).toContainText('王二')
  await page.mouse.up()
  await expect.poll(() => namesAt(page, [seatA, seatB]), { timeout: 10_000 }).toEqual([before[1], before[0]])

  // 统计实时更新：硬约束仍为 0
  await expect(page.getByTestId('hard-violations')).toContainText('0')

  // 撤销交换
  await page.getByTestId('undo-swap').click()
  await expect.poll(() => namesAt(page, [seatA, seatB])).toEqual(before)

  // 从第 3 周起重排：前两周保持不变
  await page.getByTestId('week-tab-3').click()
  await page.getByTestId('regen-from').click()
  await expect(page.getByTestId('toast-ok')).toHaveText('已从第 3 周起重排')
  await page.getByTestId('week-tab-1').click()
  await expect.poll(() => readSeatMap(page)).toEqual(firstRun)
  await page.getByTestId('week-tab-2').click()
  await expect(page.getByTestId('week-tab-4')).toBeVisible() // 重排后仍保留 4 周

  // 重新生成本周（第 2 周）：其余周不受影响
  await page.getByTestId('regen-week').click()
  await expect(page.getByTestId('toast-ok')).toHaveText('已重新生成第 2 周')
  await page.getByTestId('week-tab-1').click()
  await expect.poll(() => readSeatMap(page)).toEqual(firstRun)

  // 刷新持久化 + 深链接直达
  await page.reload()
  await expect(page.getByTestId('week-tabs')).toBeVisible()
  expect(page.url()).toContain(`/class/${classId}/rotations`)

  // 公平性报告
  await page.getByRole('link', { name: '公平性报告' }).click()
  await expect(page.getByTestId('fair-weeks')).toHaveText('4')
  await expect(page.getByTestId('fair-hard')).toContainText('0')
  await expect(page.getByTestId('fairness-table').locator('[data-testid="fairness-row"]')).toHaveCount(9)
  await expect(page.getByTestId('bar-chart').locator('[data-testid="bar-row"]')).toHaveCount(9)
  const [dl1] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()])
  expect(dl1.suggestedFilename()).toContain('公平性统计.csv')

  // 打印页：默认全选 4 周，共 4 页，逐页可见；打印按钮可点（headless 下 no-op）
  await page.getByRole('link', { name: '打印', exact: true }).click()
  await expect(page.getByTestId('print-total-pages')).toHaveText('4')
  await expect(page.getByTestId('print-sheet-1-1')).toBeVisible()
  await expect(page.getByTestId('print-sheet-4-1')).toBeVisible()
  await expect(page.getByTestId('print-sheet-1-1').locator('.stage-bar')).toContainText('讲台')
  // 每张物理页都带「第 N 周 页码/总页」标记
  await expect(page.getByTestId('print-sheet-1-1')).toContainText('第 1 周 1/1')
  await page.getByTestId('do-print').click()

  // 轮换页导出 CSV
  await page.getByRole('link', { name: '返回轮换' }).click()
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '导出 CSV' }).click()])
  expect(dl2.suggestedFilename()).toContain('按周座位表.csv')
})

test('打印页可按周筛选：起止周 + 勾选，页数与每页周次实时可见', async ({ page }) => {
  const classId = await createClass(page, 'E2E 打印筛选班')
  await bulkAdd(page, Array.from({ length: 40 }, (_, i) => `学生${i + 1}`).join('\n'))
  await page.getByRole('link', { name: '轮换结果' }).click()
  await generate(page, 8, 7)

  await page.getByRole('link', { name: '打印', exact: true }).first().click()
  // 默认全选：8 周 8 页
  await expect(page.getByTestId('print-total-pages')).toHaveText('8')
  await expect(page.locator('[data-testid^="print-sheet-"]')).toHaveCount(8)

  // 指定第 5～8 周
  await page.getByTestId('week-start').selectOption('5')
  await page.getByTestId('week-end').selectOption('8')
  await expect(page.getByTestId('print-total-pages')).toHaveText('4')
  const visibleSheets = page.locator('[data-testid^="print-sheet-"]')
  await expect(visibleSheets).toHaveCount(4)
  await expect(page.getByTestId('print-sheet-5-1')).toBeVisible()
  await expect(page.getByTestId('print-sheet-8-1')).toBeVisible()
  await expect(page.getByTestId('print-sheet-4-1')).toHaveCount(0)
  // 预览清单逐页列出周次
  await expect(page.getByTestId('print-plan-item-5-1')).toContainText('第 5 周 · 1/1')
  await expect(page.getByTestId('print-plan-item-8-1')).toContainText('第 8 周 · 1/1')

  // 再取消第 6 周 → 只剩 5、7、8 三页
  await page.locator('.week-chip', { hasText: '第 6 周' }).locator('input').uncheck()
  await expect(page.getByTestId('print-total-pages')).toHaveText('3')
  await expect(page.getByTestId('print-sheet-6-1')).toHaveCount(0)

  // 空选时打印按钮禁用
  await page.getByTestId('week-select-none').click()
  await expect(page.getByTestId('print-total-pages')).toHaveText('0')
  await expect(page.getByTestId('do-print')).toBeDisabled()
  await page.getByTestId('week-select-all').click()
  await expect(page.getByTestId('do-print')).toBeEnabled()
  void classId
})

test('打印页座位图超出一页时按排续页，续页带讲台条/周次页码与标记说明', async ({ page }) => {
  await createClass(page, 'E2E 打印大班')
  await bulkAdd(page, Array.from({ length: 60 }, (_, i) => `学生${i + 1}`).join('\n'))
  // 扩大为 12 排 × 7 列 = 84 座（大班），单页放不下
  const rowsInput = page.locator('[data-testid="layout-editor"] input[type="number"]').first()
  const colsInput = page.locator('[data-testid="layout-editor"] input[type="number"]').nth(1)
  await rowsInput.fill('12')
  await colsInput.fill('7')
  await page.getByRole('link', { name: '轮换结果' }).click()
  await generate(page, 3, 1)

  await page.getByRole('link', { name: '打印', exact: true }).first().click()
  // 等待实测分页稳定：3 周共超过 3 页
  await expect.poll(async () => (await page.locator('[data-testid^="print-sheet-"]').count())).toBeGreaterThan(3)

  // 第 1 周被拆成多页
  const week1Pages = page.locator('[data-week="1"]')
  const n = await week1Pages.count()
  expect(n).toBeGreaterThan(1)
  await expect(week1Pages.first()).toContainText('第 1 周 1/' + n)
  await expect(week1Pages.nth(1)).toContainText('第 1 周 2/' + n)
  await expect(week1Pages.nth(1)).toContainText('续上页')

  // 续页也有讲台方向条
  await expect(week1Pages.nth(1).locator('.stage-bar')).toContainText('讲台')
  // 每页页脚都保留标记说明
  for (let i = 0; i < n; i++) {
    await expect(week1Pages.nth(i).locator('.print-foot')).toContainText('标记说明')
    await expect(week1Pages.nth(i).locator('.print-foot')).toContainText('讲台方向')
  }
  // 两张续页的座位来自不同的排（无重复座位）
  const ids1 = await week1Pages.first().locator('[data-seat-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-seat-id')))
  const ids2 = await week1Pages.nth(1).locator('[data-seat-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-seat-id')))
  expect(ids1.some((id) => ids2.includes(id))).toBe(false)
})

test('删除班级需确认（接受确认框后从列表消失）', async ({ page }) => {
  await createClass(page, 'E2E 待删班')
  await page.goto('/')
  page.once('dialog', (d) => d.accept())
  await page.locator('[data-testid="class-card"]', { hasText: 'E2E 待删班' }).locator('button[title="删除班级"]').click()
  await expect(page.locator('[data-testid="class-card"]', { hasText: 'E2E 待删班' })).toBeHidden()
})

test('未生成时打印页给出引导而非空页', async ({ page }) => {
  await createClass(page, 'E2E 未生成班')
  await page.getByRole('link', { name: '打印', exact: true }).click()
  await expect(page.getByText('还没有生成轮换结果')).toBeVisible()
  await expect(page.getByTestId('do-print')).toBeDisabled()
})
