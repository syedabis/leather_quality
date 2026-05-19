"use client";
import { useEffect, useRef, useCallback, useState } from 'react';
import type { WsMessage } from '../types';

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000];

/**
 * useWebSocket — connects to a single WebSocket URL with auto-reconnect.
 *
 * Returns:
 *   lastMessage  – last parsed JSON message (or null)
 *   connected    – boolean
 *   readyState   – WebSocket.CONNECTING / OPEN / CLOSING / CLOSED
 */
export function useWebSocket<T = WsMessage>(url: string) {
  const [lastMessage, setLastMessage] = useState<T | null>(null);
  const [connected,   setConnected]   = useState(false);
  const [readyState,  setReadyState]  = useState<number>(WebSocket.CLOSED);

  const wsRef      = useRef<WebSocket | null>(null);
  const retryRef   = useRef(0);
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!url || !mountedRef.current) return;

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      setReadyState(WebSocket.CONNECTING);

      ws.onopen = () => {
        if (!mountedRef.current) return;
        retryRef.current = 0;
        setConnected(true);
        setReadyState(WebSocket.OPEN);
      };

      ws.onmessage = (e: MessageEvent<string>) => {
        if (!mountedRef.current) return;
        try {
          setLastMessage(JSON.parse(e.data) as T);
        } catch {
          // not JSON — ignore
        }
      };

      ws.onerror = () => { /* onclose will handle */ };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        setReadyState(WebSocket.CLOSED);
        const delay = RECONNECT_DELAYS[Math.min(retryRef.current, RECONNECT_DELAYS.length - 1)];
        retryRef.current++;
        timerRef.current = setTimeout(connect, delay);
      };
    } catch (err) {
      // WebSocket constructor can throw in SSR / bad URL
      console.warn('[useWebSocket] Could not connect:', (err as Error).message);
    }
  }, [url]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { lastMessage, connected, readyState };
}
