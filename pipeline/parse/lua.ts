/**
 * Lua source → plain JS values via luaparse (ADR-001 D2). Wiki modules are UTF-8; luaparse
 * works on code units, so the source is re-encoded as latin1 and parsed with
 * `encodingMode: 'pseudo-latin1'` (the default 'none' yields null string values), then every
 * string literal is decoded back from latin1 bytes to UTF-8.
 *
 * Only literal expressions are converted (strings, numbers, booleans, nil, tables, unary
 * minus). Anything else is an E_PARSE_LUA error — the parser never evaluates code.
 */
import luaparse from 'luaparse'
import type { Chunk, Expression, Node } from 'luaparse'

export class LuaParseError extends Error {
  readonly code = 'E_PARSE_LUA'
  constructor(message: string) {
    super(`[E_PARSE_LUA] ${message}`)
  }
}

export function parseLua(source: string, label: string): Chunk {
  try {
    return luaparse.parse(Buffer.from(source, 'utf8').toString('latin1'), { encodingMode: 'pseudo-latin1', comments: false, luaVersion: '5.1' })
  } catch (cause) {
    throw new LuaParseError(`${label}: ${(cause as Error).message}`)
  }
}

const fromLatin1 = (s: string) => Buffer.from(s, 'latin1').toString('utf8')

export type LuaValue = string | number | boolean | null | LuaValue[] | { [key: string]: LuaValue }

/** Converts a literal Lua expression to a JS value. Tables with only positional fields → arrays. */
export function luaValue(expr: Expression, label: string): LuaValue {
  switch (expr.type) {
    case 'StringLiteral':
      return fromLatin1(expr.value)
    case 'NumericLiteral':
      return expr.value
    case 'BooleanLiteral':
      return expr.value
    case 'NilLiteral':
      return null
    case 'UnaryExpression':
      if (expr.operator === '-' && expr.argument.type === 'NumericLiteral') return -expr.argument.value
      throw new LuaParseError(`${label}: unsupported unary expression "${expr.operator}"`)
    case 'TableConstructorExpression': {
      if (expr.fields.every((f) => f.type === 'TableValue')) return expr.fields.map((f) => luaValue(f.value, label))
      const out: Record<string, LuaValue> = {}
      let position = 1
      for (const f of expr.fields) {
        if (f.type === 'TableValue') out[String(position++)] = luaValue(f.value, label)
        else if (f.type === 'TableKeyString') out[f.key.name] = luaValue(f.value, label)
        else {
          const key = luaValue(f.key, label)
          if (typeof key !== 'string' && typeof key !== 'number') throw new LuaParseError(`${label}: unsupported table key`)
          out[String(key)] = luaValue(f.value, label)
        }
      }
      return out
    }
    default:
      throw new LuaParseError(`${label}: unsupported expression type ${expr.type}`)
  }
}

/** The value of the module's top-level `return <table>`. */
export function returnedValue(chunk: Chunk, label: string): LuaValue {
  const ret = chunk.body.find((s) => s.type === 'ReturnStatement')
  if (!ret || ret.type !== 'ReturnStatement' || ret.arguments.length !== 1) throw new LuaParseError(`${label}: no top-level return of a single value`)
  return luaValue(ret.arguments[0], label)
}

/** Every call `fnName(args…)` anywhere in the chunk (statement or expression), in source order. */
export function findCalls(chunk: Chunk, fnName: string): Expression[][] {
  const calls: Expression[][] = []
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const n of node) visit(n)
      return
    }
    if (typeof node !== 'object' || node === null) return
    const n = node as Node & Record<string, unknown>
    if (n.type === 'CallExpression' && (n as { base: Expression }).base.type === 'Identifier' && ((n as { base: { name: string } }).base.name === fnName)) {
      calls.push((n as { arguments: Expression[] }).arguments)
    }
    for (const [key, value] of Object.entries(n)) if (key !== 'type') visit(value)
  }
  visit(chunk.body)
  return calls
}
