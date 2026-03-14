/**
 * MeetingBriefManager - Reads, caches, watches, and merges meeting brief content.
 * Supports two input modes:
 *   1. File mode: select any .md file, watched for live changes
 *   2. Text mode: type/paste context directly
 * Combined content is injected into LLM context via SessionTracker.
 */

import fs from 'fs';
import path from 'path';
import { CredentialsManager } from './CredentialsManager';

const MAX_BRIEF_CHARS = 4000;

export class MeetingBriefManager {
    private static instance: MeetingBriefManager;

    private filePath: string | undefined;
    private fileContent: string = '';
    private typedText: string = '';
    private watcher: fs.FSWatcher | null = null;
    private debounceTimer: NodeJS.Timeout | null = null;
    private onContentChanged: ((content: string) => void) | null = null;

    private constructor() {}

    public static getInstance(): MeetingBriefManager {
        if (!MeetingBriefManager.instance) {
            MeetingBriefManager.instance = new MeetingBriefManager();
        }
        return MeetingBriefManager.instance;
    }

    /**
     * Initialize from persisted settings.
     */
    public init(): void {
        const creds = CredentialsManager.getInstance();
        this.filePath = creds.getMeetingBriefPath();
        this.typedText = creds.getMeetingBriefText() || '';

        if (this.filePath) {
            this.readFile();
            this.startWatching();
        }

        console.log(`[MeetingBriefManager] Initialized — file: ${this.filePath || 'none'}, text: ${this.typedText.length} chars`);
    }

    /**
     * Register a callback for when combined content changes.
     */
    public setOnContentChanged(callback: (content: string) => void): void {
        this.onContentChanged = callback;
    }

    /**
     * Set file path, read content, start watching.
     */
    public setPath(filePath: string): void {
        this.stopWatching();
        this.filePath = filePath;
        const creds = CredentialsManager.getInstance();
        creds.setMeetingBriefPath(filePath);
        creds.addMeetingBriefRecentFile(filePath);
        this.readFile();
        this.startWatching();
        this.notifyChange();
    }

    /**
     * Set typed text context.
     */
    public setText(text: string): void {
        this.typedText = text;
        CredentialsManager.getInstance().setMeetingBriefText(text);
        this.notifyChange();
    }

    /**
     * Get the current file path.
     */
    public getPath(): string | undefined {
        return this.filePath;
    }

    /**
     * Get the current typed text.
     */
    public getText(): string {
        return this.typedText;
    }

    /**
     * Get merged brief content (file + typed text), truncated to limit.
     */
    public getBriefContent(): string {
        const parts: string[] = [];

        if (this.fileContent.trim()) {
            parts.push(this.fileContent.trim());
        }

        if (this.typedText.trim()) {
            parts.push(this.typedText.trim());
        }

        if (parts.length === 0) return '';

        const combined = parts.join('\n\n');
        if (combined.length > MAX_BRIEF_CHARS) {
            return combined.substring(0, MAX_BRIEF_CHARS) + '\n...[truncated]';
        }
        return combined;
    }

    /**
     * Clear both file and text.
     */
    public clear(): void {
        this.stopWatching();
        this.filePath = undefined;
        this.fileContent = '';
        this.typedText = '';
        const creds = CredentialsManager.getInstance();
        creds.setMeetingBriefPath(undefined);
        creds.setMeetingBriefText(undefined);
        this.notifyChange();
        console.log('[MeetingBriefManager] Cleared');
    }

    /**
     * Clear active content but preserve recents list.
     * Used on meeting end to avoid stale context bleeding into next meeting.
     */
    public clearContent(): void {
        this.stopWatching();
        this.filePath = undefined;
        this.fileContent = '';
        this.typedText = '';
        const creds = CredentialsManager.getInstance();
        creds.setMeetingBriefPath(undefined);
        creds.setMeetingBriefText(undefined);
        this.notifyChange();
        console.log('[MeetingBriefManager] Content cleared (recents preserved)');
    }

    /**
     * Get recent file paths.
     */
    public getRecentFiles(): string[] {
        return CredentialsManager.getInstance().getMeetingBriefRecentFiles();
    }

    /**
     * Clean up watcher on shutdown.
     */
    public dispose(): void {
        this.stopWatching();
    }

    // =========================================================================
    // Private
    // =========================================================================

    private readFile(): void {
        if (!this.filePath) {
            this.fileContent = '';
            return;
        }
        try {
            if (fs.existsSync(this.filePath)) {
                this.fileContent = fs.readFileSync(this.filePath, 'utf-8');
                console.log(`[MeetingBriefManager] Read file: ${this.filePath} (${this.fileContent.length} chars)`);
            } else {
                console.warn(`[MeetingBriefManager] File not found: ${this.filePath}`);
                this.fileContent = '';
            }
        } catch (err) {
            console.error(`[MeetingBriefManager] Error reading file:`, err);
            this.fileContent = '';
        }
    }

    private startWatching(): void {
        if (!this.filePath || !fs.existsSync(this.filePath)) return;

        try {
            this.watcher = fs.watch(this.filePath, (eventType) => {
                if (eventType === 'change') {
                    // Debounce for Obsidian atomic writes
                    if (this.debounceTimer) clearTimeout(this.debounceTimer);
                    this.debounceTimer = setTimeout(() => {
                        this.readFile();
                        this.notifyChange();
                    }, 500);
                }
            });
            console.log(`[MeetingBriefManager] Watching: ${this.filePath}`);
        } catch (err) {
            console.error(`[MeetingBriefManager] Failed to watch file:`, err);
        }
    }

    private stopWatching(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
    }

    private notifyChange(): void {
        if (this.onContentChanged) {
            this.onContentChanged(this.getBriefContent());
        }
    }
}
