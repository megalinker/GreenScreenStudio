import React, { useState } from 'react';
import styles from './CollapsibleSection.module.css';

interface CollapsibleSectionProps {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
    isToggleable?: boolean;
    isEnabled?: boolean;
    onEnabledChange?: (enabled: boolean) => void;
    disabled?: boolean;
}

const ChevronIcon = ({ isOpen }: { isOpen: boolean }) => (
    <svg className={`${styles.chevron} ${isOpen ? styles.open : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
);

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
    title,
    children,
    defaultOpen = false,
    isToggleable = false,
    isEnabled = true,
    onEnabledChange,
    disabled = false
}) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    const handleToggleOpen = (e: React.MouseEvent) => {
        // Prevent toggling when clicking on the checkbox itself
        if ((e.target as HTMLElement).tagName.toLowerCase() === 'input') return;
        setIsOpen(!isOpen);
    };

    const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onEnabledChange?.(e.target.checked);
    };

    const isContentDisabled = disabled || (isToggleable && !isEnabled);

    return (
        <div className={`${styles.section} ${isContentDisabled ? styles.sectionDisabled : ''}`} data-is-open={isOpen}>
            <header className={styles.header} onClick={handleToggleOpen}>
                <div className={styles.titleContainer}>
                    {isToggleable && (
                        <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={handleCheckboxChange}
                            onClick={e => e.stopPropagation()} // Stop click from bubbling to header
                            className={styles.enableToggle}
                            disabled={disabled}
                        />
                    )}
                    <h3 className={styles.title}>{title}</h3>
                </div>
                {!disabled && <ChevronIcon isOpen={isOpen} />}
            </header>
            {isOpen && !isContentDisabled && (
                <div className={styles.content}>
                    {children}
                </div>
            )}
        </div>
    );
};

export default CollapsibleSection;