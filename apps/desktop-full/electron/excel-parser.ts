import fs from 'node:fs'
import * as XLSX from 'xlsx'

XLSX.set_fs(fs)

const MAX_SHEETS = 20
const MAX_ROWS_PER_SHEET = 120
const MAX_COLUMNS_PER_ROW = 40
const MAX_CHARACTERS = 80_000

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value).trim().replace(/[\t\r\n]+/g, ' ')
}

export async function readXlsxFile(filePath: string) {
  const workbook = XLSX.readFile(filePath, {
    cellDates: true,
    dense: true,
  })
  const sections: string[] = []
  let characterCount = 0

  for (const sheetName of workbook.SheetNames.slice(0, MAX_SHEETS)) {
    if (characterCount >= MAX_CHARACTERS) break

    const worksheet = workbook.Sheets[sheetName]
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: false,
      dateNF: 'yyyy-mm-dd',
      defval: '',
      blankrows: false,
    })
    const rows: string[] = []

    for (const rawRow of rawRows.slice(0, MAX_ROWS_PER_SHEET)) {
      if (characterCount >= MAX_CHARACTERS) break
      const values = rawRow.slice(0, MAX_COLUMNS_PER_ROW).map(normalizeCell)
      while (values.length > 0 && !values.at(-1)) values.pop()
      if (!values.some(Boolean)) continue

      const line = values.join('\t')
      rows.push(line)
      characterCount += line.length
    }

    const section = `# 工作表：${sheetName}\n${rows.join('\n')}`
    sections.push(section)
    characterCount += section.length
  }

  return sections.join('\n\n') || 'Excel 文件中没有读取到可见单元格。'
}
