import React, { useState, useRef, useEffect, useCallback } from 'react';
import styles from './Previewer.module.css';
import FileInput from '../FileInput/FileInput';
import Timeline from '../Timeline/Timeline';

// --- Types and Helper Components ---

interface ChromaKeySettings {
    keyColor: string;
    similarity: number;
    blend: number;
}

type ExportState = 'idle' | 'processing' | 'completed' | 'failed';

const DropperIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0L12 2.69z"></path>
        <path d="M12 12.69l-5.66-5.66"></path>
    </svg>
);

// --- The Main Component ---

const Previewer: React.FC = () => {
    // --- State Management ---
    const [jobId, setJobId] = useState<string | null>(null);
    const [sourceVideoFile, setSourceVideoFile] = useState<File | null>(null);
    const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
    const [isTransparentMode, setIsTransparentMode] = useState<boolean>(false);

    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState<boolean>(false);
    const [isReadyForPreview, setIsReadyForPreview] = useState<boolean>(false);
    const [isWsConnected, setIsWsConnected] = useState(false);
    const [settings, setSettings] = useState<ChromaKeySettings>({
        keyColor: '#00ff00',
        similarity: 0.2,
        blend: 0.1,
    });

    // Export State
    const [exportState, setExportState] = useState<ExportState>('idle');
    const [exportProgress, setExportProgress] = useState(0);
    const [exportError, setExportError] = useState<string | null>(null);
    const [exportFormat, setExportFormat] = useState<'mp4' | 'prores' | 'webm' | 'gif'>('mp4');

    const [sourceInfo, setSourceInfo] = useState<{ duration: number; width: number; height: number; } | null>(null);
    const [resolution, setResolution] = useState('original_source');
    const [loop, setLoop] = useState('none');
    const [startTime, setStartTime] = useState(0);
    const [endTime, setEndTime] = useState(0);
    const scrubTimeoutRef = useRef<number | null>(null);
    const [outputDuration, setOutputDuration] = useState<number>(0);

    const ws = useRef<WebSocket | null>(null);
    const [fileInputKey, setFileInputKey] = useState(0);

    // --- Core Logic & Handlers ---

    useEffect(() => {
        if (isTransparentMode) {
            setExportFormat('prores');
        }
    }, [isTransparentMode]);


    useEffect(() => {
        const canStartSession = sourceVideoFile && (isTransparentMode || backgroundFile);

        if (canStartSession) {
            const uploadFiles = async () => {
                setIsUploading(true);
                setIsReadyForPreview(false);
                setPreviewImage(null);
                setJobId(null);

                const formData = new FormData();
                formData.append('sourceVideo', sourceVideoFile!);
                formData.append('isTransparent', isTransparentMode ? 'true' : 'false');

                if (!isTransparentMode && backgroundFile) {
                    formData.append('background', backgroundFile);
                }
                formData.append('settings', JSON.stringify(settings));

                try {
                    const response = await fetch('http://localhost:5000/api/process', {
                        method: 'POST',
                        body: formData,
                    });

                    if (!response.ok) throw new Error('File upload failed on the server.');

                    const data = await response.json();
                    setJobId(data.jobId);
                    const duration = data.sourceDuration;
                    setSourceInfo({
                        duration: data.sourceDuration,
                        width: data.sourceWidth,
                        height: data.sourceHeight,
                    });
                    setStartTime(0);
                    setEndTime(duration);
                    setOutputDuration(data.sourceDuration);
                    setIsReadyForPreview(true);
                } catch (error) {
                    console.error('Upload Error:', error);
                    alert('Error uploading files. Please ensure the companion app is running and check the console.');
                } finally {
                    setIsUploading(false);
                }
            };
            uploadFiles();
        } else {
            setIsReadyForPreview(false);
            setJobId(null);
        }
    }, [sourceVideoFile, backgroundFile, isTransparentMode]);

    const requestPreviewUpdate = useCallback((timestamp?: number) => {
        if (ws.current?.readyState === WebSocket.OPEN) {
            const previewSettings = { ...settings, resolution, timestamp };
            ws.current.send(JSON.stringify({
                type: 'update',
                settings: previewSettings,
            }));
        }
    }, [settings, resolution, isWsConnected]);

    useEffect(() => {
        if (!isReadyForPreview || !jobId) {
            return;
        }

        ws.current = new WebSocket('ws://localhost:5000/api/preview');

        ws.current.onopen = () => {
            console.log('WebSocket connected. Initializing with mode:', isTransparentMode ? 'Transparent' : 'Background');
            setIsWsConnected(true);
            ws.current?.send(JSON.stringify({
                type: 'init',
                jobId,
                isTransparent: isTransparentMode,
            }));
            requestPreviewUpdate();
        };

        ws.current.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'preview_frame') {
                setPreviewImage(message.image);
            } else if (message.type === 'error') {
                console.error("Preview Error from Server:", message.message);
            }
        };

        ws.current.onerror = (err) => {
            console.error("WebSocket error:", err);
            setIsWsConnected(false);
        };

        ws.current.onclose = () => {
            setIsWsConnected(false);
            console.log("WebSocket connection closed.");
        };

        return () => {
            if (ws.current?.readyState === WebSocket.OPEN) {
                ws.current.close();
            }
        };
    }, [isReadyForPreview, jobId, isTransparentMode]);

    useEffect(() => {
        const handler = setTimeout(() => {
            if (isReadyForPreview) requestPreviewUpdate();
        }, 100);
        return () => clearTimeout(handler);
    }, [settings, resolution, isReadyForPreview, requestPreviewUpdate]);

    const handleSettingChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type } = e.target;
        const processedValue = type === 'range' || type === 'number' ? parseFloat(value) : value;
        setSettings(prev => ({ ...prev, [name]: processedValue }));
    };

    const handleColorPick = async () => {
        if (!('EyeDropper' in window)) {
            alert('Your browser does not support the EyeDropper API.');
            return;
        }
        try {
            // @ts-ignore
            const eyeDropper = new window.EyeDropper();
            const { sRGBHex } = await eyeDropper.open();
            setSettings(prev => ({ ...prev, keyColor: sRGBHex }));
        } catch (e) {
            console.log('EyeDropper was cancelled.');
        }
    };

    const formatDuration = (totalSeconds: number) => {
        if (isNaN(totalSeconds) || totalSeconds === 0) return '00:00';
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = Math.floor(totalSeconds % 60);
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    const handleExport = async () => {
        if (!jobId) return;
        setExportState('processing');
        setExportProgress(0);
        setExportError(null);

        const exportSettings = {
            ...settings,
            format: isTransparentMode ? 'prores' : exportFormat,
            transparent: isTransparentMode,
            resolution: resolution,
            duration: outputDuration,
            loop: loop,
            startTime,
            endTime,
        };

        try {
            const response = await fetch(`http://localhost:5000/api/export/${jobId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(exportSettings),
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Failed to start export process.');
            }
        } catch (error: any) {
            setExportState('failed');
            setExportError(error.message);
        }
    };

    useEffect(() => {
        if (exportState !== 'processing' || !jobId) return;
        const intervalId = setInterval(async () => {
            try {
                const response = await fetch(`http://localhost:5000/api/status/${jobId}`);
                if (!response.ok) throw new Error('Failed to fetch status.');
                const data = await response.json();
                setExportProgress(data.progress || 0);
                if (data.status === 'completed') {
                    setExportState('completed');
                    clearInterval(intervalId);
                } else if (data.status === 'failed') {
                    setExportState('failed');
                    setExportError(data.error || 'Export failed on the server.');
                    clearInterval(intervalId);
                }
            } catch (error) {
                setExportState('failed');
                setExportError('Could not connect to get status.');
                clearInterval(intervalId);
            }
        }, 2000);
        return () => clearInterval(intervalId);
    }, [exportState, jobId]);

    const resetExport = () => {
        setExportState('idle');
        setExportProgress(0);
        setExportError(null);
    };

    const handleTrimChange = useCallback((newStart: number, newEnd: number) => {
        setStartTime(newStart);
        setEndTime(newEnd);
    }, []);

    const handleScrub = useCallback((time: number) => {
        if (scrubTimeoutRef.current) {
            clearTimeout(scrubTimeoutRef.current);
        }
        scrubTimeoutRef.current = setTimeout(() => {
            requestPreviewUpdate(time);
        }, 50);
    }, [requestPreviewUpdate]);

    return (
        <div className={styles.container}>
            <main className={styles.main}>
                <div className={styles.previewArea}>
                    {previewImage ? (
                        <img src={previewImage} alt="Video Preview" className={styles.canvas} />
                    ) : (
                        <div className={styles.placeholder}>
                            {isUploading && <h3>Uploading files, please wait...</h3>}
                            {!isUploading && !sourceVideoFile && <h3>Select a source video to begin.</h3>}
                            {!isUploading && sourceVideoFile && !isTransparentMode && !backgroundFile && <h3>Select a background file.</h3>}
                        </div>
                    )}
                </div>
            </main>

            <aside className={styles.controlsPanel}>
                <h2 className={styles.panelTitle}>Green Screen Studio</h2>

                <fieldset className={styles.fieldset}>
                    <legend>1. Load Files</legend>
                    <div className={styles.controlGroup}>
                        <label className={styles.checkboxLabel}>
                            <input type="checkbox" checked={isTransparentMode} onChange={(e) => {
                                if (e.target.checked) setBackgroundFile(null);
                                setIsTransparentMode(e.target.checked);
                            }} />
                            Export with Transparent Background
                        </label>
                    </div>
                    <div className={styles.fileInputsContainer}>
                        <FileInput key={`source-${fileInputKey}`} label="Source Video" acceptedTypes="video/*" onFileSelect={setSourceVideoFile} />
                        {!isTransparentMode && (
                            <FileInput key={`background-${fileInputKey}`} label="Background" acceptedTypes="image/*,video/*" onFileSelect={setBackgroundFile} />
                        )}
                    </div>
                </fieldset>

                <fieldset className={styles.fieldset} disabled={!isReadyForPreview}>
                    <legend>2. Adjust Settings</legend>
                    <div className={styles.controlGroup}>
                        <label htmlFor="keyColor" className={styles.label}>Key Color
                            <span className={styles.colorSwatch} style={{ backgroundColor: settings.keyColor }}></span>
                            <button className={styles.iconButton} title="Pick color from preview" onClick={handleColorPick}>
                                <DropperIcon />
                            </button>
                        </label>
                        <input id="keyColor" name="keyColor" type="color" value={settings.keyColor} onChange={handleSettingChange} className={styles.input} />
                    </div>
                    <div className={styles.controlGroup}>
                        <label htmlFor="similarity" className={styles.label}>Similarity: {settings.similarity.toFixed(2)}</label>
                        <input id="similarity" name="similarity" type="range" min="0.01" max="0.8" step="0.01" value={settings.similarity} onChange={handleSettingChange} className={styles.input} />
                    </div>
                    <div className={styles.controlGroup}>
                        <label htmlFor="blend" className={styles.label}>Blend: {settings.blend.toFixed(2)}</label>
                        <input id="blend" name="blend" type="range" min="0" max="0.5" step="0.01" value={settings.blend} onChange={handleSettingChange} className={styles.input} />
                    </div>
                </fieldset>

                <fieldset className={styles.fieldset} disabled={!isReadyForPreview}>
                    <legend>3. Output Settings</legend>
                    <div className={styles.controlGroup}>
                        <label htmlFor="format" className={styles.label}>Export Format</label>
                        <select id="format" name="format" value={exportFormat} onChange={(e) => setExportFormat(e.target.value as any)} disabled={isTransparentMode} className={styles.input}>
                            <option value="mp4">MP4 (H.264)</option>
                            <option value="prores">ProRes 422 HQ (MOV)</option>
                            <option value="webm">WebM (VP9)</option>
                            <option value="gif">Animated GIF</option>
                        </select>
                    </div>
                    <div className={styles.controlGroup}>
                        <label htmlFor="resolution" className={styles.label}>Resolution</label>
                        <select id="resolution" name="resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} className={styles.input}>
                            <option value="original_source">Match Source ({sourceInfo ? `${sourceInfo.width}x${sourceInfo.height}` : '...'})</option>
                            <option value="4k">4K (3840x2160)</option>
                            <option value="1080p">1080p (1920x1080)</option>
                            <option value="720p">720p (1280x720)</option>
                        </select>
                    </div>

                    <div className={styles.controlGroup}>
                        <label className={styles.label}>Timeline / Trim</label>
                        <Timeline
                            duration={sourceInfo?.duration || 0}
                            onTrimChange={handleTrimChange}
                            onScrub={handleScrub}
                            disabled={!isReadyForPreview}
                        />
                    </div>

                    <div className={styles.controlGroup}>
                        <label htmlFor="loop" className={styles.label}>Looping</label>
                        <select id="loop" name="loop" value={loop} onChange={(e) => setLoop(e.target.value)} disabled={isTransparentMode} className={styles.input}>
                            <option value="none">None</option>
                            <option value="source">Loop Source Video</option>
                            <option value="background">Loop Background</option>
                        </select>
                    </div>
                </fieldset>

                <fieldset className={styles.fieldset} disabled={!isReadyForPreview}>
                    <legend>4. Export</legend>
                    {exportState === 'idle' && (
                        <button className={styles.exportButton} disabled={!isReadyForPreview || isUploading} onClick={handleExport}>
                            Export Video
                        </button>
                    )}
                    {exportState === 'processing' && (
                        <div className={styles.progressContainer}>
                            <div className={styles.progressLabel}>Processing... {exportProgress.toFixed(0)}%</div>
                            <div className={styles.progressBar}><div className={styles.progressBarFill} style={{ width: `${exportProgress}%` }}></div></div>
                        </div>
                    )}
                    {exportState === 'completed' && (
                        <div className={styles.completedContainer}>
                            <p>✅ Export Complete!</p>
                            <a href={`http://localhost:5000/api/download/${jobId}`} className={styles.exportButton} download>Download File</a>
                            <button onClick={resetExport} className={styles.resetButton}>Start New Export</button>
                        </div>
                    )}
                    {exportState === 'failed' && (
                        <div className={styles.failedContainer}>
                            <p>❌ Export Failed</p>
                            <small>{exportError}</small>
                            <button onClick={handleExport} className={styles.resetButton}>Try Again</button>
                        </div>
                    )}
                </fieldset>
            </aside>
        </div>
    );
};

export default Previewer;