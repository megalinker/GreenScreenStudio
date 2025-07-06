import React, { useState, useCallback } from 'react';
import styles from './FileInput.module.css';

const Spinner = () => <div className={styles.spinner}></div>;

interface FileInputProps {
    label: string;
    acceptedTypes: string;
    onFileSelect: (file: File, previewUrl: string | null) => void;
    disabled?: boolean;
}

/**
 * Generates a thumbnail for a video file locally in the browser.
 * @param videoFile The video file.
 * @returns A promise that resolves with a base64 data URL of the thumbnail.
 */
const generateVideoThumbnail = (videoFile: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        if (!context) {
            return reject(new Error('Canvas 2D context is not supported.'));
        }

        video.muted = true;
        video.playsInline = true;

        video.addEventListener('loadeddata', () => {
            video.currentTime = Math.min(1, video.duration / 2);
        });

        video.addEventListener('seeked', () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;

            context.drawImage(video, 0, 0, canvas.width, canvas.height);

            URL.revokeObjectURL(video.src);

            resolve(canvas.toDataURL('image/jpeg'));
        });

        video.addEventListener('error', (e) => {
            URL.revokeObjectURL(video.src);
            reject(new Error('Failed to load video for thumbnail generation.'));
        });

        const url = URL.createObjectURL(videoFile);
        video.src = url;
    });
};


const FileInput: React.FC<FileInputProps> = ({ label, acceptedTypes, onFileSelect, disabled = false }) => {
    const [isDragging, setIsDragging] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);

    const handleFile = useCallback(async (selectedFile: File) => {
        if (disabled) return;

        setFile(selectedFile);
        let finalPreviewUrl: string | null = null;

        if (selectedFile.type.startsWith('image/')) {
            finalPreviewUrl = URL.createObjectURL(selectedFile);
            setPreviewUrl(finalPreviewUrl);
        } else if (selectedFile.type.startsWith('video/')) {
            setIsGeneratingThumbnail(true);
            setPreviewUrl(null);
            try {
                finalPreviewUrl = await generateVideoThumbnail(selectedFile);
                setPreviewUrl(finalPreviewUrl);
            } catch (error) {
                console.error("Video thumbnail generation failed:", error);
                setPreviewUrl(null);
            } finally {
                setIsGeneratingThumbnail(false);
            }
        }

        onFileSelect(selectedFile, finalPreviewUrl);
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
        if (isGeneratingThumbnail) {
            return (
                <div className={styles.prompt}>
                    <Spinner />
                    <span>Generating Preview...</span>
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