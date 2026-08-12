/**
 * SullyOS 只恢复自身备份。
 *
 * v1 SullyOS 备份仍是宽松的单根 data.json，不能仅靠扩展名或 ZIP 布局识别来源；
 * 这里拦截已经明确属于旧第三方迁移格式的顶层字段。检查必须在任何数据库写入前完成。
 */
import { trackEvent } from './analytics';

const UNSUPPORTED_THIRD_PARTY_FIELDS = [
    'vectorMemories',
    'extraLocalStorageConfig',
] as const;

export function assertSupportedSullyBackup(input: unknown): asserts input is Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        trackEvent('拒绝导入第三方备份', { reason: 'invalid_shape' });
        throw new Error('备份内容无效：只支持 SullyOS 导出的 ZIP 或 JSON 备份。');
    }

    // fork 修改：不再拒绝第三方备份，仅剥离本系统不认识的第三方标记字段后放行，
    // 其余字段交给 importFullData 按原有语义导入（未知字段会被其忽略）。
    const record = input as Record<string, unknown>;
    for (const field of UNSUPPORTED_THIRD_PARTY_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(record, field)) {
            trackEvent('放行第三方备份', { reason: 'third_party_field_stripped', field });
            delete record[field];
        }
    }
}
