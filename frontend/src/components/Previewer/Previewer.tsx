import React, { useState, useRef, useEffect, useCallback } from 'react';
import styles from './Previewer.module.css';
import FileInput from '../FileInput/FileInput';
import Timeline from '../Timeline/Timeline';
import CollapsibleSection from '../CollapsibleSection/CollapsibleSection';
import Konva from 'konva';
import { Stage, Layer, Image as KonvaImage, Transformer } from 'react-konva';
import useImage from 'use-image';
import ThemeToggleButton from '../ThemeToggleButton/ThemeToggleButton';

// --- Custom Hooks ---
function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);
        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);
    return debouncedValue;
}

// --- Types and Helper Components ---
interface ChromaKeySettings {
    keyColor: string;
    similarity: number;
    blend: number;
}

interface Transform {
    x: number;
    y: number;
    scale: number;
    width: number;
    height: number;
}

type ProcessState = 'idle' | 'processing' | 'completed' | 'failed';

interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number,
}

interface MediaProperties {
    width: number;
    height: number;
    duration: number;
}

const SNAP_TOLERANCE = 8;

const DropperIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0L12 2.69z"></path>
        <path d="M12 12.69l-5.66-5.66"></path>
    </svg>
);

const checkerboardPattern = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAACJJREFUeNpiZGBg6AGAgwITg3j4f8jB4w1iEEMsGgAIMAANlQI9e8n5kgAAAABJRU5ErkJggg==';

// --- Main Component ---

