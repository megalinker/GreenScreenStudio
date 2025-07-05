import React from 'react';
import styles from './ConnectionStatus.module.css';

interface ConnectionStatusProps {
    isPolling: boolean;
}

const getOS = (): 'windows' | 'macos' | 'linux' => {
    const userAgent = window.navigator.userAgent.toLowerCase();
    if (userAgent.includes("win")) return "windows";
    if (userAgent.includes("mac")) return "macos";
    return "linux";
};

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ isPolling }) => {
    const os = getOS();

    const downloadLinks = {
        windows: 'https://github.com/YOUR_USERNAME/YOUR_REPO/releases/download/v1.0.0/GreenScreenCompanion.exe',
        macos: 'https://github.com/YOUR_USERNAME/YOUR_REPO/releases/download/v1.0.0/GreenScreenCompanion.app.zip',
        linux: 'https://github.com/YOUR_USERNAME/YOUR_REPO/releases/download/v1.0.0/GreenScreenCompanion_linux',
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

                <a
                    href={downloadUrl}
                    className={styles.button}
                    download
                >
                    Download for {os.charAt(0).toUpperCase() + os.slice(1)}
                </a>

                {isPolling && (
                    <div className={styles.status}>
                        <span className={styles.spinner}></span>
                        Searching for companion app... Run the downloaded file to connect.
                    </div>
                )}
            </div>
        </div>
    );
};

export default ConnectionStatus;