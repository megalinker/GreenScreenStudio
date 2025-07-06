import React, { useState, useCallback } from 'react';
import styles from './FileInput.module.css';

const Spinner = () => <div className={styles.spinner}></div>;

interface FileInputProps {
    label: string;
    acceptedTypes: string;
    onFileSelect: (file: File, previewUrl: string | null) => void;
    disabled?: boolean;
}

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
            const formData = new FormData();
            formData.append('video', selectedFile);

            try {
                const response = await fetch('http://localhost:5000/api/thumbnail', {
                    method: 'POST',
                    body: formData,
                });

                if (!response.ok) {
                    throw new Error(`Server responded with ${response.status}`);
                }

                const data = await response.json();
                if (data.thumbnail) {
                    finalPreviewUrl = data.thumbnail;
                    setPreviewUrl(finalPreviewUrl);
                } else {
                    throw new Error('Thumbnail not found in server response.');
                }
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
                    <span className={styles.changeButton}>Change File</span>
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