import { describe, expect, it } from 'vitest';
import { assertSupportedSullyBackup } from './backupImportPolicy';

describe('backup import policy', () => {
    it('accepts SullyOS v1-style backup objects', () => {
        expect(() => assertSupportedSullyBackup({
            timestamp: Date.now(),
            version: 1,
            characters: [],
            messages: [],
        })).not.toThrow();
    });

    it.each([
        { vectorMemories: [] },
        { extraLocalStorageConfig: {} },
    ])('strips third-party backup markers instead of rejecting (fork behavior)', marker => {
        const input = {
            timestamp: Date.now(),
            version: 1,
            characters: [],
            ...marker,
        };
        expect(() => assertSupportedSullyBackup(input)).not.toThrow();
        const markerKey = Object.keys(marker)[0];
        expect(Object.prototype.hasOwnProperty.call(input, markerKey)).toBe(false);
    });

    it('rejects non-object payloads', () => {
        expect(() => assertSupportedSullyBackup([])).toThrow('备份内容无效');
    });
});
