import React, { useState, useCallback } from 'react';
import styles from './FileInput.module.css';

const Spinner = () => <div className={styles.spinner}></div>;

interface MediaProperties {
    width: number;
    height: number;
    duration: number;
}

interface FileInputProps {
    label: string;
    acceptedTypes: string;
    onFileSelect: (file: File, properties: MediaProperties, previewUrl: string | null) => void;
    disabled?: boolean;
}

/**
 * Extracts properties (width, height, duration) and a thumbnail for a media file.
 * @param mediaFile The video or image file.
 * @returns A promise that resolves with the properties and a preview URL.
 */
const getMediaDetails = (mediaFile: File): Promise<{ properties: MediaProperties; previewUrl: string | null }> => {
    return new Promise((resolve, reject) => {
        if (mediaFile.type.startsWith('video/')) {
            const video = document.createElement('video');
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');

            if (!context) {
                return reject(new Error('Canvas 2D context is not supported.'));
            }

            let details = {
                properties: { width: 0, height: 0, duration: 0 },
                previewUrl: null as string | null,
            };

            video.muted = true;
            video.playsInline = true;
            video.preload = 'metadata';

            video.addEventListener('loadedmetadata', () => {
                details.properties = {
                    width: video.videoWidth,
                    height: video.videoHeight,
                    duration: video.duration,
                };
                video.currentTime = Math.min(1, video.duration / 2);
            });

            video.addEventListener('seeked', () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                details.previewUrl = canvas.toDataURL('image/jpeg');
                URL.revokeObjectURL(video.src);
                resolve(details);
            });

            video.addEventListener('error', (e) => {
                URL.revokeObjectURL(video.src);
                if (details.properties.width > 0) {
                    resolve(details);
                } else {
                    reject(new Error('Failed to load video for property extraction.'));
                }
            });

            video.src = URL.createObjectURL(mediaFile);

        } else if (mediaFile.type.startsWith('image/')) {
            const img = new Image();
            const url = URL.createObjectURL(mediaFile);
            img.onload = () => {
                const properties = {
                    width: img.width,
                    height: img.height,
                    duration: 0,
                };
                resolve({ properties, previewUrl: url });
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load image.'));
            };
            img.src = url;
        } else {
            reject(new Error('Unsupported file type.'));
        }
    });
};


const FileInput: React.FC<FileInputProps> = ({ label, acceptedTypes, onFileSelect, disabled = false }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    const handleFile = useCallback(async (selectedFile: File) => {
        if (disabled) return;

        setFile(selectedFile);
        setIsProcessing(true);
        setPreviewUrl(null);

        try {
            const { properties, previewUrl: finalPreviewUrl } = await getMediaDetails(selectedFile);
            setPreviewUrl(finalPreviewUrl);
            onFileSelect(selectedFile, properties, finalPreviewUrl);
        } catch (error) {
            console.error("Media detail extraction failed:", error);
            alert(`Could not process file: ${error instanceof Error ? error.message : 'Unknown error'}`);
            setFile(null);
            setPreviewUrl(null);
        } finally {
            setIsProcessing(false);
        }
    }, [onFileSelect, disabled]);

    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (disabled) return;
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (disabled) return;
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (disabled) return;
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
        e.target.value = '';
    };

    const renderContent = () => {
        if (isProcessing) {
            return (
                <div className={styles.prompt}>
                    <Spinner />
                    <span>Reading File...</span>
                </div>
            );
        }

        if (previewUrl && file) {
            return (
                <>
                    <img src={previewUrl} alt="File Preview" className={styles.preview} />
                    <span className={styles.fileName}>{file.name}</span>
                    <button type="button" className={styles.changeButton}>Change File</button>
                </>
            );
        }

        return (
            <div className={styles.prompt}>
                <strong>{label}</strong>
                <span>Drag & Drop or Click to Select</span>
            </div>
        );
    };

    return (
        <div
            className={`${styles.container} ${isDragging ? styles.dragging : ''} ${disabled ? styles.disabled : ''}`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            <input
                type="file"
                id={label}
                className={styles.hiddenInput}
                accept={acceptedTypes}
                onChange={handleInputChange}
                disabled={disabled}
            />
            <label htmlFor={label} className={styles.label}>
                {renderContent()}
            </label>
        </div>
    );
};

export default FileInput;