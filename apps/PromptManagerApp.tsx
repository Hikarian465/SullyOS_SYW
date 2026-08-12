import React, { useState, useEffect } from 'react';
import { useOS } from '../context/OSContext';
import { CaretLeft, FloppyDisk, ArrowCounterClockwise } from '@phosphor-icons/react';
import { GlobalPrompts, DEFAULT_PROMPTS, loadGlobalPrompts, saveGlobalPrompts } from '../utils/promptManager';

export const PromptManagerApp: React.FC = () => {
    const { closeApp, showToast } = useOS();
    const [prompts, setPrompts] = useState<GlobalPrompts>(DEFAULT_PROMPTS);
    const [isDirty, setIsDirty] = useState(false);

    useEffect(() => {
        setPrompts(loadGlobalPrompts());
    }, []);

    const handleChange = (key: keyof GlobalPrompts, value: string) => {
        setPrompts(prev => ({ ...prev, [key]: value }));
        setIsDirty(true);
    };

    const handleSave = () => {
        saveGlobalPrompts(prompts);
        setIsDirty(false);
        showToast('预设已保存，将在下次对话生效', 'success');
    };

    const handleReset = () => {
        if (window.confirm('确定要恢复为系统默认预设吗？你所有的修改都将丢失。')) {
            setPrompts({ ...DEFAULT_PROMPTS });
            setIsDirty(true);
        }
    };

    return (
        <div className="w-full h-full flex flex-col bg-slate-50 text-slate-800 absolute inset-0 z-10 overflow-hidden">
            {/* 顶栏 */}
            <div className="flex-none h-14 bg-white/80 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-4 sticky top-0 z-20 pt-safe">
                <button
                    onClick={() => closeApp('prompt_manager')}
                    className="p-2 -ml-2 text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
                >
                    <CaretLeft size={24} />
                </button>
                <div className="font-medium text-slate-800 text-lg">预设管理</div>
                <div className="w-10"></div>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-24">
                <div className="bg-blue-50 text-blue-800 p-3 rounded-xl text-sm leading-relaxed">
                    在这里修改的预设，将全局生效于所有线上聊天角色的 System Prompt。
                    <br />
                    <span className="font-semibold">可用变量：</span>
                    <br />
                    <code>{'{{char.name}}'}</code> - 当前角色的名字
                    <br />
                    <code>{'{{user.name}}'}</code> - 你的名字
                    <br />
                    <code>{'{{emojiContextStr}}'}</code> - 仅限行为规范使用，渲染表情包列表
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="font-medium text-slate-700">聊天行为规范 (Chat Rules)</label>
                    </div>
                    <p className="text-xs text-slate-500 mb-1">位于 Prompt 中段，规定输出格式、可用动作与基本聊天原则。</p>
                    <textarea
                        value={prompts.chatRules}
                        onChange={(e) => handleChange('chatRules', e.target.value)}
                        className="w-full h-64 p-3 rounded-xl border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-y"
                    />
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="font-medium text-slate-700">对话总纲 (关于对方的表达)</label>
                    </div>
                    <p className="text-xs text-slate-500 mb-1">位于 Prompt 尾部倒数第二段，防止模型变成讨好型机器人。</p>
                    <textarea
                        value={prompts.recencyTail}
                        onChange={(e) => handleChange('recencyTail', e.target.value)}
                        className="w-full h-48 p-3 rounded-xl border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-y"
                    />
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="font-medium text-slate-700">自我认知 (回到你自己)</label>
                    </div>
                    <p className="text-xs text-slate-500 mb-1">位于 Prompt 最后一段（钢印），开口前的最后一句定调。</p>
                    <textarea
                        value={prompts.selfIdentity}
                        onChange={(e) => handleChange('selfIdentity', e.target.value)}
                        className="w-full h-48 p-3 rounded-xl border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-y"
                    />
                </div>
            </div>

            {/* 底栏操作区 */}
            <div className="flex-none bg-white border-t border-slate-200 p-4 pb-safe flex gap-3 shadow-lg relative z-20">
                <button
                    onClick={handleReset}
                    className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-medium flex items-center justify-center gap-2 hover:bg-slate-200 transition-colors"
                >
                    <ArrowCounterClockwise size={20} />
                    恢复默认
                </button>
                <button
                    onClick={handleSave}
                    disabled={!isDirty}
                    className={\`flex-[2] py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors \${isDirty ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-600/20' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}\`}
                >
                    <FloppyDisk size={20} />
                    {isDirty ? '保存修改' : '已保存'}
                </button>
            </div>
        </div>
    );
};

export default PromptManagerApp;