const Previewer: React.FC = () => {
    // --- State Management ---
    const logicalWidth = 1280;
    const logicalHeight = 720;
    const [jobId, setJobId] = useState<string | null>(null);
    const [sourceVideoFile, setSourceVideoFile] = useState<File | null>(null);
    const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
    const [isTransparentMode, setIsTransparentMode] = useState<boolean>(false);
    const [isKeyingEnabled, setIsKeyingEnabled] = useState<boolean>(true);

    const [previewImage, setPreviewImage] = useState<string | null>(null);
    const [backgroundPreviewUrl, setBackgroundPreviewUrl] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState<boolean>(false);
    const [isReadyForPreview, setIsReadyForPreview] = useState<boolean>(false);
    const [isPickingColor, setIsPickingColor] = useState<boolean>(false);
    const [isTransforming, setIsTransforming] = useState<boolean>(false);
    const [isAwaitingFrameForDropper, setIsAwaitingFrameForDropper] = useState(false);
    const [settings, setSettings] = useState<ChromaKeySettings>({
        keyColor: '#00ff00',
        similarity: 0.2,
        blend: 0.1,
    });

    // Transform State
    const [foregroundTransform, setForegroundTransform] = useState<Transform>({ x: 0, y: 0, scale: 1, width: 0, height: 0 });
    const [backgroundTransform, setBackgroundTransform] = useState<Transform>({ x: 0, y: 0, scale: 1, width: 0, height: 0 });
    const [selectedShapeName, setSelectedShapeName] = useState<string | null>(null);
    const debouncedSettings = useDebounce(settings, 200);
    const debouncedFgTransform = useDebounce(foregroundTransform, 200);
    const debouncedBgTransform = useDebounce(backgroundTransform, 200);

    // Undo/Redo History State
    const [history, setHistory] = useState<{ fg: Transform, bg: Transform }[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    // Viewport Scaling State
    const [availableSize, setAvailableSize] = useState({ width: 0, height: 0 });
    const [viewportScale, setViewportScale] = useState<number | 'fit'>('fit');

    // Process State
    const [exportState, setExportState] = useState<ProcessState>('idle');
    const [exportProgress, setExportProgress] = useState(0);
    const [previewProgress, setPreviewProgress] = useState(0);
    const [exportError, setExportError] = useState<string | null>(null);
    const [previewGenState, setPreviewGenState] = useState<Omit<ProcessState, 'completed'>>('idle');
    const [isPreviewModeActive, setIsPreviewModeActive] = useState(false);
    const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
    const lastActionRef = useRef<'preview' | 'export' | null>(null);


    const [exportFormat, setExportFormat] = useState<'mp4' | 'prores' | 'webm' | 'gif'>('mp4');

    const [sourceInfo, setSourceInfo] = useState<MediaProperties | null>(null);
    const [backgroundInfo, setBackgroundInfo] = useState<MediaProperties | null>(null);
    const [resolution, setResolution] = useState('720p');
    const [loop, setLoop] = useState('none');
    const [startTime, setStartTime] = useState(0);
    const [endTime, setEndTime] = useState(0);
    const scrubTimeoutRef = useRef<number | null>(null);

    const ws = useRef<WebSocket | null>(null);
    const [fileInputKey, setFileInputKey] = useState(0);

    // --- Konva & DOM Refs ---
    const mainAreaRef = useRef<HTMLDivElement>(null);
    const transformerRef = useRef<Konva.Transformer>(null);
    const [konvaFgImage] = useImage(previewImage || '', 'anonymous');
    const [konvaBgImage] = useImage(backgroundPreviewUrl || '', 'anonymous');

    useEffect(() => {
        if (isAwaitingFrameForDropper && konvaFgImage) {
            const openDropper = async () => {
                try {
                    // @ts-ignore
                    const eyeDropper = new window.EyeDropper();
                    const { sRGBHex } = await eyeDropper.open();
                    setSettings(prev => ({ ...prev, keyColor: sRGBHex }));
                } catch (e) {
                    console.log('EyeDropper was cancelled.');
                } finally {
                    setIsAwaitingFrameForDropper(false);
                    setIsPickingColor(false);
                }
            };

            openDropper();
        }
    }, [isAwaitingFrameForDropper, konvaFgImage]);

    // --- Helper Functions ---
    const getInitialFgTransform = (sourceWidth: number, sourceHeight: number) => {
        const logicalCanvasWidth = 1280;
        const logicalCanvasHeight = 720;

        const scaleX = logicalCanvasWidth / sourceWidth;
        const scaleY = logicalCanvasHeight / sourceHeight;

        const initialFitScale = Math.min(scaleX, scaleY);

        const scaledWidth = sourceWidth * initialFitScale;
        const scaledHeight = sourceHeight * initialFitScale;

        const x = (logicalCanvasWidth - scaledWidth) / 2;
        const y = (logicalCanvasHeight - scaledHeight) / 2;

        return {
            width: sourceWidth,
            height: sourceHeight,
            scale: initialFitScale,
            x: x,
            y: y,
        };
    };

    const getInitialBgTransform = (bgWidth: number, bgHeight: number) => {
        if (!bgWidth || !bgHeight) return { x: 0, y: 0, scale: 1, width: 0, height: 0 };
        const logicalCanvasWidth = 1280;
        const logicalCanvasHeight = 720;

        const scaleX = logicalCanvasWidth / bgWidth;
        const scaleY = logicalCanvasHeight / bgHeight;

        const coverScale = Math.max(scaleX, scaleY);

        const scaledWidth = bgWidth * coverScale;
        const scaledHeight = bgHeight * coverScale;

        const x = (logicalCanvasWidth - scaledWidth) / 2;
        const y = (logicalCanvasHeight - scaledHeight) / 2;

        return {
            width: bgWidth,
            height: bgHeight,
            scale: coverScale,
            x: x,
            y: y,
        };
    };

    const resetStateForNewJob = () => {
        setIsReadyForPreview(false);
        setPreviewImage(null);
        setJobId(null);
        setExportState('idle');
        setExportProgress(0);
        setExportError(null);
        setSelectedShapeName(null);
        setHistory([]);
        setHistoryIndex(-1);
        setIsPreviewModeActive(false);
        setPreviewGenState('idle');
        setPreviewVideoUrl(null);
        lastActionRef.current = null;
    };

    const resetExport = () => {
        setExportState('idle');
        setExportProgress(0);
        setExportError(null);
    };

    // --- Core Logic & Handlers ---

    useEffect(() => {
        const handleFocus = () => {
            if (isPickingColor) {
                setIsPickingColor(false);
            }
        };
        window.addEventListener('focus', handleFocus);
        return () => {
            window.removeEventListener('focus', handleFocus);
        };
    }, [isPickingColor]);

    useEffect(() => {
        const mainEl = mainAreaRef.current;
        if (!mainEl) return;

        const observer = new ResizeObserver(() => {
            const { width, height } = mainEl.getBoundingClientRect();
            const padding = 4 * parseFloat(getComputedStyle(mainEl).fontSize);
            if (width > 0 && height > 0) {
                setAvailableSize({ width: width - padding, height: height - padding });
            }
        });

        observer.observe(mainEl);
        const { width, height } = mainEl.getBoundingClientRect();
        const padding = 4 * parseFloat(getComputedStyle(mainEl).fontSize);
        if (width > 0 && height > 0) {
            setAvailableSize({ width: width - padding, height: height - padding });
        }

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (isTransparentMode) {
            setExportFormat('prores');
        }
    }, [isTransparentMode]);

    // This effect runs when a source file is selected and its properties are extracted
    useEffect(() => {
        if (sourceInfo) {
            const initialFg = getInitialFgTransform(sourceInfo.width, sourceInfo.height);
            const initialBg = backgroundInfo ? getInitialBgTransform(backgroundInfo.width, backgroundInfo.height) : backgroundTransform;

            setForegroundTransform(initialFg);
            setBackgroundTransform(initialBg);

            setHistory([{ fg: initialFg, bg: initialBg }]);
            setHistoryIndex(0);
            setStartTime(0);
            setEndTime(sourceInfo.duration);
        }
    }, [sourceInfo, backgroundInfo]);


    // This effect triggers the upload once all required files are present
    useEffect(() => {
        const canStartSession = sourceVideoFile && sourceInfo && (isTransparentMode || (backgroundFile && backgroundInfo));
        if (canStartSession) {
            const uploadFiles = async () => {
                resetStateForNewJob();
                setIsUploading(true);
                const formData = new FormData();
                formData.append('sourceVideo', sourceVideoFile);
                formData.append('sourceProperties', JSON.stringify(sourceInfo));
                formData.append('isTransparent', isTransparentMode ? 'true' : 'false');
                if (!isTransparentMode && backgroundFile && backgroundInfo) {
                    formData.append('background', backgroundFile);
                    formData.append('backgroundProperties', JSON.stringify(backgroundInfo));
                }

                try {
                    const response = await fetch('http://localhost:5000/api/process', { method: 'POST', body: formData });
                    if (!response.ok) throw new Error('File upload failed on the server.');
                    const data = await response.json();
                    setJobId(data.jobId);
                    setIsReadyForPreview(true);
                } catch (error) {
                    console.error('Upload Error:', error);
                    alert('Error uploading files. Please ensure the companion app is running.');
                } finally {
                    setIsUploading(false);
                }
            };
            uploadFiles();
        }
    }, [sourceVideoFile, sourceInfo, backgroundFile, backgroundInfo, isTransparentMode]);

    const requestPreviewUpdate = useCallback((timestamp?: number) => {
        if (ws.current?.readyState === WebSocket.OPEN && jobId) {
            const transforms = { foreground: debouncedFgTransform, background: debouncedBgTransform };

            const previewSettings = {
                ...debouncedSettings,
                resolution,
                timestamp,
                transforms,
                isKeyingEnabled,
                isPreviewingColorPick: isPickingColor,
            };

            ws.current.send(JSON.stringify({ type: 'update', settings: previewSettings }));
        }
    }, [jobId, debouncedSettings, resolution, debouncedFgTransform, debouncedBgTransform, isPickingColor, isKeyingEnabled]);

    useEffect(() => {
        if (isReadyForPreview) {
            requestPreviewUpdate();
        }
    }, [isPickingColor, isReadyForPreview, requestPreviewUpdate, isKeyingEnabled]);

    useEffect(() => {
        if (!isReadyForPreview || !jobId) return;
        ws.current = new WebSocket('ws://localhost:5000/api/preview');
        ws.current.onopen = () => {
            ws.current?.send(JSON.stringify({ type: 'init', jobId }));
            requestPreviewUpdate();
        };
        ws.current.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === 'preview_frame') setPreviewImage(message.image);
            else if (message.type === 'error') console.error("Preview Error:", message.message);
        };
        return () => { ws.current?.close(); };
    }, [isReadyForPreview, jobId]);

    useEffect(() => {
        if (isReadyForPreview && !isTransforming) {
            requestPreviewUpdate();
        }
    }, [isReadyForPreview, requestPreviewUpdate, isTransforming]);


    useEffect(() => {
        if (!transformerRef.current) return;

        const transformer = transformerRef.current;
        const stage = transformer.getStage();

        if (!stage || !selectedShapeName) {
            transformer.nodes([]);
            transformer.getLayer()?.batchDraw();
            return;
        }

        const selectedNode = stage.findOne(`.${selectedShapeName}`);

        if (selectedNode) {
            transformer.nodes([selectedNode]);
        } else {
            transformer.nodes([]);
        }

        transformer.getLayer()?.batchDraw();

    }, [selectedShapeName, konvaFgImage, konvaBgImage]);

    const handleTransformStart = () => {
        setIsTransforming(true);
    };

    const handleSettingChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        const isRange = (e.target as HTMLInputElement).type === 'range';
        setSettings(prev => ({ ...prev, [name]: isRange ? parseFloat(value) : value }));
    };

    const handleColorPick = async () => {
        if (!('EyeDropper' in window)) {
            alert('Your browser does not support the EyeDropper API.');
            return;
        }

        setPreviewImage(null);
        setIsAwaitingFrameForDropper(true);
        setIsPickingColor(true);
    };

    const handleProcessPreview = async () => {
        if (!jobId) return;
        lastActionRef.current = 'preview';
        setPreviewGenState('processing');
        setPreviewProgress(0);
        const previewSettings = {
            ...settings,
            transparent: isTransparentMode,
            isKeyingEnabled,
            resolution: resolution,
            loop: loop,
            startTime,
            endTime,
            transforms: { foreground: foregroundTransform, background: backgroundTransform },
        };

        try {
            const response = await fetch(`http://localhost:5000/api/process-preview/${jobId}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(previewSettings),
            });
            if (!response.ok) throw new Error((await response.json()).error || 'Failed to start preview generation.');
        } catch (error: any) {
            setPreviewGenState('failed');
            console.error(error.message);
        }
    }

    const handleExitPreviewMode = () => {
        setIsPreviewModeActive(false);
        setPreviewVideoUrl(null);
        requestPreviewUpdate();
    }

    const handleExport = async () => {
        if (!jobId) return;
        lastActionRef.current = 'export';
        setExportState('processing');
        setExportProgress(0);
        setExportError(null);
        const exportSettings = {
            ...settings,
            format: isTransparentMode ? 'prores' : exportFormat,
            transparent: isTransparentMode,
            isKeyingEnabled,
            resolution: resolution,
            loop: loop,
            startTime,
            endTime,
            transforms: { foreground: foregroundTransform, background: backgroundTransform },
        };
        try {
            const response = await fetch(`http://localhost:5000/api/export/${jobId}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(exportSettings),
            });
            if (!response.ok) throw new Error((await response.json()).error || 'Failed to start export.');
        } catch (error: any) {
            setExportState('failed');
            setExportError(error.message);
        }
    };

    useEffect(() => {
        if (!jobId || (previewGenState !== 'processing' && exportState !== 'processing')) {
            return;
        }

        const intervalId = setInterval(async () => {
            try {
                const response = await fetch(`http://localhost:5000/api/status/${jobId}`);
                if (!response.ok) throw new Error('Status fetch failed.');
                const data = await response.json();

                if (data.status === 'completed') {
                    setExportState('completed');
                    setExportProgress(100);
                    clearInterval(intervalId);
                } else if (data.status === 'preview_completed') {
                    setPreviewGenState('idle');
                    setPreviewProgress(100);
                    setIsPreviewModeActive(true);
                    setPreviewVideoUrl(`http://localhost:5000/api/preview-video/${jobId}?t=${new Date().getTime()}`);
                    clearInterval(intervalId);
                } else if (data.status === 'failed') {
                    const errorMsg = data.error || 'Unknown error.';
                    if (lastActionRef.current === 'export') {
                        setExportState('failed');
                        setExportError(errorMsg);
                    } else if (lastActionRef.current === 'preview') {
                        setPreviewGenState('failed');
                    }
                    clearInterval(intervalId);
                } else if (data.status === 'processing' || data.status === 'preview_processing') {
                    if (lastActionRef.current === 'export') {
                        setExportProgress(data.progress || 0);
                    } else if (lastActionRef.current === 'preview') {
                        setPreviewProgress(data.progress || 0);
                    }
                }
            } catch (error) {
                const errorMsg = 'Could not get status from server.';
                if (lastActionRef.current === 'export') {
                    setExportState('failed');
                    setExportError(errorMsg);
                } else if (lastActionRef.current === 'preview') {
                    setPreviewGenState('failed');
                }
                clearInterval(intervalId);
            }
        }, 2000);

        return () => clearInterval(intervalId);
    }, [previewGenState, exportState, jobId]);


    const handleTrimChange = useCallback((newStart: number, newEnd: number) => {
        setStartTime(newStart);
        setEndTime(newEnd);
    }, []);

    const handleScrub = useCallback((time: number) => {
        if (scrubTimeoutRef.current) clearTimeout(scrubTimeoutRef.current);
        scrubTimeoutRef.current = window.setTimeout(() => requestPreviewUpdate(time), 50);
    }, [requestPreviewUpdate]);

    const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
        if (e.target === e.target.getStage()) {
            setSelectedShapeName(null);
            return;
        }

        const clickedOnTransformer = e.target.getParent()?.className === 'Transformer';
        if (clickedOnTransformer) {
            return;
        }

        const name = e.target.name();
        if (name === 'foreground' || name === 'background') {
            setSelectedShapeName(name);
        } else {
            setSelectedShapeName(null);
        }
    };

    const pushHistory = useCallback((fg: Transform, bg: Transform) => {
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push({ fg, bg });
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
    }, [history, historyIndex]);

    const handleTransform = useCallback((e: Konva.KonvaEventObject<Event>) => {
        const node = e.target as Konva.Node;
        if (!node) return;

        const scaleX = node.scaleX();
        const scaleY = node.scaleY();

        node.scaleX(Math.abs(scaleX));
        node.scaleY(Math.abs(scaleY));

        const name = node.name();
        const transformState = {
            x: node.x(),
            y: node.y(),
            scale: node.scaleX(),
            width: name === 'foreground' ? foregroundTransform.width : backgroundTransform.width,
            height: name === 'foreground' ? foregroundTransform.height : backgroundTransform.height,
        };

        if (name === 'foreground') {
            setForegroundTransform(transformState);
        } else if (name === 'background') {
            setBackgroundTransform(transformState);
        }
    }, [foregroundTransform, backgroundTransform]);

    const handleNodeDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
        const node = e.target as Konva.Node;
        const scale = node.scaleX();
        const scaledWidth = node.width() * scale;
        const scaledHeight = node.height() * scale;

        let x = node.x();
        let y = node.y();

        // Snap to left/right edges
        if (Math.abs(x) < SNAP_TOLERANCE) {
            x = 0;
        } else if (Math.abs(x + scaledWidth - logicalWidth) < SNAP_TOLERANCE) {
            x = logicalWidth - scaledWidth;
        }

        // Snap to top/bottom edges
        if (Math.abs(y) < SNAP_TOLERANCE) {
            y = 0;
        } else if (Math.abs(y + scaledHeight - logicalHeight) < SNAP_TOLERANCE) {
            y = logicalHeight - scaledHeight;
        }

        // Snap to horizontal center
        if (Math.abs(x + scaledWidth / 2 - logicalWidth / 2) < SNAP_TOLERANCE) {
            x = logicalWidth / 2 - scaledWidth / 2;
        }

        // Snap to vertical center
        if (Math.abs(y + scaledHeight / 2 - logicalHeight / 2) < SNAP_TOLERANCE) {
            y = logicalHeight / 2 - scaledHeight / 2;
        }

        node.position({ x, y });
        node.getLayer()?.draw();
    }, []);

    const handleNodeDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
        setIsTransforming(false);
        const node = e.target;
        const name = node.name();
        const transformState = {
            x: node.x(),
            y: node.y(),
            scale: node.scaleX(),
            width: name === 'foreground' ? foregroundTransform.width : backgroundTransform.width,
            height: name === 'foreground' ? foregroundTransform.height : backgroundTransform.height,
        };

        if (name === 'foreground') {
            setForegroundTransform(transformState);
            pushHistory(transformState, backgroundTransform);
        } else if (name === 'background') {
            setBackgroundTransform(transformState);
            pushHistory(foregroundTransform, transformState);
        }
    };

    const handleTransformEnd = () => {
        setIsTransforming(false);
        pushHistory(foregroundTransform, backgroundTransform);
    };

    const newBoundBoxFunc = (oldBox: BoundingBox, newBox: BoundingBox): BoundingBox => {
        if (newBox.width < 20 || newBox.height < 20) {
            return oldBox;
        }

        const horizontalGuides = [0, logicalWidth / 2, logicalWidth];
        const verticalGuides = [0, logicalHeight / 2, logicalHeight];

        let newX = newBox.x;
        let newY = newBox.y;
        let newWidth = newBox.width;
        let newHeight = newBox.height;

        horizontalGuides.forEach(gx => {
            if (Math.abs(newX - gx) < SNAP_TOLERANCE) newX = gx;
            if (Math.abs(newX + newWidth - gx) < SNAP_TOLERANCE) newWidth = gx - newX;
        });

        verticalGuides.forEach(gy => {
            if (Math.abs(newY - gy) < SNAP_TOLERANCE) newY = gy;
            if (Math.abs(newY + newHeight - gy) < SNAP_TOLERANCE) newHeight = gy - newY;
        });

        return { x: newX, y: newY, width: newWidth, height: newHeight, rotation: newBox.rotation };
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const isUndo = (e.ctrlKey || e.metaKey) && e.key === 'z';
            const isRedo = (e.ctrlKey || e.metaKey) && e.key === 'y';

            if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') {
                return;
            }

            if (isUndo) {
                e.preventDefault();
                if (historyIndex > 0) {
                    const newIndex = historyIndex - 1;
                    setHistoryIndex(newIndex);
                    const prevState = history[newIndex];
                    setForegroundTransform(prevState.fg);
                    setBackgroundTransform(prevState.bg);
                }
            } else if (isRedo) {
                e.preventDefault();
                if (historyIndex < history.length - 1) {
                    const newIndex = historyIndex + 1;
                    setHistoryIndex(newIndex);
                    const nextState = history[newIndex];
                    setForegroundTransform(nextState.fg);
                    setBackgroundTransform(nextState.bg);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [history, historyIndex]);

    const handleResetTransform = () => {
        if (selectedShapeName === 'foreground' && sourceInfo) {
            const newFg = getInitialFgTransform(sourceInfo.width, sourceInfo.height);
            setForegroundTransform(newFg);
            pushHistory(newFg, backgroundTransform);
        } else if (selectedShapeName === 'background' && backgroundTransform.width > 0) {
            const newBg = getInitialBgTransform(backgroundTransform.width, backgroundTransform.height);
            setBackgroundTransform(newBg);
            pushHistory(foregroundTransform, newBg);
        }
    };

    const currentTransform = selectedShapeName === 'foreground' ? foregroundTransform : backgroundTransform;
    const logicalRatio = logicalWidth / logicalHeight;
    let fitWidth = 0;
    let fitHeight = 0;
    if (availableSize.width > 0 && availableSize.height > 0) {
        const availableRatio = availableSize.width / availableSize.height;
        if (availableRatio > logicalRatio) {
            fitHeight = availableSize.height;
            fitWidth = fitHeight * logicalRatio;
        } else {
            fitWidth = availableSize.width;
            fitHeight = fitWidth / logicalRatio;
        }
    }

    const selection = viewportScale;
    let stageWidth, stageHeight;

    if (selection === 'fit') {
        stageWidth = fitWidth;
        stageHeight = fitHeight;
    } else {
        stageWidth = logicalWidth * selection;
        stageHeight = logicalHeight * selection;
    }

    const contentScale = stageWidth > 0 ? stageWidth / logicalWidth : 0;

    // --- Disabling Logic ---
    const isProcessing = isUploading || previewGenState === 'processing' || exportState === 'processing';
    const arePostLoadControlsDisabled = !isReadyForPreview || isProcessing || isPreviewModeActive;

    return (
        <div className={styles.container}>
            <main ref={mainAreaRef} className={styles.main}>
                <div
                    className={styles.previewArea}
                    style={{
                        width: stageWidth,
                        height: stageHeight,
                        backgroundImage: isTransparentMode && isReadyForPreview && !isPreviewModeActive ? 'var(--checkerboard-light)' : 'none'
                    }}
                >
                    {isPreviewModeActive && previewVideoUrl ? (
                        <div className={styles.videoPlayerContainer}>
                            <video
                                key={previewVideoUrl}
                                src={previewVideoUrl}
                                controls
                                autoPlay
                                loop
                                className={styles.previewVideo}
                            />
                        </div>
                    ) : !isUploading && isReadyForPreview && stageWidth > 0 ? (
                        <Stage
                            width={stageWidth}
                            height={stageHeight}
                            scaleX={contentScale}
                            scaleY={contentScale}
                            onMouseDown={handleStageMouseDown}
                        >
                            <Layer>
                                {!isTransparentMode && konvaBgImage && (
                                    <KonvaImage
                                        image={konvaBgImage}
                                        name="background"
                                        draggable
                                        x={backgroundTransform.x}
                                        y={backgroundTransform.y}
                                        width={backgroundTransform.width}
                                        height={backgroundTransform.height}
                                        scaleX={backgroundTransform.scale}
                                        scaleY={backgroundTransform.scale}
                                        onDragStart={handleTransformStart}
                                        onTransformStart={handleTransformStart}
                                        onDragMove={handleNodeDragMove}
                                        onTransform={handleTransform}
                                        onDragEnd={handleNodeDragEnd}
                                        onTransformEnd={handleTransformEnd}
                                    />
                                )}
                            </Layer>
                            <Layer>
                                {konvaFgImage && (
                                    <KonvaImage
                                        image={konvaFgImage}
                                        name="foreground"
                                        draggable
                                        x={foregroundTransform.x}
                                        y={foregroundTransform.y}
                                        width={foregroundTransform.width}
                                        height={foregroundTransform.height}
                                        scaleX={foregroundTransform.scale}
                                        scaleY={foregroundTransform.scale}
                                        onDragStart={handleTransformStart}
                                        onTransformStart={handleTransformStart}
                                        onDragMove={handleNodeDragMove}
                                        onTransform={handleTransform}
                                        onDragEnd={handleNodeDragEnd}
                                        onTransformEnd={handleTransformEnd}
                                    />
                                )}
                                <Transformer
                                    ref={transformerRef}
                                    borderStroke="#00aaff"
                                    anchorStroke="#00aaff"
                                    anchorFill="#ffffff"
                                    anchorSize={12}
                                    anchorStrokeWidth={2}
                                    borderStrokeWidth={2}
                                    rotateEnabled={false}
                                    keepRatio={true}
                                    boundBoxFunc={newBoundBoxFunc}
                                />
                            </Layer>
                        </Stage>
                    ) : (
                        <div className={styles.placeholder}>
                            {isUploading && <h3>Processing files...</h3>}
                            {!isUploading && !sourceVideoFile && <h3>Select a source video to begin.</h3>}
                            {!isUploading && sourceVideoFile && !isTransparentMode && !backgroundFile && <h3>Select a background file.</h3>}
                        </div>
                    )}
                </div>
            </main>

            <aside className={styles.controlsPanel}>
                <div className={styles.panelHeader}>
                    <h2 className={styles.panelTitle}>Green Screen Studio</h2>
                    <ThemeToggleButton />
                </div>

                {isProcessing && (
                    <div className={styles.processingOverlay} />
                )}

                <div className={styles.viewportControlGroup}>
                    <div className={styles.controlGroup}>
                        <label htmlFor="viewportScale" className={styles.label}>Preview Zoom</label>
                        <select
                            id="viewportScale"
                            name="viewportScale"
                            value={viewportScale}
                            onChange={(e) => setViewportScale(e.target.value === 'fit' ? 'fit' : parseFloat(e.target.value))}
                            className={styles.input}
                            disabled={isPreviewModeActive}
                        >
                            <option value="fit">Auto-Fit</option>
                            <option value="0.5">50%</option>
                            <option value="0.75">75%</option>
                            <option value="1">100%</option>
                            <option value="1.5">150%</option>
                        </select>
                    </div>
                </div>

                <CollapsibleSection title="1. Load Files" defaultOpen={true} disabled={isProcessing || isPreviewModeActive}>
                    <div className={styles.controlGroup}>
                        <label className={styles.checkboxLabel}>
                            <input type="checkbox" checked={isTransparentMode} onChange={(e) => setIsTransparentMode(e.target.checked)} disabled={isProcessing || isPreviewModeActive} />
                            Export with Transparent Background
                        </label>
                    </div>
                    <div className={styles.fileInputsContainer}>
                        <FileInput key={`source-${fileInputKey}`} label="Source Video" acceptedTypes="video/*" onFileSelect={(file, props) => { setSourceVideoFile(file); setSourceInfo(props); }} disabled={isProcessing || isPreviewModeActive} />
                        {!isTransparentMode && (
                            <FileInput key={`background-${fileInputKey}`} label="Background" acceptedTypes="image/*,video/*" onFileSelect={(file, props, url) => { setBackgroundFile(file); setBackgroundInfo(props); setBackgroundPreviewUrl(url); }} disabled={isProcessing || isPreviewModeActive} />
                        )}
                    </div>
                </CollapsibleSection>

                <CollapsibleSection
                    title="2. Adjust Keying"
                    defaultOpen={true}
                    disabled={arePostLoadControlsDisabled}
                    isToggleable={true}
                    isEnabled={isKeyingEnabled}
                    onEnabledChange={setIsKeyingEnabled}
                >
                    <div className={styles.controlGroup}>
                        <label htmlFor="keyColor" className={styles.label}>Key Color
                            <span className={styles.colorSwatch} style={{ backgroundColor: settings.keyColor }}></span>
                            <button className={styles.iconButton} title="Pick color from preview" onClick={handleColorPick}>
                                <DropperIcon />
                            </button>
                        </label>
                        <input
                            id="keyColor"
                            name="keyColor"
                            type="color"
                            value={settings.keyColor}
                            onFocus={() => setIsPickingColor(true)}
                            onBlur={() => setIsPickingColor(false)}
                            onChange={(e) => {
                                handleSettingChange(e);
                                setIsPickingColor(false);
                            }}
                            className={styles.input}
                        />
                    </div>
                    <div className={styles.controlGroup}>
                        <label htmlFor="similarity" className={styles.label}>Similarity: {settings.similarity.toFixed(2)}</label>
                        <input id="similarity" name="similarity" type="range" min="0.01" max="0.8" step="0.01" value={settings.similarity} onChange={handleSettingChange} className={styles.input} />
                    </div>
                    <div className={styles.controlGroup}>
                        <label htmlFor="blend" className={styles.label}>Blend: {settings.blend.toFixed(2)}</label>
                        <input id="blend" name="blend" type="range" min="0" max="0.5" step="0.01" value={settings.blend} onChange={handleSettingChange} className={styles.input} />
                    </div>
                </CollapsibleSection>

                <CollapsibleSection title={`Transform: ${selectedShapeName || 'None'}`} disabled={!selectedShapeName || arePostLoadControlsDisabled}>
                    {selectedShapeName && <div className={styles.transformInfo}>
                        <div><label className={styles.label}>Width</label><input className={styles.input} type="number" readOnly value={Math.round(currentTransform.width * currentTransform.scale)} /></div>
                        <div><label className={styles.label}>Height</label><input className={styles.input} type="number" readOnly value={Math.round(currentTransform.height * currentTransform.scale)} /></div>
                        <div><label className={styles.label}>X Position</label><input className={styles.input} type="number" readOnly value={Math.round(currentTransform.x)} /></div>
                        <div><label className={styles.label}>Y Position</label><input className={styles.input} type="number" readOnly value={Math.round(currentTransform.y)} /></div>
                    </div>}
                    <button onClick={handleResetTransform} className={styles.resetTransformButton}>Reset</button>
                </CollapsibleSection>

                <CollapsibleSection
                    title="3. Generate Preview"
                    defaultOpen={true}
                    disabled={!isReadyForPreview || isProcessing}
                    className={previewGenState === 'processing' ? styles.activeProcessingSection : ''}
                >
                    <div className={styles.previewControlContainer}>
                        {!isPreviewModeActive ? (
                            <>
                                {previewGenState === 'idle' && (
                                    <>
                                        <p className={styles.previewDescription}>
                                            Generate a fast, low-quality video preview to check timing and composition before the final export.
                                        </p>
                                        <button
                                            onClick={handleProcessPreview}
                                            className={styles.exportButton}
                                            disabled={arePostLoadControlsDisabled}
                                        >
                                            Generate Preview
                                        </button>
                                    </>
                                )}
                                {previewGenState === 'processing' && (
                                    <div className={styles.progressContainer}>
                                        <div className={styles.progressLabel}>Generating Preview... {previewProgress.toFixed(0)}%</div>
                                        <div className={styles.progressBar}><div className={styles.progressBarFill} style={{ width: `${previewProgress}%` }}></div></div>
                                    </div>
                                )}
                                {previewGenState === 'failed' && (
                                    <div className={styles.failedContainer} style={{ marginTop: '1rem' }}>
                                        <p>❌ Preview Failed</p>
                                        <button onClick={handleProcessPreview} className={styles.resetButton}>Try Again</button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                <p className={styles.previewDescription}>
                                    Preview is active. Click below to return to the editor.
                                </p>
                                <button onClick={handleExitPreviewMode} className={styles.resetButton}>
                                    Back to Editor
                                </button>
                            </>
                        )}
                    </div>
                </CollapsibleSection>

                <CollapsibleSection
                    title="4. Export"
                    defaultOpen={true}
                    disabled={arePostLoadControlsDisabled}
                    className={exportState === 'processing' ? styles.activeProcessingSection : ''}
                >
                    <div className={styles.controlGroup}>
                        <label htmlFor="format" className={styles.label}>Export Format</label>
                        <select
                            id="format"
                            name="format"
                            value={exportFormat}
                            onChange={(e) => setExportFormat(e.target.value as any)}
                            disabled={isTransparentMode || arePostLoadControlsDisabled}
                            className={styles.input}
                        >
                            {isTransparentMode ? (
                                <option value="prores">ProRes 4444 (with Alpha)</option>
                            ) : (
                                <>
                                    <option value="mp4">MP4 (H.264)</option>
                                    <option value="prores">ProRes 422 HQ (MOV)</option>
                                    <option value="webm">WebM (VP9)</option>
                                    <option value="gif">Animated GIF</option>
                                </>
                            )}
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
                            disabled={arePostLoadControlsDisabled}
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

                    <hr className={styles.divider} />

                    {exportState === 'idle' && (
                        <button className={styles.exportButton} disabled={arePostLoadControlsDisabled} onClick={handleExport}>
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
                </CollapsibleSection>
            </aside>
        </div>
    );
};

export default Previewer;