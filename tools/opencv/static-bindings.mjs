// Static dispatch for the pinned OpenCV.js Embind ABI. The release and dev servers
// insert these functions into the upstream JS wrapper, alongside its original WASM.
export function createJsInvoker(types, isMethod, returns) {
  const stacked = types.slice(1).some(type => type && type.destructorFunction === undefined)
  const destructible = []
  if (!stacked) {
    for (let i = isMethod ? 1 : 2; i < types.length; i++) {
      if (types[i].destructorFunction !== null) destructible.push(i - (isMethod ? 0 : 1))
    }
  }
  return (_name, _bindingError, invoke, fn, flush, fromWire, toSelf, ...converters) => function (...args) {
    const stack = stacked ? [] : null
    const wired = [fn]
    if (isMethod) wired.push(toSelf(stack, this))
    for (let i = 0; i < types.length - 2; i++) wired.push(converters[i](stack, args[i]))
    const result = invoke(...wired)
    if (stacked) flush(stack)
    else for (const [i, index] of destructible.entries()) converters[types.length - 2 + i](wired[index])
    if (returns) return fromWire(result)
  }
}

export function createEmvalCaller(kind, readers, toValue, methodNameFor, returnValue) {
  return (handle, name, destructors, pointer) => {
    const args = readers.map((read, i) => read(pointer + i * 8))
    let result
    switch (kind) {
      case 0: result = toValue(handle)(...args); break
      case 1: result = toValue(handle)[methodNameFor(name)](...args); break
      case 2: result = Reflect.construct(toValue(handle), args); break
      case 3: result = args.at(-1); break
      default: throw new Error('Unsupported Embind invocation kind ' + kind)
    }
    if (returnValue) return returnValue(destructors, result)
  }
}
