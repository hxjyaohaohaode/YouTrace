export async function consumeSseStream(
  stream: ReadableStream<Uint8Array>,
  onData: (data: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];

  const dispatchEvent = () => {
    if (dataLines.length > 0) {
      onData(dataLines.join('\n'));
      dataLines = [];
    }
  };

  const consumeLine = (line: string) => {
    if (line === '') {
      dispatchEvent();
      return;
    }
    if (line.startsWith(':')) return;

    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') dataLines.push(value);
  };

  const consumeCompleteLines = () => {
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) consumeLine(line);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      consumeCompleteLines();
    }
    buffer += decoder.decode();
    if (buffer) consumeLine(buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer);
    dispatchEvent();
  } finally {
    reader.releaseLock();
  }
}
