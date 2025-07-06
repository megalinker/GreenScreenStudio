import { useState, useEffect, useRef } from 'react';

type CompanionStatus = 'connected' | 'disconnected';

const COMPANION_URL = 'http://localhost:5000/health';
const POLLING_INTERVAL = 2500;
const FAILURE_THRESHOLD = 2;

export function useCompanionStatus() {
    const [status, setStatus] = useState<CompanionStatus>('disconnected');
    const [isPolling, setIsPolling] = useState<boolean>(true);
    const failureCountRef = useRef(0);

    useEffect(() => {
        const checkStatus = async () => {
            setIsPolling(true);
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), POLLING_INTERVAL - 100);

                const response = await fetch(COMPANION_URL, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (response.ok && (await response.json()).status === 'ok') {
                    failureCountRef.current = 0;
                    setStatus('connected');
                } else {
                    failureCountRef.current++;
                }
            } catch (error) {
                failureCountRef.current++;
            }

            if (failureCountRef.current >= FAILURE_THRESHOLD) {
                setStatus('disconnected');
            }

            setIsPolling(false);
        };

        checkStatus();
        const intervalId = setInterval(checkStatus, POLLING_INTERVAL);

        return () => {
            clearInterval(intervalId);
        };
    }, []);

    return { status, isPolling };
}