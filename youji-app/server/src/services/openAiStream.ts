export async function* readChatCompletionStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let dataLines: string[] = []
  let streamFinished = false

  function parseEvent(): string[] {
    if (dataLines.length === 0) return []
    const data = dataLines.join('\n')
    dataLines = []
    if (data === '[DONE]') {
      streamFinished = true
      return []
    }

    try {
      const parsed = JSON.parse(data)
      const delta = parsed.choices?.[0]?.delta?.content
      return typeof delta === 'string' ? [delta] : []
    } catch {
      return []
    }
  }

  function parseLine(line: string): string[] {
    if (line === '') return parseEvent()
    if (line.startsWith(':')) return []

    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    let value = separator === -1 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') dataLines.push(value)
    return []
  }

  function parseLines(): string[] {
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    const content: string[] = []
    for (const line of lines) {
      content.push(...parseLine(line))
      if (streamFinished) break
    }
    return content
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (const content of parseLines()) yield content
      if (streamFinished) {
        await reader.cancel()
        return
      }
    }
    buffer += decoder.decode()
    if (buffer) {
      for (const content of parseLine(buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer)) {
        yield content
      }
    }
    for (const content of parseEvent()) yield content
  } finally {
    reader.releaseLock()
  }
}
