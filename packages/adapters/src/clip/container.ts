import type { Database, SqlJsStatic, SqlValue } from 'sql.js'
import { check, concat, externalId, text, u64, uint64, utf8, view } from './binary'
export type Row = Record<string, SqlValue>
export class ClipContainer {
  readonly db: Database
  readonly chunks: { tag: string; bytes: Uint8Array }[] = []
  readonly external = new Map<string, Uint8Array>()
  readonly additions = new Map<string, Uint8Array>()
  private externalOffsets = new Map<string, number>()
  constructor(SQL: SqlJsStatic, bytes: Uint8Array) {
    check(bytes.length >= 40 && bytes.length <= 512 * 1024 * 1024, 'ファイルサイズが範囲外です。')
    check(text.decode(bytes.subarray(0, 8)) === 'CSFCHUNK' && uint64(bytes, 8) === bytes.length && uint64(bytes, 16) === 24, 'コンテナーのヘッダーが不正です。')
    let offset = 24, database: Uint8Array | undefined
    while (offset < bytes.length) {
      check(offset + 16 <= bytes.length && this.chunks.length < 1_000_000, 'チャンクが破損しています。')
      const tag = text.decode(bytes.subarray(offset, offset + 8)), size = uint64(bytes, offset + 8)
      check(offset + 16 + size <= bytes.length, 'チャンクの範囲が不正です。')
      const payload = bytes.subarray(offset + 16, offset + 16 + size)
      this.chunks.push({ tag, bytes: payload })
      if (tag === 'CHNKSQLi') { check(!database, 'データベースが重複しています。'); database = payload }
      if (tag === 'CHNKExta') {
        const length = uint64(payload, 0)
        check(length > 0 && length <= 128 && 16 + length <= payload.length, '外部データIDが不正です。')
        const id = text.decode(payload.subarray(8, 8 + length))
        check(uint64(payload, 8 + length) === payload.length - 16 - length && !this.external.has(id), '外部データが破損しています。')
        this.external.set(id, payload.subarray(16 + length))
        this.externalOffsets.set(id, offset)
      }
      offset += 16 + size
    }
    check(database && this.chunks[0]?.tag === 'CHNKHead' && this.chunks.at(-2)?.tag === 'CHNKSQLi' && this.chunks.at(-1)?.tag === 'CHNKFoot', '対応していないCLIPコンテナーです。')
    this.db = new SQL.Database(database)
    try {
    this.db.run('PRAGMA trusted_schema=OFF')
    check(this.db.exec('PRAGMA quick_check')[0]?.values[0]?.[0] === 'ok', 'SQLiteの整合性検査に失敗しました。')
    check(!this.db.exec("SELECT name FROM sqlite_master WHERE type='trigger'").length, 'トリガーを含むファイルには対応していません。')
    for (const row of this.rows('ExternalChunk')) check(this.externalOffsets.get(String(row.ExternalID)) === row.Offset, '外部データの参照が不正です。')
    check(this.rows('Canvas').length === 1, '単一キャンバスのCLIPを選択してください。')
    } catch (error) { this.db.close(); throw error }
  }
  rows(table: string): Row[] {
    check(/^[A-Za-z_][A-Za-z_0-9]*$/.test(table), 'テーブル名が不正です。')
    const statement = this.db.prepare(`SELECT * FROM "${table}"`), result: Row[] = []
    try { while (statement.step()) { check(result.length < 1_000_000, '行数が多すぎます。'); result.push(statement.getAsObject()) } } finally { statement.free() }
    return result
  }
  row(table: string, id: SqlValue): Row {
    check(/^[A-Za-z_][A-Za-z_0-9]*$/.test(table), 'テーブル名が不正です。')
    const statement = this.db.prepare(`SELECT * FROM "${table}" WHERE MainId=?`)
    try { statement.bind([id]); check(statement.step(), `${table}の参照先がありません。`); return statement.getAsObject() } finally { statement.free() }
  }
  update(table: string, id: SqlValue, changes: Row): void {
    const columns = Object.keys(this.row(table, id)), entries = Object.entries(changes).filter(([key]) => columns.includes(key))
    if (entries.length) this.db.run(`UPDATE "${table}" SET ${entries.map(([key]) => `"${key}"=?`).join(',')} WHERE MainId=?`, [...entries.map(([, value]) => value), id])
  }
  insert(table: string, template: Row, changes: Row = {}): Row {
    const columns = (this.db.exec(`PRAGMA table_info("${table}")`)[0]?.values ?? []).map(row => String(row[1]))
    const next = (column: string) => Number(this.db.exec(`SELECT COALESCE(MAX("${column}"),0)+1 FROM "${table}"`)[0].values[0][0])
    const row = Object.fromEntries(Object.entries({ ...template, ...changes, MainId: next('MainId'), _PW_ID: next('_PW_ID') }).filter(([key]) => columns.includes(key)))
    const keys = Object.keys(row)
    this.db.run(`INSERT INTO "${table}" (${keys.map(key => `"${key}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map(key => row[key]))
    this.db.run('UPDATE ElemScheme SET MaxIndex=? WHERE TableName=?', [row.MainId, table])
    return row
  }
  addExternal(body: Uint8Array): Uint8Array {
    const id = externalId(); this.additions.set(id, body)
    this.db.run('INSERT INTO ExternalChunk (ExternalID,Offset) VALUES (?,0)', [id])
    return utf8.encode(id)
  }
  body(id: SqlValue): Uint8Array | undefined {
    const key = id instanceof Uint8Array ? text.decode(id) : String(id)
    return this.additions.get(key) ?? this.external.get(key)
  }
  bytes(): Uint8Array {
    const chunks = this.chunks.slice(0, -2).map(chunk => ({ ...chunk }))
    for (const [id, bytes] of this.additions) chunks.push({ tag: 'CHNKExta', bytes: concat(u64(id.length), utf8.encode(id), u64(bytes.length), bytes) })
    let offset = 24
    for (const chunk of chunks) {
      if (chunk.tag === 'CHNKExta') {
        const length = uint64(chunk.bytes, 0), id = text.decode(chunk.bytes.subarray(8, 8 + length))
        this.db.run('UPDATE ExternalChunk SET Offset=? WHERE ExternalID=?', [offset, id])
      }
      offset += 16 + chunk.bytes.length
    }
    chunks[0].bytes = chunks[0].bytes.slice(); view(chunks[0].bytes).setBigUint64(8, BigInt(offset))
    check(this.db.exec('PRAGMA quick_check')[0]?.values[0]?.[0] === 'ok', '生成したデータベースが不正です。')
    chunks.push({ tag: 'CHNKSQLi', bytes: this.db.export() }, { tag: 'CHNKFoot', bytes: new Uint8Array() })
    const body = concat(...chunks.map(chunk => concat(utf8.encode(chunk.tag), u64(chunk.bytes.length), chunk.bytes)))
    return concat(utf8.encode('CSFCHUNK'), u64(body.length + 24), u64(24), body)
  }
  close(): void { this.db.close() }
}
export function blob(value: SqlValue | undefined): Uint8Array { check(value instanceof Uint8Array, 'バイナリ列がありません。'); return value }
