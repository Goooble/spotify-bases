import { useEffect, useState } from 'react';
import { spotify } from './spotify';
export function useRateLimit() {
  const [state, setState] = useState(() => spotify.rateLimit.read());
  const [now, setNow] = useState(Date.now);
  useEffect(() => spotify.rateLimit.subscribe(setState), []);
  useEffect(() => {
    setNow(Date.now());
    if (!state || state.retryAt <= Date.now()) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= state.retryAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [state]);
  return { state, seconds: state ? Math.max(0, Math.ceil((state.retryAt - now) / 1000)) : 0 };
}
