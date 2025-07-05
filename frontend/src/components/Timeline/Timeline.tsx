import React, { useState, useRef, useEffect, useCallback } from 'react';
import styles from './Timeline.module.css';

interface TimelineProps {
    duration: number;
    onTrimChange: (start: number, end: number) => void;
    onScrub: (time: number) => void;
    disabled?: boolean;
}

const formatTime = (seconds: number) => {
    const floorSeconds = Math.floor(seconds);
    const min = Math.floor(floorSeconds / 60);
    const sec = floorSeconds % 60;
    const ms = Math.round((seconds - floorSeconds) * 100);
    return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

const Timeline: React.FC<TimelineProps> = ({ duration, onTrimChange, onScrub, disabled = false }) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const [startTime, setStartTime] = useState(0);
    const [endTime, setEndTime] = useState(duration);
    const [scrubberPosition, setScrubberPosition] = useState(0);
    const [isDragging, setIsDragging] = useState<'start' | 'end' | 'scrub' | null>(null);

    useEffect(() => {
        setEndTime(duration);
    }, [duration]);

    const pixelsToSeconds = useCallback((pixels: number) => {
        if (!trackRef.current) return 0;
        const rect = trackRef.current.getBoundingClientRect();
        return (pixels / rect.width) * duration;
    }, [duration]);

    const secondsToPixels = useCallback((seconds: number) => {
        if (!trackRef.current || !duration) return 0;
        const rect = trackRef.current.getBoundingClientRect();
        return (seconds / duration) * rect.width;
    }, [duration]);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isDragging || !trackRef.current) return;
        const rect = trackRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        let newTime = pixelsToSeconds(mouseX);
        newTime = Math.max(0, Math.min(duration, newTime));

        if (isDragging === 'start') {
            const newStartTime = Math.min(newTime, endTime);
            setStartTime(newStartTime);
        } else if (isDragging === 'end') {
            const newEndTime = Math.max(newTime, startTime);
            setEndTime(newEndTime);
        } else if (isDragging === 'scrub') {
            setScrubberPosition(newTime);
            onScrub(newTime);
        }
    }, [isDragging, pixelsToSeconds, startTime, endTime, duration, onScrub]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(null);
        if (isDragging === 'start' || isDragging === 'end') {
            onTrimChange(startTime, endTime);
        }
    }, [isDragging, onTrimChange, startTime, endTime]);

    useEffect(() => {
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [handleMouseMove, handleMouseUp]);

    const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (disabled || !trackRef.current) return;
        const rect = trackRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const newTime = pixelsToSeconds(mouseX);
        setScrubberPosition(newTime);
        onScrub(newTime);
    };

    const startHandlePosition = secondsToPixels(startTime);
    const endHandlePosition = secondsToPixels(endTime);
    const scrubHandlePosition = secondsToPixels(scrubberPosition);

    return (
        <div className={styles.timelineContainer}>
            <div ref={trackRef} className={styles.track} onClick={handleTrackClick}>
                <div
                    className={styles.selectedRange}
                    style={{ left: `${startHandlePosition}px`, width: `${endHandlePosition - startHandlePosition}px` }}
                />
                <div
                    className={styles.handle}
                    style={{ left: `${startHandlePosition}px`, transform: 'translate(-50%, -50%)' }}
                    onMouseDown={() => !disabled && setIsDragging('start')}
                />
                <div
                    className={styles.handle}
                    style={{ left: `${endHandlePosition}px`, transform: 'translate(-50%, -50%)' }}
                    onMouseDown={() => !disabled && setIsDragging('end')}
                />
                <div className={styles.scrubber} style={{ left: `${scrubHandlePosition}px` }} />
                <div
                    className={styles.scrubberHandle}
                    style={{ left: `${scrubHandlePosition}px` }}
                    onMouseDown={() => !disabled && setIsDragging('scrub')}
                />
            </div>
            <div className={styles.timeLabels}>
                <span>{formatTime(startTime)}</span>
                <span>{formatTime(endTime)}</span>
            </div>
        </div>
    );
};

export default Timeline;