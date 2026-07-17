import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { afterEach, describe, expect, it } from 'vitest'
import { readXlsxFile } from './excel-parser'

const temporaryFiles: string[] = []

afterEach(async () => {
  await Promise.all(temporaryFiles.splice(0).map((filePath) => fs.rm(filePath, { force: true })))
})

describe('readXlsxFile', () => {
  it('reads Chinese worksheet names, values and formula results', async () => {
    const filePath = path.join(os.tmpdir(), `desktop-ai-butler-excel-${Date.now()}.xlsx`)
    temporaryFiles.push(filePath)

    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.aoa_to_sheet([
      ['编号', '目的地', '实际费用', '预算费用'],
      ['BT-007', '杭州', 2700, 5400],
    ])
    worksheet.D2 = { t: 'n', f: 'C2*2', v: 5400 }
    XLSX.utils.book_append_sheet(workbook, worksheet, '出差记录')
    XLSX.writeFile(workbook, filePath)

    const content = await readXlsxFile(filePath)

    expect(content).toContain('# 工作表：出差记录')
    expect(content).toContain('编号\t目的地\t实际费用\t预算费用')
    expect(content).toContain('BT-007\t杭州\t2700\t5400')
    expect(content).not.toContain('sheet1.xml')
  })
})
