import { useState, useEffect } from 'react';

type CompanionStatus = 'connected' | 'disconnected';

const COMPANION_URL = 'http://localhost:5000/health';
const POLLING_INTERVAL = 2500;

export function useCompanionStatus() {
    const [status, setStatus] = useState<CompanionStatus>('disconnected');
    const [isPolling, setIsPolling] = useState<boolean>(true);

    useEffect(() => {
        const checkStatus = async () => {
            setIsPolling(true);
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), POLLING_INTERVAL - 100);

                const response = await fetch(COMPANION_URL, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (response.ok && (await response.json()).status === 'ok') {
                    setStatus('connected');
                } else {
                    setStatus('disconnected');
                }
            } catch (error) {
                setStatus('disconnected');
            } finally {
                setIsPolling(false);
            }
        };

        checkStatus();

        const intervalId = setInterval(checkStatus, POLLING_INTERVAL);

        return () => {
            clearInterval(intervalId);
        };
    }, []);

    return { status, isPolling };
}