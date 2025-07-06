import React from 'react';
import styles from './ConnectionStatus.module.css';

const getOS = (): 'windows' | 'macos' | 'linux' => {
    const userAgent = window.navigator.userAgent.toLowerCase();
    if (userAgent.includes("win")) return "windows";
    if (userAgent.includes("mac")) return "macos";
    return "linux";
};

const ConnectionStatus: React.FC = () => {
    const os = getOS();
    const repoUrl = 'https://github.com/megalinker/GreenScreenStudio';

    const downloadLinks = {
        windows: `${repoUrl}/releases/download/v1.1.1/GreenScreenCompanion-windows-x64.zip`,
        macos: `${repoUrl}/releases/download/v1.1.1/GreenScreenCompanion-macos-x64.zip`,
        linux: `${repoUrl}/releases/download/v1.1.1/GreenScreenCompanion-linux-x64.zip`,
    };

    const downloadUrl = downloadLinks[os] || downloadLinks.linux;

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <div className={styles.icon}>⚠️</div>
                <h1 className={styles.title}>Companion App Required</h1>
                <p className={styles.description}>
                    To process high-resolution video, this web app needs a little help.
                    The <strong>Companion App</strong> is a small, secure program that runs on your computer
                    to perform the heavy lifting, ensuring your files are processed at full speed
                    and never leave your machine.
                </p>

                <p className={styles.safetyNote}>
                    For your peace of mind, the app is completely open-source. You can{' '}
                    <a href={repoUrl} target="_blank" rel="noopener noreferrer">
                        view the code on GitHub
                    </a>{' '}
                    to verify its safety.
                </p>

                <a
                    href={downloadUrl}
                    className={styles.button}
                    download
                >
                    Download for {os.charAt(0).toUpperCase() + os.slice(1)}
                </a>

                <div className={styles.status}>
                    <span className={styles.spinner}></span>
                    Searching for companion app... Run the downloaded file to connect.
                </div>
            </div>
        </div>
    );
};

export default ConnectionStatus;