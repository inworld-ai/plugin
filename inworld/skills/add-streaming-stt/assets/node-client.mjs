import WebSocket from 'ws';
import { createSttSession, sttConfig, STT_URL } from './session.mjs';

// Keep the source's final partial chunk; finish does not call endTurn.
export function startNodeStt({ apiKey, apiBase, ...options }) {
  if (!apiKey) throw new Error('INWORLD_API_KEY is required on the server.');
  const config = sttConfig(options);
  const { audioProtocol = 'BINARY' } = options;
  if (!['JSON', 'BINARY'].includes(audioProtocol)) throw new Error('audioProtocol must be JSON or BINARY.');
  const url = apiBase ? `${apiBase.replace(/^http/, 'ws').replace(/\/$/, '')}/stt/v1/transcribe:streamBidirectional` : STT_URL;
  const socket = new WebSocket(url, { headers: { Authorization: `Basic ${apiKey}` }, perMessageDeflate: false });
  try {
    return createSttSession({ ...options, socket, config });
  } catch (error) {
    // Terminating a pending ws handshake can emit an asynchronous error even
    // when initialization failed before the session installed its listeners.
    socket.on('error', () => {});
    socket.terminate();
    throw error;
  }
}
